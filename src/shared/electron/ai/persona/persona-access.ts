import type { AgentSurface } from '@shared/api/ai-types';
import type { PersonaEntry, PersonaListing } from '@shared/api/persona-channels';
import {
  memoriesInScope,
  searchPersona,
  type PersonaSearchHit,
  type PersonaSearchRequest,
} from '@shared/api/persona-search';
import { logger } from '@shared/electron/logger';
import type { PersonaQuestion } from '@shared/api/persona-learning-protocol';
import type { PersonaAccess } from '../agent-provider';
import type { PersonaLibrary } from './persona-library';

/**
 * The most tags the agent is told about up front: enough to search by, few enough to cost little.
 */
const TAG_LIMIT: number = 40;

/**
 * The open questions about the user, as a run reaches them (#1519).
 */
export interface PersonaQuestionSource {
  questionCount(): Promise<number>;
  offerQuestion(conversationKey: string): Promise<PersonaQuestion | null>;
  answer(request: { readonly questionId: string; readonly answer: string }): Promise<boolean>;
}

/**
 * Binds the persona to one run (#1515): counts the memories in the run's scope and gathers their
 * tags, for the prompt, and searches and forgets on the run's behalf. A search reads the disk again,
 * so a memory added mid-conversation is found on the next search.
 * @param library The persona store.
 * @param surface The run's surface.
 * @param language The run's language, or null.
 * @param changed Called after the agent forgot something, to tell the windows.
 * @param questions The open questions, or null for none.
 * @param conversationKey The conversation the run belongs to, so it is offered one question at most.
 * @returns Returns the access, or null when the persona could not be read.
 */
export async function bindPersona(
  library: PersonaLibrary,
  surface: AgentSurface,
  language: string | null,
  changed: () => void,
  questions: PersonaQuestionSource | null = null,
  conversationKey: string = '',
): Promise<PersonaAccess | null> {
  let listing: PersonaListing;
  try {
    listing = await library.list();
  } catch (error: unknown) {
    logger.warn('bindPersona', 'Could not read the persona for a run', error);
    return null;
  }
  const memories: readonly PersonaEntry[] = memoriesInScope(listing.entries, surface, language);
  const questionCount: number = questions === null ? 0 : await questions.questionCount();
  return {
    memories: memories.length,
    questions: questionCount,
    offerQuestion: (): Promise<PersonaQuestion | null> =>
      questions === null ? Promise.resolve(null) : questions.offerQuestion(conversationKey),
    answerQuestion: (questionId: string, answer: string): Promise<boolean> =>
      questions === null ? Promise.resolve(false) : questions.answer({ questionId, answer }),
    tags: tagsByUse(memories).slice(0, TAG_LIMIT),
    search: async (request: PersonaSearchRequest): Promise<readonly PersonaSearchHit[]> => {
      const current: PersonaListing = await library.list();
      const hits: readonly PersonaSearchHit[] = searchPersona(
        memoriesInScope(current.entries, surface, language),
        request,
      );
      logger.debug(
        'bindPersona.search',
        `Persona search (${request.tags.length} tag(s)) found ${hits.length} memor(ies)`,
      );
      return hits;
    },
    forget: async (ids: readonly string[]): Promise<readonly string[]> => {
      const forgotten: string[] = [];
      for (const id of ids) {
        const entry: PersonaEntry | null = await library.read(id);
        if (entry !== null) {
          await library.delete(id);
          forgotten.push(entry.name);
        }
      }
      if (forgotten.length > 0) {
        logger.info(
          'bindPersona.forget',
          `Forgot ${forgotten.length} persona entr(ies) at the user's request`,
        );
        changed();
      }
      return forgotten;
    },
  };
}

/**
 * Lists the tags memories carry, most used first.
 * @param memories The memories.
 * @returns Returns the tags.
 */
function tagsByUse(memories: readonly PersonaEntry[]): readonly string[] {
  const counts: Map<string, number> = new Map<string, number>();
  for (const entry of memories) {
    for (const tag of entry.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(
      (a: [string, number], b: [string, number]): number => b[1] - a[1] || a[0].localeCompare(b[0]),
    )
    .map(([tag]: [string, number]): string => tag);
}
