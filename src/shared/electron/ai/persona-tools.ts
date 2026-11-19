import type { ToolSet } from 'ai';
import { FORGET_PERSONA, SEARCH_PERSONA } from '@shared/api/ai-types';
import {
  PERSONA_SEARCH_LIMIT,
  renderPersonaHits,
  type PersonaSearchHit,
} from '@shared/api/persona-search';
import { logger } from '@shared/electron/logger';
import type { AgentRunContext, PersonaAccess } from './agent-provider';

/**
 * Wraps a tool's work in the permission gate, as `ai-sdk-stream` does for every tool that changes
 * something. Passed in rather than imported, because that module builds these tools.
 */
export type ToolGate = <TArgs>(
  context: AgentRunContext,
  name: string,
  execute: (args: TArgs) => Promise<string>,
  describe?: (args: TArgs) => string,
) => (args: TArgs) => Promise<string>;

/**
 * The arguments of a persona search.
 */
interface SearchArguments {
  readonly words?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
}

/**
 * The arguments of a forget.
 */
interface ForgetArguments {
  readonly ids: readonly string[];
}

/**
 * Builds the persona tools for a run (#1515): `search_persona`, which the agent calls when it chooses
 * — at the start, when the topic changes, before asking the user anything — and `forget_persona`, for
 * when the user says "forget that". Present only when the run's scope holds a memory, on the skill
 * tool's grounds: a tool the model can never usefully call is better absent than described.
 *
 * Searching is read-only and not gated. Forgetting deletes, so it goes through the gate like every
 * other tool that deletes, and is withheld in chat mode, where nothing is changed.
 * @param context The run context.
 * @param gate The permission gate.
 * @returns Returns the tool set, empty when the persona has nothing to search.
 */
export async function createPersonaTools(
  context: AgentRunContext,
  gate: ToolGate,
): Promise<ToolSet> {
  const persona: PersonaAccess | null | undefined = context.persona;
  if (persona === null || persona === undefined || persona.memories === 0) {
    return {};
  }
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const tools: ToolSet = {
    [SEARCH_PERSONA]: tool({
      description:
        "Search the user's persona: what Studio has learned about them — preferences, decisions, things they keep correcting. Search by the kind of preference or decision as well as the subject: a preference about how they like to choose may be filed under decisions, not under the thing being chosen.",
      inputSchema: z.object({
        words: z
          .string()
          .optional()
          .describe('Words to look for, e.g. "choosing options recommendation" or "reply length".'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Tags to look for, from those listed in your instructions.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(PERSONA_SEARCH_LIMIT)
          .optional()
          .describe(`The most memories to return; ${String(8)} when omitted.`),
      }),
      execute: async (args: SearchArguments): Promise<string> => {
        const hits: readonly PersonaSearchHit[] = await persona.search({
          words: args.words ?? '',
          tags: args.tags ?? [],
          limit: args.limit ?? 8,
        });
        return renderPersonaHits(hits);
      },
    }),
  };
  if (context.mode === 'chat') {
    return tools;
  }
  return {
    ...tools,
    [FORGET_PERSONA]: tool({
      description:
        'Forget entries in the persona, by the ids a search returned. Only when the user asks you to forget something, or not to remember it.',
      inputSchema: z.object({
        ids: z.array(z.string().min(1)).min(1).describe('The ids of the entries to forget.'),
      }),
      execute: gate(
        context,
        FORGET_PERSONA,
        async (args: ForgetArguments): Promise<string> => {
          const forgotten: readonly string[] = await persona.forget(args.ids);
          logger.info('persona-tools.forget', `Forgot ${forgotten.length} entr(ies)`);
          return forgotten.length === 0
            ? 'Nothing was forgotten: none of those ids is in the persona. Search for the entry first.'
            : `Forgotten: ${forgotten.join(', ')}.`;
        },
        (args: ForgetArguments): string => `Forget ${args.ids.join(', ')}`,
      ),
    }),
  };
}
