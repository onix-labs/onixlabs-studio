import { TestBed } from '@angular/core/testing';
import type { Bridge } from '@shared/api/bridge';
import {
  PersonaLearningChannel,
  type LearningBatch,
  type LearningFinishRequest,
  type LearningOutcome,
  type LearningState,
} from '@shared/api/persona-learning-protocol';
import {
  AiOneShot,
  type AiOneShotRequest,
  type AiOneShotResult,
} from '@shared/angular/services/ai-runtime/ai-one-shot';
import { Settings } from '@shared/angular/services/settings/settings';
import { PersonaLearning, type LearningRunSummary } from './persona-learning';

/**
 * A stand-in for the main process's side of persona learning.
 */
interface FakeMain {
  batches: LearningBatch[];
  begins: unknown[];
  finished: LearningFinishRequest[];
  abandoned: string[];
  state: LearningState;
}

/**
 * Installs a bridge over a fake main process.
 * @param batches The batches Begin hands out, in turn.
 * @returns Returns the fake, to inspect.
 */
function installBridge(batches: LearningBatch[]): FakeMain {
  const main: FakeMain = {
    batches,
    begins: [],
    finished: [],
    abandoned: [],
    state: { recent: [], pending: [], ruledOut: [], questions: [], lastRun: 0, rebuild: null },
  };
  const bridge: Partial<Bridge> = {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      switch (channel) {
        case PersonaLearningChannel.State as string:
          return Promise.resolve(main.state as T);
        case PersonaLearningChannel.Begin as string:
          main.begins.push(args[0]);
          return Promise.resolve((main.batches.shift() ?? null) as T);
        case PersonaLearningChannel.Finish as string: {
          const request: LearningFinishRequest = args[0] as LearningFinishRequest;
          main.finished.push(request);
          const outcome: LearningOutcome = {
            applied: request.review === 'automatic' ? request.proposal.changes.length : 0,
            pending: request.review === 'ask' ? request.proposal.changes.length : 0,
            refused: 0,
            messagesRead: 1,
          };
          return Promise.resolve(outcome as T);
        }
        case PersonaLearningChannel.Abandon as string:
          main.abandoned.push(args[0] as string);
          return Promise.resolve(undefined as T);
        default:
          return Promise.resolve(undefined as T);
      }
    },
    on: (): (() => void) => (): void => undefined,
  };
  (window as unknown as { bridge?: Partial<Bridge> }).bridge = bridge;
  return main;
}

/**
 * Builds a batch.
 * @param batchId The id.
 * @returns Returns the batch.
 */
function batch(batchId: string): LearningBatch {
  return {
    batchId,
    persona: [],
    ruledOut: [],
    openQuestions: [],
    excerpts: [
      { conversationId: 'c', messageIds: ['u1'], messages: ["Just tell me which you'd pick."] },
    ],
  };
}

describe('PersonaLearning (#1516)', () => {
  let answers: string[];
  let prompts: AiOneShotRequest[];

  beforeEach(() => {
    answers = [];
    prompts = [];
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AiOneShot,
          useValue: {
            isAvailable: true,
            complete: (request: AiOneShotRequest): Promise<AiOneShotResult> => {
              prompts.push(request);
              const text: string | undefined = answers.shift();
              return Promise.resolve(
                text === undefined
                  ? { text: null, error: 'Model unavailable.' }
                  : { text, error: null },
              );
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  /**
   * Chooses a connection for persona learning.
   * @param review How its changes land.
   */
  function turnOn(review: 'ask' | 'automatic' = 'ask'): void {
    const settings: Settings = TestBed.inject(Settings);
    settings.set('persona.learningConnectionId', 'local-ollama');
    settings.set('persona.learningModel', 'qwen3:4b');
    settings.set('persona.review', review);
  }

  it('tick_doesNothingUntilAConnectionIsChosen', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    const learning: PersonaLearning = TestBed.inject(PersonaLearning);

    await learning.tick();

    expect(main.begins).toEqual([]);
  });

  it('tick_whenPaused_doesNothing', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    const learning: PersonaLearning = TestBed.inject(PersonaLearning);
    turnOn();
    TestBed.inject(Settings).set('persona.learningPaused', true);

    await learning.tick();

    expect(main.begins).toEqual([]);
  });

  it('tick_readsEachBatchWithTheChosenModel_andHandsBackWhatItProposed', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    const learning: PersonaLearning = TestBed.inject(PersonaLearning);
    turnOn('ask');
    answers.push('{"changes":[{"op":"add","name":"One","text":"Prefers one."}],"questions":[]}');

    await learning.tick();

    // It asks again after each batch, until there are none left.
    expect(main.begins[0]).toEqual({ idleMinutes: 30, conversationId: null, rebuild: false });
    expect(main.begins).toHaveLength(2);
    expect(prompts[0]).toMatchObject({
      providerId: 'local-ollama',
      model: 'qwen3:4b',
      surface: 'models',
    });
    expect(prompts[0].prompt).toContain("> Just tell me which you'd pick.");
    expect(main.finished).toEqual([
      {
        batchId: 'b1',
        review: 'ask',
        proposal: { changes: [{ op: 'add', name: 'One', text: 'Prefers one.' }], questions: [] },
      },
    ]);
  });

  it('aBadAnswer_givesTheBatchBack_andReportsWhy', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    const learning: PersonaLearning = TestBed.inject(PersonaLearning);
    turnOn();
    answers.push('I could not decide.');
    const summaries: LearningRunSummary[] = [];
    learning.onFinished((summary: LearningRunSummary): number => summaries.push(summary));

    await learning.tick();

    expect(main.abandoned).toEqual(['b1']);
    expect(main.finished).toEqual([]);
    expect(summaries[0].error).toContain('expected form');
  });

  it('learnNow_readsTheOneConversationWhetherIdleOrNot', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    const learning: PersonaLearning = TestBed.inject(PersonaLearning);
    turnOn('automatic');
    answers.push('{"changes":[],"questions":[]}');

    const summary: LearningRunSummary = await learning.learnNow('c42');

    expect(main.begins[0]).toEqual({ idleMinutes: 0, conversationId: 'c42', rebuild: false });
    expect(summary).toEqual({ applied: 0, pending: 0, refused: 0, messagesRead: 1, error: null });
  });

  it('learnNow_whenOff_saysWhereToTurnItOn', async () => {
    installBridge([]);
    const learning: PersonaLearning = TestBed.inject(PersonaLearning);

    expect((await learning.learnNow('c42')).error).toContain('Settings › AI Manager › Persona');
  });

  it('rebuild_readsEveryBatchWithItsOwnModel_untilNothingIsLeft_evenWithLearningOff', async () => {
    const main: FakeMain = installBridge([
      batch('b1'),
      batch('b2'),
      batch('b3'),
      batch('b4'),
      batch('b5'),
    ]);
    main.state = {
      ...main.state,
      rebuild: {
        mode: 'merge',
        connectionId: 'opus',
        model: 'big',
        startedAt: 0,
        total: 5,
        done: [],
      },
    };
    const learning: PersonaLearning = TestBed.inject(PersonaLearning);
    answers.push(...Array.from({ length: 5 }, (): string => '{"changes":[],"questions":[]}'));

    await learning.tick();

    expect(main.finished.map((request) => request.batchId)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(
      main.begins.every((begin: unknown): boolean => (begin as { rebuild: boolean }).rebuild),
    ).toBe(true);
    expect(
      prompts.every(
        (prompt: AiOneShotRequest): boolean =>
          prompt.providerId === 'opus' && prompt.model === 'big',
      ),
    ).toBe(true);
  });

  it('rebuild_whenPaused_waits', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    main.state = {
      ...main.state,
      rebuild: { mode: 'merge', connectionId: 'opus', model: '', startedAt: 0, total: 1, done: [] },
    };
    const learning: PersonaLearning = TestBed.inject(PersonaLearning);
    TestBed.inject(Settings).set('persona.learningPaused', true);

    await learning.tick();

    expect(main.begins).toEqual([]);
  });
});
