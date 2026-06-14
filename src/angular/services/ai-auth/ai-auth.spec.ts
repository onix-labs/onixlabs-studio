import { TestBed } from '@angular/core/testing';

import type { AiApi, AiAuthStatus, AiVerifyResult } from '../../../shared/ai-types';
import { AiAuth } from './ai-auth';

/**
 * A status fixture standing in for a local-login session.
 */
const LOCAL_LOGIN: AiAuthStatus = {
  source: 'local-login',
  available: true,
  hasStoredKey: false,
  detail: 'Using your local Claude login (~/.claude).',
};

describe('AiAuth', () => {
  let lastSetKey: string | undefined;

  /**
   * Installs a stub agent bridge on `window.studio.ai`.
   * @param overrides Partial bridge methods to override the defaults.
   */
  function stubBridge(overrides: Partial<AiApi> = {}): void {
    const api: AiApi = {
      getAuthStatus: (): Promise<AiAuthStatus> => Promise.resolve(LOCAL_LOGIN),
      setApiKey: (key: string): Promise<AiAuthStatus> => {
        lastSetKey = key;
        return Promise.resolve({ ...LOCAL_LOGIN, source: 'api-key', hasStoredKey: true });
      },
      clearApiKey: (): Promise<AiAuthStatus> =>
        Promise.resolve({ ...LOCAL_LOGIN, source: 'none', available: false, hasStoredKey: false }),
      verifyAuthentication: (): Promise<AiVerifyResult> =>
        Promise.resolve({ ok: true, detail: 'ok' }),
      ...overrides,
    };
    (globalThis as unknown as { studio: { ai: AiApi } }).studio = { ai: api };
  }

  beforeEach(() => {
    lastSetKey = undefined;
  });

  afterEach(() => {
    delete (globalThis as unknown as { studio?: unknown }).studio;
  });

  it('status_whenBridgeAbsent_reportsUnavailable', () => {
    const auth: AiAuth = TestBed.inject(AiAuth);

    expect(auth.isAvailable).toBe(false);
    expect(auth.status().source).toBe('none');
  });

  it('refresh_whenBridgePresent_updatesTheStatusSignal', async () => {
    stubBridge();
    const auth: AiAuth = TestBed.inject(AiAuth);

    const status: AiAuthStatus = await auth.refresh();

    expect(status.source).toBe('local-login');
    expect(auth.status().source).toBe('local-login');
  });

  it('setApiKey_whenCalled_forwardsTheKeyAndUpdatesStatus', async () => {
    stubBridge();
    const auth: AiAuth = TestBed.inject(AiAuth);

    const status: AiAuthStatus = await auth.setApiKey('sk-test');

    expect(lastSetKey).toBe('sk-test');
    expect(status.hasStoredKey).toBe(true);
    expect(auth.status().source).toBe('api-key');
  });

  it('clearApiKey_whenCalled_updatesStatusToNone', async () => {
    stubBridge();
    const auth: AiAuth = TestBed.inject(AiAuth);
    await auth.refresh();

    await auth.clearApiKey();

    expect(auth.status().source).toBe('none');
  });

  it('verifyAuthentication_whenBridgeAbsent_returnsNotOk', async () => {
    const auth: AiAuth = TestBed.inject(AiAuth);

    const result: AiVerifyResult = await auth.verifyAuthentication();

    expect(result.ok).toBe(false);
  });
});
