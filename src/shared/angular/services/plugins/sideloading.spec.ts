import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { PluginChannel, SideloadingState } from '@shared/api/plugin-channels';
import { Sideloading } from './sideloading';

describe('Sideloading', () => {
  let setCalls: unknown[];

  /**
   * Installs a stub transport on `window.bridge` that routes the sideloading channels the way the main
   * process does: a change is persisted for the next launch and leaves this launch's state alone.
   * @param initial The state the bridge reports initially.
   */
  function stubBridge(initial: SideloadingState): void {
    let current: SideloadingState = initial;
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (PluginChannel.SetSideloading as string)) {
          setCalls.push(args[0]);
          current = { ...current, enabled: args[0] as boolean };
        }
        return Promise.resolve(current as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (globalThis as unknown as { bridge: Bridge }).bridge = bridge;
  }

  beforeEach(() => {
    setCalls = [];
  });

  afterEach(() => {
    delete (globalThis as unknown as { bridge?: unknown }).bridge;
  });

  it('whenBridgeAbsent_isOff_lockedAndSkipsNothing', () => {
    const sideloading: Sideloading = TestBed.inject(Sideloading);

    expect(sideloading.enabled()).toBe(false);
    expect(sideloading.locked()).toBe(true);
    expect(sideloading.restartRequired()).toBe(false);
    expect(sideloading.state().skipped).toBe(0);
  });

  it('refresh_loadsTheStateFromTheMainProcess', async () => {
    stubBridge({ enabled: true, inForce: true, locked: true, skipped: 0 });
    const sideloading: Sideloading = TestBed.inject(Sideloading);

    await sideloading.refresh();

    expect(sideloading.enabled()).toBe(true);
    expect(sideloading.locked()).toBe(true);
  });

  it('setEnabled_forwardsTheChoice_andReportsARestartPending', async () => {
    stubBridge({ enabled: false, inForce: false, locked: false, skipped: 2 });
    const sideloading: Sideloading = TestBed.inject(Sideloading);
    await sideloading.refresh();

    await sideloading.setEnabled(true);

    expect(setCalls).toEqual([true]);
    expect(sideloading.enabled()).toBe(true);
    expect(sideloading.restartRequired()).toBe(true);
    expect(sideloading.locked()).toBe(false);
  });
});
