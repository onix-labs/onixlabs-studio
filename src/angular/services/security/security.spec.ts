import { TestBed } from '@angular/core/testing';

import type { ImageSourcePolicy, SecurityApi } from '../../../shared/security-types';
import { Security } from './security';

describe('Security', () => {
  let setCalls: ImageSourcePolicy[];

  /**
   * Installs a stub security bridge on `window.studio.security`.
   * @param initial The policy the bridge reports initially.
   */
  function stubBridge(initial: ImageSourcePolicy): void {
    let current: ImageSourcePolicy = initial;
    const api: SecurityApi = {
      getImagePolicy: (): Promise<ImageSourcePolicy> => Promise.resolve(current),
      setImagePolicy: (policy: ImageSourcePolicy): Promise<ImageSourcePolicy> => {
        current = policy;
        setCalls.push(policy);
        return Promise.resolve(current);
      },
    };
    (globalThis as unknown as { studio: { security: SecurityApi } }).studio = { security: api };
  }

  beforeEach(() => {
    setCalls = [];
  });

  afterEach(() => {
    delete (globalThis as unknown as { studio?: unknown }).studio;
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
