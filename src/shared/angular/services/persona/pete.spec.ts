import { TestBed } from '@angular/core/testing';
import type { Bridge } from '@shared/api/bridge';
import {
  PeteChannel,
  type PeteBatch,
  type PeteFinishRequest,
  type PeteOutcome,
  type PeteState,
} from '@shared/api/pete-protocol';
import {
  AiOneShot,
  type AiOneShotRequest,
  type AiOneShotResult,
} from '@shared/angular/services/ai-runtime/ai-one-shot';
import { Settings } from '@shared/angular/services/settings/settings';
import { Pete, type PeteRunSummary } from './pete';

/**
 * A stand-in for the main process's side of Pete.
 */
interface FakeMain {
  batches: PeteBatch[];
  begins: unknown[];
  finished: PeteFinishRequest[];
  abandoned: string[];
  state: PeteState;
}

/**
 * Installs a bridge over a fake main process.
 * @param batches The batches Begin hands out, in turn.
 * @returns Returns the fake, to inspect.
 */
function installBridge(batches: PeteBatch[]): FakeMain {
  const main: FakeMain = {
    batches,
    begins: [],
    finished: [],
    abandoned: [],
    state: { recent: [], pending: [], ruledOut: [], questions: [], lastRun: 0 },
  };
  const bridge: Partial<Bridge> = {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      switch (channel) {
        case PeteChannel.State as string:
          return Promise.resolve(main.state as T);
        case PeteChannel.Begin as string:
          main.begins.push(args[0]);
          return Promise.resolve((main.batches.shift() ?? null) as T);
        case PeteChannel.Finish as string: {
          const request: PeteFinishRequest = args[0] as PeteFinishRequest;
          main.finished.push(request);
          const outcome: PeteOutcome = {
            applied: request.review === 'automatic' ? request.proposal.changes.length : 0,
            pending: request.review === 'ask' ? request.proposal.changes.length : 0,
            refused: 0,
            messagesRead: 1,
          };
          return Promise.resolve(outcome as T);
        }
        case PeteChannel.Abandon as string:
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
function batch(batchId: string): PeteBatch {
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

describe('Pete (#1516)', () => {
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
   * Chooses a connection for Pete.
   * @param review How his changes land.
   */
  function turnOn(review: 'ask' | 'automatic' = 'ask'): void {
    const settings: Settings = TestBed.inject(Settings);
    settings.set('persona.peteConnectionId', 'local-ollama');
    settings.set('persona.peteModel', 'qwen3:4b');
    settings.set('persona.review', review);
  }

  it('tick_doesNothingUntilAConnectionIsChosen', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    const pete: Pete = TestBed.inject(Pete);

    await pete.tick();

    expect(main.begins).toEqual([]);
  });

  it('tick_whenPaused_doesNothing', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    const pete: Pete = TestBed.inject(Pete);
    turnOn();
    TestBed.inject(Settings).set('persona.petePaused', true);

    await pete.tick();

    expect(main.begins).toEqual([]);
  });

  it('tick_readsEachBatchWithTheChosenModel_andHandsBackWhatItProposed', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    const pete: Pete = TestBed.inject(Pete);
    turnOn('ask');
    answers.push('{"changes":[{"op":"add","name":"One","text":"Prefers one."}],"questions":[]}');

    await pete.tick();

    // It asks again after each batch, until there are none left.
    expect(main.begins[0]).toEqual({ idleMinutes: 30, conversationId: null });
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
    const pete: Pete = TestBed.inject(Pete);
    turnOn();
    answers.push('I could not decide.');
    const summaries: PeteRunSummary[] = [];
    pete.onFinished((summary: PeteRunSummary): number => summaries.push(summary));

    await pete.tick();

    expect(main.abandoned).toEqual(['b1']);
    expect(main.finished).toEqual([]);
    expect(summaries[0].error).toContain('expected form');
  });

  it('learnNow_readsTheOneConversationWhetherIdleOrNot', async () => {
    const main: FakeMain = installBridge([batch('b1')]);
    const pete: Pete = TestBed.inject(Pete);
    turnOn('automatic');
    answers.push('{"changes":[],"questions":[]}');

    const summary: PeteRunSummary = await pete.learnNow('c42');

    expect(main.begins[0]).toEqual({ idleMinutes: 0, conversationId: 'c42' });
    expect(summary).toEqual({ applied: 0, pending: 0, refused: 0, messagesRead: 1, error: null });
  });

  it('learnNow_whenOff_saysWhereToTurnItOn', async () => {
    installBridge([]);
    const pete: Pete = TestBed.inject(Pete);

    expect((await pete.learnNow('c42')).error).toContain('Settings › AI Manager › Persona');
  });
});
