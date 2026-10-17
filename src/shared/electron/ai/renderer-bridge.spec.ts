import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { AiChannel } from '@shared/api/ai-channels';

/**
 * The listeners registered on the mocked `ipcMain`, so a spec can play the renderer's reply.
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

const { RendererBridge } = await import('./renderer-bridge');

/**
 * A fake window whose web contents is an event emitter recording what it was sent.
 */
interface FakeWindow {
  /**
   * Gets the window, typed as the bridge sees it.
   */
  readonly window: BrowserWindow;

  /**
   * Gets the fake web contents.
   */
  readonly contents: EventEmitter & {
    readonly sent: { channel: string; payload: { requestId: string } }[];
  };
}

/**
 * Builds a fake window.
 * @returns Returns the window and its contents.
 */
function fakeWindow(): FakeWindow {
  const contents: FakeWindow['contents'] = Object.assign(new EventEmitter(), {
    sent: [] as { channel: string; payload: { requestId: string } }[],
    isDestroyed: (): boolean => false,
    send(channel: string, payload: { requestId: string }): void {
      contents.sent.push({ channel, payload });
    },
  });
  const window: BrowserWindow = {
    isDestroyed: (): boolean => false,
    webContents: contents,
  } as unknown as BrowserWindow;
  return { window, contents };
}

describe('RendererBridge', () => {
  let fake: FakeWindow;
  let bridge: InstanceType<typeof RendererBridge>;

  beforeEach(() => {
    ipcListeners.clear();
    fake = fakeWindow();
    bridge = new RendererBridge((): BrowserWindow => fake.window);
    bridge.register();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Plays the renderer's reply to the most recent request.
   * @param reply The reply's outcome fields.
   */
  function reply(reply: Record<string, unknown>): void {
    const requestId: string = fake.contents.sent[fake.contents.sent.length - 1].payload.requestId;
    ipcListeners.get(AiChannel.BridgeReply)!({}, { requestId, ...reply });
  }

  it('resolvesWithTheRenderersReply_andReleasesTheWindowListeners', async () => {
    const result: Promise<unknown> = bridge.request('read', {});
    reply({ ok: true, result: 'text' });

    await expect(result).resolves.toBe('text');
    expect(fake.contents.listenerCount('destroyed')).toBe(0);
    expect(fake.contents.listenerCount('render-process-gone')).toBe(0);
  });

  it('rejectsEveryPendingRequest_atOnce_whenTheWindowIsDestroyed', async () => {
    // #980 S12: a closed window never replies; the run must not wait out the timeout.
    const first: Promise<unknown> = bridge.request('read', {});
    const second: Promise<unknown> = bridge.request('write', {}, 60_000);
    fake.contents.emit('destroyed');

    await expect(first).rejects.toThrow(/window closed before the capability "read"/);
    await expect(second).rejects.toThrow(/window closed before the capability "write"/);
    expect(fake.contents.listenerCount('destroyed')).toBe(0);
  });

  it('rejectsAPendingRequest_whenTheRendererProcessGoes', async () => {
    const result: Promise<unknown> = bridge.request('read', {});
    fake.contents.emit('render-process-gone', {}, { reason: 'crashed' });

    await expect(result).rejects.toThrow(/window closed/);
  });

  it('timesOut_andALateReplyIsIgnored', async () => {
    vi.useFakeTimers();
    const result: Promise<unknown> = bridge.request('read', {}, 100);
    const settled: Promise<unknown> = expect(result).rejects.toThrow(/timed out/);
    vi.advanceTimersByTime(100);
    await settled;

    expect((): void => reply({ ok: true, result: 'late' })).not.toThrow();
    expect(fake.contents.listenerCount('destroyed')).toBe(0);
  });

  it('refusesARequest_whenTheWindowIsAlreadyDestroyed', async () => {
    const destroyed: BrowserWindow = {
      isDestroyed: (): boolean => true,
      webContents: fake.contents,
    } as unknown as BrowserWindow;
    const closed: InstanceType<typeof RendererBridge> = new RendererBridge(
      (): BrowserWindow => destroyed,
    );

    await expect(closed.request('read', {})).rejects.toThrow(/No window is available/);
    expect(fake.contents.sent).toEqual([]);
  });
});
