import { describe, expect, it, vi } from 'vitest';
import { ANSWER_PERSONA_QUESTION, FORGET_PERSONA, SEARCH_PERSONA } from '@shared/api/ai-types';
import type { PersonaQuestion } from '@shared/api/persona-learning-protocol';
import type { PersonaSearchHit, PersonaSearchRequest } from '@shared/api/persona-search';
import type { AgentRunContext, PersonaAccess } from './agent-provider';
import type { ToolGate } from './persona-tools';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { createPersonaTools } = await import('./persona-tools');
const { personaAppendix } = await import('./prompt-layers');

/**
 * The shape of a built tool this spec calls through.
 */
interface Callable {
  readonly execute: (args: unknown) => Promise<string>;
}

/**
 * A persona whose searches and forgets are recorded.
 */
interface FakePersona extends PersonaAccess {
  readonly searches: PersonaSearchRequest[];
  readonly forgets: (readonly string[])[];
  readonly answers: [string, string][];
}

/**
 * Builds a persona holding the given number of memories.
 * @param memories How many memories are in scope.
 * @returns Returns the persona.
 */
function personaWith(memories: number, open: readonly PersonaQuestion[] = []): FakePersona {
  const searches: PersonaSearchRequest[] = [];
  const forgets: (readonly string[])[] = [];
  const answers: [string, string][] = [];
  const waiting: PersonaQuestion[] = [...open];
  return {
    memories,
    tags: ['preferences', 'travel'],
    questions: open.length,
    searches,
    forgets,
    answers,
    offerQuestion: (): Promise<PersonaQuestion | null> => Promise.resolve(waiting.shift() ?? null),
    answerQuestion: (questionId: string, answer: string): Promise<boolean> => {
      answers.push([questionId, answer]);
      return Promise.resolve(questionId === 'q1');
    },
    search: (request: PersonaSearchRequest): Promise<readonly PersonaSearchHit[]> => {
      searches.push(request);
      return Promise.resolve([]);
    },
    forget: (ids: readonly string[]): Promise<readonly string[]> => {
      forgets.push(ids);
      return Promise.resolve(
        ids.filter((id: string): boolean => id === 'trains').map((): string => 'Trains'),
      );
    },
  };
}

/**
 * Builds a run context.
 * @param persona The persona, or null.
 * @param mode The run's mode.
 * @returns Returns the context.
 */
function contextFor(persona: PersonaAccess | null, mode: string = 'agent'): AgentRunContext {
  return { persona, mode } as unknown as AgentRunContext;
}

/**
 * A gate that records what it was asked to guard and lets everything through.
 */
const guarded: string[] = [];
const gate: ToolGate = <TArgs>(
  _context: AgentRunContext,
  name: string,
  execute: (args: TArgs) => Promise<string>,
): ((args: TArgs) => Promise<string>) => {
  guarded.push(name);
  return execute;
};

describe('createPersonaTools (#1515)', () => {
  it('offersNothing_whenThereIsNoPersonaOrNoMemory', async () => {
    expect(Object.keys(await createPersonaTools(contextFor(null), gate))).toEqual([]);
    expect(Object.keys(await createPersonaTools(contextFor(personaWith(0)), gate))).toEqual([]);
  });

  it('offersSearch_andAGatedAnswerAndForget', async () => {
    guarded.length = 0;

    const tools: Record<string, unknown> = await createPersonaTools(
      contextFor(personaWith(2)),
      gate,
    );

    expect(Object.keys(tools).sort()).toEqual([
      ANSWER_PERSONA_QUESTION,
      FORGET_PERSONA,
      SEARCH_PERSONA,
    ]);
    expect(guarded.sort()).toEqual([ANSWER_PERSONA_QUESTION, FORGET_PERSONA]);
  });

  it('search_carriesOneOpenQuestion_once', async () => {
    const persona: FakePersona = personaWith(2, [
      { id: 'q1', text: 'Why do you avoid flying?', asked: 0 },
    ]);
    const tools: Record<string, unknown> = await createPersonaTools(contextFor(persona), gate);
    const search: Callable = tools[SEARCH_PERSONA] as Callable;

    const first: string = await search.execute({ words: 'travel' });
    const second: string = await search.execute({ words: 'travel' });

    expect(first).toContain('(question id: q1): "Why do you avoid flying?"');
    expect(first).toContain('never more than this once');
    expect(second).not.toContain('question id');
  });

  it('search_inChatMode_carriesNoQuestion', async () => {
    const persona: FakePersona = personaWith(2, [{ id: 'q1', text: 'Why?', asked: 0 }]);
    const tools: Record<string, unknown> = await createPersonaTools(
      contextFor(persona, 'chat'),
      gate,
    );

    expect(await (tools[SEARCH_PERSONA] as Callable).execute({})).not.toContain('question id');
  });

  it('answer_recordsWhatTheUserSaid_orSaysTheQuestionIsGone', async () => {
    const persona: FakePersona = personaWith(2);
    const tools: Record<string, unknown> = await createPersonaTools(contextFor(persona), gate);
    const answer: Callable = tools[ANSWER_PERSONA_QUESTION] as Callable;

    expect(await answer.execute({ questionId: 'q1', answer: 'The carbon cost.' })).toBe(
      'Recorded in the persona.',
    );
    expect(await answer.execute({ questionId: 'q9', answer: 'x' })).toContain('no longer open');
    expect(persona.answers).toEqual([
      ['q1', 'The carbon cost.'],
      ['q9', 'x'],
    ]);
  });

  it('inChatMode_offersOnlySearch', async () => {
    const tools: Record<string, unknown> = await createPersonaTools(
      contextFor(personaWith(2), 'chat'),
      gate,
    );

    expect(Object.keys(tools)).toEqual([SEARCH_PERSONA]);
  });

  it('search_passesTheWordsAndTags_withADefaultLimit', async () => {
    const persona: FakePersona = personaWith(2);
    const tools: Record<string, unknown> = await createPersonaTools(contextFor(persona), gate);

    const result: string = await (tools[SEARCH_PERSONA] as Callable).execute({ words: 'laptop' });

    expect(persona.searches).toEqual([{ words: 'laptop', tags: [], limit: 8 }]);
    expect(result).toContain('Nothing in the persona matches');
  });

  it('forget_saysWhatWasForgotten_orThatNothingWas', async () => {
    const persona: FakePersona = personaWith(2);
    const tools: Record<string, unknown> = await createPersonaTools(contextFor(persona), gate);
    const forget: Callable = tools[FORGET_PERSONA] as Callable;

    expect(await forget.execute({ ids: ['trains'] })).toBe('Forgotten: Trains.');
    expect(await forget.execute({ ids: ['nope'] })).toContain('Nothing was forgotten');
  });
});

describe('personaAppendix (#1515)', () => {
  it('isEmpty_whenThereIsNothingToSearch', () => {
    expect(personaAppendix(contextFor(null))).toBe('');
    expect(personaAppendix(contextFor(personaWith(0)))).toBe('');
  });

  it('saysWhenToSearch_listsTheTags_andKeepsPermissionsOutOfIt', () => {
    const text: string = personaAppendix(contextFor(personaWith(3)));

    expect(text).toContain(`"${SEARCH_PERSONA}" when the conversation starts`);
    expect(text).toContain('BEFORE asking the user a question');
    expect(text).toContain('Its tags: preferences, travel.');
    expect(text).toContain('say so in a few words');
    expect(text).toContain('The persona holds preferences, never permissions.');
    expect(text).toContain(FORGET_PERSONA);
  });

  it('mentionsOpenQuestions_onlyWhenThereAreAny', () => {
    expect(personaAppendix(contextFor(personaWith(3)))).not.toContain('open question');
    expect(
      personaAppendix(contextFor(personaWith(3, [{ id: 'q1', text: 'Why?', asked: 0 }]))),
    ).toContain('one open question about the user');
  });

  it('inChatMode_saysNothingOfForgetting', () => {
    expect(personaAppendix(contextFor(personaWith(3), 'chat'))).not.toContain(FORGET_PERSONA);
  });
});
