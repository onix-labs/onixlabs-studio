import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { LspAttachDebuggerRequest, LspChannel } from '@shared/api/lsp-channels';

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

const { LspAttachDebuggerForwarder } = await import('./lsp-attach-debugger');

/**
 * A fake renderer: an event emitter recording what it was sent.
 */
type FakeContents = EventEmitter & {
  readonly sent: { channel: string; payload: LspAttachDebuggerRequest }[];
  destroyed: boolean;
};

/**
 * Builds a fake renderer.
 * @returns Returns it.
 */
function fakeContents(): FakeContents {
  const contents: FakeContents = Object.assign(new EventEmitter(), {
    sent: [] as { channel: string; payload: LspAttachDebuggerRequest }[],
    destroyed: false,
    isDestroyed(): boolean {
      return contents.destroyed;
    },
    send(channel: string, payload: LspAttachDebuggerRequest): void {
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
  ipcListeners.get(LspChannel.AttachDebuggerReply)?.({ sender }, payload);
}

describe('LspAttachDebuggerForwarder (#1150)', () => {
  let forwarder: InstanceType<typeof LspAttachDebuggerForwarder>;

  beforeEach(() => {
    vi.useFakeTimers();
    ipcListeners.clear();
    forwarder = new LspAttachDebuggerForwarder(5_000);
    forwarder.register();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asksTheRendererHoldingTheSession_andAnswersTheServerWithWhetherItAttached', async () => {
    const renderer: FakeContents = fakeContents();

    const answer: Promise<{ didAttach: boolean }> = forwarder.forward(
      '/root::csharp',
      renderer as unknown as WebContents,
      { processId: 46456 },
    );
    const sent: LspAttachDebuggerRequest | undefined = renderer.sent[0]?.payload;
    reply(renderer, { requestId: sent?.requestId, didAttach: true });

    expect(renderer.sent[0]?.channel).toBe(LspChannel.AttachDebugger);
    expect(sent).toMatchObject({ sessionId: '/root::csharp', processId: 46456 });
    expect(await answer).toEqual({ didAttach: true });
  });

  it('noProcess_orNoRenderer_hasNotAttached', async () => {
    const renderer: FakeContents = fakeContents();

    expect(
      await forwarder.forward('/root::csharp', renderer as unknown as WebContents, {
        processId: -1,
      }),
    ).toEqual({ didAttach: false });
    expect(await forwarder.forward('/root::csharp', null, { processId: 1 })).toEqual({
      didAttach: false,
    });
    expect(renderer.sent).toEqual([]);
  });

  it('aRendererThatNeverAnswers_orCloses_hasNotAttached_andAnotherWindowsAnswerIsIgnored', async () => {
    const renderer: FakeContents = fakeContents();
    const stranger: FakeContents = fakeContents();

    const silent: Promise<{ didAttach: boolean }> = forwarder.forward(
      '/root::csharp',
      renderer as unknown as WebContents,
      { processId: 1 },
    );
    reply(stranger, { requestId: renderer.sent[0]?.payload.requestId, didAttach: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await silent).toEqual({ didAttach: false });

    const closing: Promise<{ didAttach: boolean }> = forwarder.forward(
      '/root::csharp',
      renderer as unknown as WebContents,
      { processId: 2 },
    );
    renderer.emit('destroyed');
    expect(await closing).toEqual({ didAttach: false });
  });
});
