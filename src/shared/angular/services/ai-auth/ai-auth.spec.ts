import { TestBed } from '@angular/core/testing';

import { AiChannel } from '@shared/api/ai-channels';
import type { Bridge } from '@shared/api/bridge';
import type { AiAuthStatus, AiVerifyResult } from '@shared/ai-types';
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
   * Installs a stub transport on `window.bridge` routing the agent auth channels.
   */
  function stubBridge(): void {
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (AiChannel.AuthStatus as string)) {
          return Promise.resolve(LOCAL_LOGIN as T);
        }
        if (channel === (AiChannel.SetApiKey as string)) {
          lastSetKey = args[0] as string;
          return Promise.resolve({ ...LOCAL_LOGIN, source: 'api-key', hasStoredKey: true } as T);
        }
        if (channel === (AiChannel.ClearApiKey as string)) {
          return Promise.resolve({
            ...LOCAL_LOGIN,
            source: 'none',
            available: false,
            hasStoredKey: false,
          } as T);
        }
        if (channel === (AiChannel.Verify as string)) {
          return Promise.resolve({ ok: true, detail: 'ok' } as T);
        }
        return Promise.resolve(undefined as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (globalThis as unknown as { bridge: Bridge }).bridge = bridge;
  }

  beforeEach(() => {
    lastSetKey = undefined;
  });

  afterEach(() => {
    delete (globalThis as unknown as { bridge?: unknown }).bridge;
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
