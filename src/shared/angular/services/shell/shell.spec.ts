import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { ShellChannel } from '@shared/api/shell-channels';
import { Shell } from './shell';

describe('Shell', () => {
  let calls: { channel: string; args: unknown[] }[];

  /**
   * Installs a stub transport on `window.bridge` that records the channels invoked.
   */
  function stubBridge(): void {
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        return Promise.resolve(undefined as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (globalThis as unknown as { bridge: Bridge }).bridge = bridge;
  }

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    delete (globalThis as unknown as { bridge?: unknown }).bridge;
  });

  it('openExternal_whenBridgePresent_invokesTheChannel', async () => {
    stubBridge();

    await TestBed.inject(Shell).openExternal('https://example.com');

    expect(calls).toEqual([{ channel: ShellChannel.OpenExternal, args: ['https://example.com'] }]);
  });

  it('openPath_whenBridgePresent_invokesTheChannel', async () => {
    stubBridge();

    await TestBed.inject(Shell).openPath('/tmp/file.txt');

    expect(calls).toEqual([{ channel: ShellChannel.OpenPath, args: ['/tmp/file.txt'] }]);
  });

  it('openExternal_whenBridgeAbsent_isASafeNoOp', async () => {
    // No bridge installed; the call must resolve without throwing and reach no transport.
    await TestBed.inject(Shell).openExternal('https://example.com');

    expect(calls).toEqual([]);
  });
});
