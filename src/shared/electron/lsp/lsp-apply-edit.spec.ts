import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { LspApplyEditRequest, LspChannel } from '@shared/api/lsp-channels';

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

const { LspApplyEditForwarder } = await import('./lsp-apply-edit');
type ApplyEditResult = import('./lsp-apply-edit').ApplyEditResult;

/**
 * A fake renderer: an event emitter recording what it was sent.
 */
type FakeContents = EventEmitter & {
  readonly sent: { channel: string; payload: LspApplyEditRequest }[];
  destroyed: boolean;
};

/**
 * Builds a fake renderer.
 * @returns Returns it.
 */
function fakeContents(): FakeContents {
  const contents: FakeContents = Object.assign(new EventEmitter(), {
    sent: [] as { channel: string; payload: LspApplyEditRequest }[],
    destroyed: false,
    isDestroyed(): boolean {
      return contents.destroyed;
    },
    send(channel: string, payload: LspApplyEditRequest): void {
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
  ipcListeners.get(LspChannel.ApplyEditReply)?.({ sender }, payload);
}

describe('LspApplyEditForwarder (#1015)', () => {
  beforeEach(() => {
    ipcListeners.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwardsTheEditToTheRenderer_andAnswersTheServerWithWhatItReports', async () => {
    const forwarder: InstanceType<typeof LspApplyEditForwarder> = new LspApplyEditForwarder();
    forwarder.register();
    const contents: FakeContents = fakeContents();
    const edit: unknown = { changes: { 'file:///ws/a.ts': [] } };

    const answer: Promise<ApplyEditResult> = forwarder.forward(
      's1',
      contents as unknown as WebContents,
      { label: 'Rename', edit },
    );
    const sent: { channel: string; payload: LspApplyEditRequest } | undefined = contents.sent[0];
    expect(sent?.channel).toBe(LspChannel.ApplyEdit);
    expect(typeof sent?.payload.requestId).toBe('string');
    expect(sent?.payload).toEqual({
      requestId: sent?.payload.requestId,
      sessionId: 's1',
      label: 'Rename',
      edit,
    });
    reply(contents, {
      requestId: sent?.payload.requestId,
      applied: false,
      failureReason: 'b.ts: It is outside the workspace.',
    });

    await expect(answer).resolves.toEqual({
      applied: false,
      failureReason: 'b.ts: It is outside the workspace.',
    });
  });

  it('takesOnlyTheAnswerOfTheRendererItSentTo', async () => {
    const forwarder: InstanceType<typeof LspApplyEditForwarder> = new LspApplyEditForwarder();
    forwarder.register();
    const contents: FakeContents = fakeContents();
    const other: FakeContents = fakeContents();
    const answer: Promise<ApplyEditResult> = forwarder.forward(
      's1',
      contents as unknown as WebContents,
      { edit: {} },
    );
    const requestId: string = contents.sent[0]?.payload.requestId ?? '';

    reply(other, { requestId, applied: true });
    reply(contents, { requestId, applied: true });

    await expect(answer).resolves.toEqual({ applied: true });
  });

  it('answersNotApplied_forAMalformedEdit_noWindow_aClosedWindow_orNoAnswerInTime', async () => {
    const forwarder: InstanceType<typeof LspApplyEditForwarder> = new LspApplyEditForwarder(1000);
    forwarder.register();
    const closing: FakeContents = fakeContents();
    const silent: FakeContents = fakeContents();

    await expect(forwarder.forward('s1', fakeContents() as never, { edit: 3 })).resolves.toEqual({
      applied: false,
      failureReason: 'The edit was malformed.',
    });
    await expect(forwarder.forward('s1', null, { edit: {} })).resolves.toEqual({
      applied: false,
      failureReason: 'No window is open to apply it.',
    });
    const closed: Promise<ApplyEditResult> = forwarder.forward('s1', closing as never, {
      edit: {},
    });
    closing.emit('destroyed');
    await expect(closed).resolves.toEqual({ applied: false, failureReason: 'The window closed.' });
    const timedOut: Promise<ApplyEditResult> = forwarder.forward('s1', silent as never, {
      edit: {},
    });
    vi.advanceTimersByTime(1000);
    await expect(timedOut).resolves.toEqual({
      applied: false,
      failureReason: 'The edit timed out.',
    });
  });

  it('dispose_answersEveryWaitingEditAsNotApplied', async () => {
    const forwarder: InstanceType<typeof LspApplyEditForwarder> = new LspApplyEditForwarder();
    const answer: Promise<ApplyEditResult> = forwarder.forward('s1', fakeContents() as never, {
      edit: {},
    });

    forwarder.dispose();

    await expect(answer).resolves.toEqual({
      applied: false,
      failureReason: 'Studio is closing.',
    });
  });
});
