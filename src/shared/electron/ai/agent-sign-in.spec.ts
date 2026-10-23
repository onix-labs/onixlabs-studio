import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessAuthAction, HarnessAuthState } from '@shared/api/agent-protocol';
import type { AiSignInProgress } from '@shared/api/ai-types';
import type { AgentProvider, AgentSignIn } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { SignInDriver, toProgress, toStatus } = await import('./agent-sign-in');

/**
 * An exchange a test settles by hand.
 */
interface FakeExchange {
  readonly action: HarnessAuthAction;
  readonly progress: (state: HarnessAuthState) => void;
  readonly settle: (state: HarnessAuthState | null) => void;
  cancelled: boolean;
}

/**
 * A provider whose sign-in exchanges a test settles by hand.
 */
class FakeProvider {
  /**
   * Holds the provider's label.
   */
  public readonly label: string = 'Claude';

  /**
   * Holds each exchange started, with its controls.
   */
  public readonly exchanges: FakeExchange[] = [];

  /**
   * Starts an exchange.
   * @param action What to do.
   * @param _settings Ignored.
   * @param onProgress Receives the exchange's progress.
   * @returns Returns the exchange.
   */
  public signIn(
    action: HarnessAuthAction,
    _settings: Readonly<Record<string, unknown>>,
    onProgress: (state: HarnessAuthState) => void,
  ): AgentSignIn {
    let settle: (state: HarnessAuthState | null) => void = (): void => undefined;
    const result: Promise<HarnessAuthState | null> = new Promise<HarnessAuthState | null>(
      (resolve): void => {
        settle = resolve;
      },
    );
    const exchange: FakeExchange = { action, progress: onProgress, settle, cancelled: false };
    this.exchanges.push(exchange);
    return {
      result,
      cancel: (): void => {
        exchange.cancelled = true;
        settle(null);
      },
    };
  }
}

/**
 * Lets the promise callbacks queued so far run.
 * @returns Returns once they have.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve): void => void setTimeout(resolve, 0));
}

describe('toStatus', () => {
  it('readsAnUnansweredExchangeAsUnsupported', () => {
    // ⛔ Not "signed out": a plugin that cannot say must not open a window that cannot sign anyone in.
    expect(toStatus(null)).toEqual({ supported: false, signedIn: false });
  });

  it('carriesTheAccountOfASignedInUser', () => {
    expect(toStatus({ phase: 'signed-in', account: 'someone@example.com' })).toEqual({
      supported: true,
      signedIn: true,
      account: 'someone@example.com',
    });
    expect(toStatus({ phase: 'signed-out' })).toEqual({ supported: true, signedIn: false });
  });
});

describe('toProgress', () => {
  it('mapsEachStateToTheWindowsPhases', () => {
    expect(toProgress({ phase: 'starting' })).toEqual({ phase: 'starting' });
    expect(toProgress({ phase: 'browser', url: 'https://example.com' })).toEqual({
      phase: 'browser',
      url: 'https://example.com',
    });
    expect(toProgress({ phase: 'signed-in' })).toEqual({ phase: 'success' });
    expect(toProgress({ phase: 'signed-out', detail: 'Cancelled.' })).toEqual({
      phase: 'error',
      message: 'Cancelled.',
    });
    expect(toProgress({ phase: 'signed-out' })).toEqual({
      phase: 'error',
      message: 'Sign-in did not complete.',
    });
  });
});

describe('SignInDriver', () => {
  let provider: FakeProvider;
  let emitted: AiSignInProgress[];
  let driver: InstanceType<typeof SignInDriver>;

  beforeEach(() => {
    provider = new FakeProvider();
    emitted = [];
    driver = new SignInDriver((progress: AiSignInProgress): void => void emitted.push(progress));
  });

  it('start_streamsTheProvidersProgressAndItsSettlement', async () => {
    driver.start(provider as unknown as AgentProvider, {});
    provider.exchanges[0].progress({ phase: 'browser', url: 'https://example.com' });
    provider.exchanges[0].settle({ phase: 'signed-in' });
    await flush();

    expect(provider.exchanges[0].action).toBe('login');
    expect(emitted).toEqual([
      { phase: 'starting' },
      { phase: 'browser', url: 'https://example.com' },
      { phase: 'success' },
    ]);
  });

  it('start_saysThePluginCannotSignInWhenItDoesNotAnswer', async () => {
    driver.start(provider as unknown as AgentProvider, {});
    provider.exchanges[0].settle(null);
    await flush();

    expect(emitted.at(-1)).toEqual({
      phase: 'error',
      message: "This provider's plugin can't sign you in from Studio.",
    });
  });

  it('start_runsOneSignInAtATime', () => {
    driver.start(provider as unknown as AgentProvider, {});
    driver.start(provider as unknown as AgentProvider, {});

    expect(provider.exchanges).toHaveLength(1);
  });

  it('cancel_stopsTheExchangeAndStaysSilent', async () => {
    // The window that cancelled already knows; a late "error" would flash in the next one it opens.
    driver.start(provider as unknown as AgentProvider, {});
    driver.cancel();
    await flush();

    expect(provider.exchanges[0].cancelled).toBe(true);
    expect(emitted).toEqual([{ phase: 'starting' }]);
  });

  it('start_saysSoForAProviderWithNoSignIn', () => {
    driver.start({ label: 'Local' } as unknown as AgentProvider, {});

    expect(emitted).toEqual([
      { phase: 'error', message: "This provider's plugin can't sign you in from Studio." },
    ]);
  });

  it('check_asksForTheStatus', async () => {
    const checking: Promise<unknown> = driver.check(provider as unknown as AgentProvider, {});
    provider.exchanges[0].settle({ phase: 'signed-out' });

    expect(provider.exchanges[0].action).toBe('status');
    await expect(checking).resolves.toEqual({ supported: true, signedIn: false });
  });

  it('signOut_reportsWhetherTheUserIsNowSignedOut', async () => {
    const signingOut: Promise<boolean> = driver.signOut(provider as unknown as AgentProvider, {});
    provider.exchanges[0].settle({ phase: 'signed-out' });

    expect(provider.exchanges[0].action).toBe('logout');
    await expect(signingOut).resolves.toBe(true);
  });
});
