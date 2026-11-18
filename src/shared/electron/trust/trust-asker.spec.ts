import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TrustChannel,
  type TrustAnswer,
  type TrustQuestion,
  type TrustQuestionRequest,
} from '@shared/api/trust-channels';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds the IPC handlers registered.
 */
const handlers: Map<string, Handler> = vi.hoisted(() => new Map<string, Handler>());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => void handlers.set(channel, handler),
  },
}));

const { WindowTrustAsker } = await import('./trust-asker');

/**
 * The folder every test asks about.
 */
const QUESTION: TrustQuestion = { name: 'shop', folder: '/work/shop', scannable: true };

/**
 * A window as the asker uses it: what it was sent, and its `closed` listener.
 */
interface FakeWindow {
  readonly sent: TrustQuestionRequest[];
  closed: (() => void) | null;
  destroyed: boolean;
  readonly window: unknown;
}

/**
 * Builds a window the asker can put a question in.
 * @returns Returns the window.
 */
function fakeWindow(): FakeWindow {
  const fake: FakeWindow = { sent: [], closed: null, destroyed: false, window: null };
  (fake as { window: unknown }).window = {
    isDestroyed: (): boolean => fake.destroyed,
    once: (event: string, listener: () => void): void => {
      if (event === 'closed') {
        fake.closed = listener;
      }
    },
    removeListener: (): void => {
      fake.closed = null;
    },
    webContents: {
      send: (channel: string, request: TrustQuestionRequest): void => {
        if (channel === (TrustChannel.Question as string)) {
          fake.sent.push(request);
        }
      },
    },
  };
  return fake;
}

/**
 * Answers through the captured IPC handler, as the renderer would.
 * @param id The question's identifier.
 * @param answer The answer.
 * @returns Returns whether it answered a question.
 */
function answer(id: unknown, answer: unknown): unknown {
  return handlers.get(TrustChannel.Answer)?.({}, id, answer);
}

describe('WindowTrustAsker (#1504)', () => {
  let window: FakeWindow;
  let asker: InstanceType<typeof WindowTrustAsker>;

  beforeEach(() => {
    handlers.clear();
    window = fakeWindow();
    asker = new WindowTrustAsker((): never => window.window as never);
    asker.register();
  });

  it('putsTheQuestionInTheWindow_andAnswersWithTheUsersChoice', async () => {
    const asked: Promise<TrustAnswer> = asker.ask(QUESTION);

    expect(window.sent).toEqual([{ id: 1, question: QUESTION }]);
    expect(answer(1, 'scan')).toBe(true);
    expect(await asked).toBe('scan');
  });

  it('takesAnAnswerOnce_andNoneForAQuestionNeverAsked', async () => {
    const asked: Promise<TrustAnswer> = asker.ask(QUESTION);

    expect(answer(7, 'trusted')).toBe(false);
    expect(answer(1, 'restricted')).toBe(true);
    expect(answer(1, 'trusted')).toBe(false);
    expect(await asked).toBe('restricted');
  });

  it('ignoresAnAnswerThatIsNotOne', async () => {
    const asked: Promise<TrustAnswer> = asker.ask(QUESTION);

    expect(answer(1, 'yes please')).toBe(false);
    answer(1, 'trusted');

    expect(await asked).toBe('trusted');
  });

  it('aWindowClosedUnanswered_isNotTrustingTheFolder', async () => {
    const asked: Promise<TrustAnswer> = asker.ask(QUESTION);

    window.closed?.();

    expect(await asked).toBe('restricted');
  });

  it('withNoWindowToAskIn_isNotTrustingTheFolder', async () => {
    window.destroyed = true;

    expect(await asker.ask(QUESTION)).toBe('restricted');
    expect(window.sent).toEqual([]);
  });
});
