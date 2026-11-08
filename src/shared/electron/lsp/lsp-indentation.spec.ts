import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { LspChannel, LspIndentationRequest } from '@shared/api/lsp-channels';

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

const { LspIndentationForwarder } = await import('./lsp-indentation');

/**
 * A fake renderer: an event emitter recording what it was sent.
 */
type FakeContents = EventEmitter & {
  readonly sent: { channel: string; payload: LspIndentationRequest }[];
  destroyed: boolean;
};

/**
 * Builds a fake renderer.
 * @returns Returns it.
 */
function fakeContents(): FakeContents {
  const contents: FakeContents = Object.assign(new EventEmitter(), {
    sent: [] as { channel: string; payload: LspIndentationRequest }[],
    destroyed: false,
    isDestroyed(): boolean {
      return contents.destroyed;
    },
    send(channel: string, payload: LspIndentationRequest): void {
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
  ipcListeners.get(LspChannel.IndentationReply)?.({ sender }, payload);
}

/**
 * jdtls's sections.
 */
const SECTIONS: { tabSize: string; insertSpaces: string } = {
  tabSize: 'java.format.tabSize',
  insertSpaces: 'java.format.insertSpaces',
};

/**
 * What jdtls asks for each file it opens, recorded from jdtls 1.58.0.
 */
const ITEMS: readonly unknown[] = [
  { scopeUri: 'file:///root/Shapes.java', section: 'java.format.tabSize' },
  { scopeUri: 'file:///root/Shapes.java', section: 'java.format.insertSpaces' },
];

describe('LspIndentationForwarder (#1208)', () => {
  let forwarder: InstanceType<typeof LspIndentationForwarder>;

  beforeEach(() => {
    vi.useFakeTimers();
    ipcListeners.clear();
    forwarder = new LspIndentationForwarder(2_000);
    forwarder.register();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asksTheRendererOncePerDocument_andAnswersBothItemsFromIt', async () => {
    const renderer: FakeContents = fakeContents();

    const answers: Promise<unknown[]> = forwarder.fill(
      '/root::java',
      renderer as unknown as WebContents,
      SECTIONS,
      ITEMS,
      [null, null],
    );
    expect(renderer.sent).toHaveLength(1);
    expect(renderer.sent[0].payload).toMatchObject({
      sessionId: '/root::java',
      uri: 'file:///root/Shapes.java',
    });
    reply(renderer, {
      requestId: renderer.sent[0].payload.requestId,
      tabSize: 2,
      insertSpaces: true,
    });

    expect(await answers).toEqual([2, true]);
  });

  it('leavesTheOtherItemsAsTheyWereAnswered', async () => {
    const renderer: FakeContents = fakeContents();
    const items: unknown[] = [{ section: 'java.signatureHelp.enabled' }, ITEMS[0]];

    const answers: Promise<unknown[]> = forwarder.fill(
      '/root::java',
      renderer as unknown as WebContents,
      SECTIONS,
      items,
      [true, null],
    );
    reply(renderer, {
      requestId: renderer.sent[0].payload.requestId,
      tabSize: 4,
      insertSpaces: false,
    });

    expect(await answers).toEqual([true, 4]);
  });

  it('aRendererThatNeverAnswers_leavesTheServerItsDefault', async () => {
    const renderer: FakeContents = fakeContents();

    const answers: Promise<unknown[]> = forwarder.fill(
      '/root::java',
      renderer as unknown as WebContents,
      SECTIONS,
      ITEMS,
      [null, null],
    );
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await answers).toEqual([null, null]);
  });

  it('noRenderer_isNotAsked', async () => {
    expect(await forwarder.fill('/root::java', null, SECTIONS, ITEMS, [null, null])).toEqual([
      null,
      null,
    ]);
  });

  it('anAnswerFromAnotherRenderer_orOutOfRange_isIgnored', async () => {
    const renderer: FakeContents = fakeContents();
    const stranger: FakeContents = fakeContents();

    const answers: Promise<unknown[]> = forwarder.fill(
      '/root::java',
      renderer as unknown as WebContents,
      SECTIONS,
      ITEMS,
      [null, null],
    );
    const requestId: string = renderer.sent[0].payload.requestId;
    reply(stranger, { requestId, tabSize: 8, insertSpaces: false });
    reply(renderer, { requestId, tabSize: 999, insertSpaces: 'yes' });

    expect(await answers).toEqual([null, null]);
  });

  it('anItemWithNoFileScope_isNotAskedAbout', async () => {
    const renderer: FakeContents = fakeContents();

    const answers: unknown[] = await forwarder.fill(
      '/root::java',
      renderer as unknown as WebContents,
      SECTIONS,
      [{ section: 'java.format.tabSize' }],
      [null],
    );

    expect(renderer.sent).toHaveLength(0);
    expect(answers).toEqual([null]);
  });
});
