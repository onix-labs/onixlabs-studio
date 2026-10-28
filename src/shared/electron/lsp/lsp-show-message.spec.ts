import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { LspChannel, LspShowMessageRequest } from '@shared/api/lsp-channels';

/**
 * The listeners registered on the mocked `ipcMain`, so a spec can play the renderer's answer.
 */
const ipcListeners: Map<string, (event: unknown, payload: unknown) => void> = new Map<
  string,
  (event: unknown, payload: unknown) => void
>();

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (event: unknown, payload: unknown) => void): void => {
      ipcListeners.set(channel, listener);
    },
  },
}));

const { LspShowMessageForwarder } = await import('./lsp-show-message');

/**
 * A fake renderer: an event emitter recording what it was sent.
 */
type FakeContents = EventEmitter & {
  readonly sent: { channel: string; payload: LspShowMessageRequest }[];
  destroyed: boolean;
};

/**
 * Builds a fake renderer.
 * @returns Returns it.
 */
function fakeContents(): FakeContents {
  const contents: FakeContents = Object.assign(new EventEmitter(), {
    sent: [] as { channel: string; payload: LspShowMessageRequest }[],
    destroyed: false,
    isDestroyed(): boolean {
      return contents.destroyed;
    },
    send(channel: string, payload: LspShowMessageRequest): void {
      contents.sent.push({ channel, payload });
    },
  });
  return contents;
}

/**
 * Plays a renderer's answer on the reply channel.
 * @param sender The renderer answering.
 * @param payload The answer.
 */
function reply(sender: FakeContents, payload: unknown): void {
  ipcListeners.get(LspChannel.ShowMessageReply)?.({ sender }, payload);
}

describe('LspShowMessageForwarder (#1154)', () => {
  const QUESTION: unknown = {
    type: 2,
    message: 'Import the Gradle project?',
    actions: [{ title: 'Import', id: 'import' }, { title: 'Never' }],
  };
  let forwarder: InstanceType<typeof LspShowMessageForwarder>;

  beforeEach(() => {
    vi.useFakeTimers();
    ipcListeners.clear();
    forwarder = new LspShowMessageForwarder(5_000);
    forwarder.register();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('putsTheQuestionToTheRendererHoldingTheSession_andAnswersWithTheChosenActionAsSent', async () => {
    const renderer: FakeContents = fakeContents();

    const answer: Promise<unknown> = forwarder.forward(
      '/root::java',
      renderer as unknown as WebContents,
      QUESTION,
    );
    const sent: LspShowMessageRequest | undefined = renderer.sent[0]?.payload;
    reply(renderer, { requestId: sent?.requestId, action: 0 });

    expect(renderer.sent[0]?.channel).toBe(LspChannel.ShowMessage);
    expect(sent).toMatchObject({
      sessionId: '/root::java',
      type: 2,
      message: 'Import the Gradle project?',
      actions: ['Import', 'Never'],
    });
    expect(await answer).toEqual({ title: 'Import', id: 'import' });
  });

  it('aDismissal_anActionNotOffered_orAnotherWindowsAnswer_isNull', async () => {
    const renderer: FakeContents = fakeContents();
    const stranger: FakeContents = fakeContents();

    const dismissed: Promise<unknown> = forwarder.forward(
      '/root::java',
      renderer as unknown as WebContents,
      QUESTION,
    );
    reply(stranger, { requestId: renderer.sent[0]?.payload.requestId, action: 0 });
    reply(renderer, { requestId: renderer.sent[0]?.payload.requestId, action: null });
    expect(await dismissed).toBeNull();

    const outOfRange: Promise<unknown> = forwarder.forward(
      '/root::java',
      renderer as unknown as WebContents,
      QUESTION,
    );
    reply(renderer, { requestId: renderer.sent[1]?.payload.requestId, action: 7 });
    expect(await outOfRange).toBeNull();
  });

  it('noMessage_noRenderer_aClosingRenderer_orNoAnswer_isNull', async () => {
    const renderer: FakeContents = fakeContents();

    expect(
      await forwarder.forward('/root::java', renderer as unknown as WebContents, { type: 3 }),
    ).toBeNull();
    expect(await forwarder.forward('/root::java', null, QUESTION)).toBeNull();
    expect(renderer.sent).toEqual([]);

    const closing: Promise<unknown> = forwarder.forward(
      '/root::java',
      renderer as unknown as WebContents,
      QUESTION,
    );
    renderer.emit('destroyed');
    expect(await closing).toBeNull();

    const silent: Promise<unknown> = forwarder.forward(
      '/root::java',
      renderer as unknown as WebContents,
      QUESTION,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await silent).toBeNull();
  });
});
