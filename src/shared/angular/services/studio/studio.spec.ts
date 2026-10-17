import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { WindowChannel } from '@shared/api/window-channels';
import { Studio } from './studio';

/**
 * A recorded bridge invocation or fire-and-forget send.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

/**
 * Holds a child-window name of the shape pop-outs and modals are opened with.
 */
const CHILD_NAME: string = 'studio-window-0b6c3d1e-8f2a-4c5b-9d7e-1a2b3c4d5e6f';

describe('Studio', () => {
  let service: Studio;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Studio);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('platform_whenRunningOutsideElectron_returnsBrowser', () => {
    expect(service.platform).toBe('browser');
  });

  it('drawsWindowControls_whenRunningOutsideElectron_isFalse', () => {
    expect(service.drawsWindowControls).toBe(false);
  });

  it('closeWindow_whenBridgeAbsent_doesNotThrow', () => {
    expect((): void => service.closeWindow()).not.toThrow();
  });

  it('isWindowMaximized_whenBridgeAbsent_resolvesFalse', async () => {
    await expect(service.isWindowMaximized()).resolves.toBe(false);
  });

  it('setCaptionSymbolColor_whenRunningOutsideElectron_doesNotThrow', () => {
    expect((): void => service.setCaptionSymbolColor('#adb5bd')).not.toThrow();
  });

  describe('window controls over the bridge', () => {
    let sends: RecordedCall[];
    let invokes: RecordedCall[];
    let bridged: Studio;

    beforeEach(() => {
      sends = [];
      invokes = [];
      const bridge: Bridge = {
        invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
          invokes.push({ channel, args });
          return Promise.resolve(true as T);
        },
        send: (channel: string, ...args: unknown[]): void => {
          // The logger writes through the same bridge; only the window channels are under test.
          if (channel.startsWith('window:')) {
            sends.push({ channel, args });
          }
        },
        on: (): (() => void) => (): void => undefined,
      };
      (window as unknown as { bridge: Bridge }).bridge = bridge;
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      bridged = TestBed.inject(Studio);
    });

    afterEach(() => {
      delete (window as unknown as { bridge?: unknown }).bridge;
    });

    it('closeWindow_forThisWindow_namesNoTarget', () => {
      bridged.closeWindow();

      expect(sends).toEqual([{ channel: WindowChannel.Close, args: [] }]);
    });

    it('minimizeWindow_forANamedChild_namesTheChild', () => {
      bridged.minimizeWindow({ name: CHILD_NAME } as Window);

      expect(sends).toEqual([{ channel: WindowChannel.Minimize, args: [CHILD_NAME] }]);
    });

    it('toggleMaximizeWindow_forANamedChild_namesTheChild', () => {
      bridged.toggleMaximizeWindow({ name: CHILD_NAME } as Window);

      expect(sends).toEqual([{ channel: WindowChannel.ToggleMaximize, args: [CHILD_NAME] }]);
    });

    // 🔥 A request naming nothing acts on the sender's own window, so a close meant for an unnamed
    // child would close the application window instead. It must send nothing at all.
    it('closeWindow_forAChildWithoutAChildName_sendsNothing', () => {
      bridged.closeWindow({ name: '' } as Window);
      bridged.closeWindow({ name: 'some-other-window' } as Window);

      expect(sends).toEqual([]);
    });

    it('isWindowMaximized_forANamedChild_asksAboutTheChild', async () => {
      await expect(bridged.isWindowMaximized({ name: CHILD_NAME } as Window)).resolves.toBe(true);

      expect(invokes).toEqual([{ channel: WindowChannel.IsMaximized, args: [CHILD_NAME] }]);
    });

    it('isWindowMaximized_forAChildWithoutAChildName_resolvesFalseWithoutAsking', async () => {
      await expect(bridged.isWindowMaximized({ name: '' } as Window)).resolves.toBe(false);

      expect(invokes).toEqual([]);
    });
  });
});
