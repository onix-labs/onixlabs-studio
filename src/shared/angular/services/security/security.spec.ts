import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { ImageSourcePolicy, SecurityChannel } from '@shared/api/security-channels';
import { Security } from './security';

describe('Security', () => {
  let setCalls: ImageSourcePolicy[];

  /**
   * Installs a stub transport on `window.bridge` that routes the security channels.
   * @param initial The policy the bridge reports initially.
   */
  function stubBridge(initial: ImageSourcePolicy): void {
    let current: ImageSourcePolicy = initial;
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (SecurityChannel.SetImagePolicy as string)) {
          current = args[0] as ImageSourcePolicy;
          setCalls.push(current);
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

  it('isAvailable_whenBridgeAbsent_isFalse', () => {
    expect(TestBed.inject(Security).isAvailable).toBe(false);
  });

  it('imagePolicy_whenBridgeAbsent_defaultsToLocal', () => {
    expect(TestBed.inject(Security).imagePolicy()).toBe('local');
  });

  it('refresh_whenCalled_loadsThePolicy', async () => {
    stubBridge('https');
    const security: Security = TestBed.inject(Security);

    await security.refresh();

    expect(security.imagePolicy()).toBe('https');
  });

  it('setImagePolicy_whenCalled_storesAndReflectsIt', async () => {
    stubBridge('local');
    const security: Security = TestBed.inject(Security);

    await security.setImagePolicy('all');

    expect(setCalls).toEqual(['all']);
    expect(security.imagePolicy()).toBe('all');
  });
});
