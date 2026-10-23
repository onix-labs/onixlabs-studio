// Signs the user in to an agent provider from Studio's sign-in window, through the plugin that runs it
// (#1080).
//
// ⛔ Names no provider. This used to be `claude-login.ts`, which ran Claude's CLI from core in a hidden
// terminal and went looking in the Claude plugin's install for a copy of it. The plugin signs its own
// users in now, over the protocol's `auth` exchange; what is left here is turning that exchange into
// the window's phases, and holding the one sign-in that may run at a time.

import type { HarnessAuthState } from '@shared/api/agent-protocol';
import type { AiSignInProgress, AiSignInStatus } from '@shared/api/ai-types';
import { logger } from '../logger';
import type { AgentProvider, AgentSignIn } from './agent-provider';

/**
 * Why a sign-in could not run, when the provider's plugin cannot sign anyone in from Studio.
 */
const UNSUPPORTED_MESSAGE: string = "This provider's plugin can't sign you in from Studio.";

/**
 * Drives the sign-in window's exchanges with a provider. One sign-in runs at a time; a second start
 * while one is in flight is ignored, as the window only ever has one open.
 */
export class SignInDriver {
  /**
   * Holds the sign-in in flight, or null when none is.
   */
  private current: AgentSignIn | null = null;

  /**
   * Initializes a new instance of the {@link SignInDriver} class.
   * @param emit Sends each progress update to the sign-in window.
   */
  public constructor(private readonly emit: (progress: AiSignInProgress) => void) {}

  /**
   * Asks a provider whether its user is signed in.
   * @param provider The provider to ask.
   * @param settings Settings for the exchange beyond the provider's own.
   * @returns Returns the status: unsupported when the provider cannot say.
   */
  public async check(
    provider: AgentProvider,
    settings: Readonly<Record<string, unknown>>,
  ): Promise<AiSignInStatus> {
    if (provider.signIn === undefined) {
      return { supported: false, signedIn: false };
    }
    const state: HarnessAuthState | null = await provider
      .signIn('status', settings, (): void => undefined)
      .result.catch((): null => null);
    return toStatus(state);
  }

  /**
   * Starts signing the user in to a provider, reporting each phase.
   * @param provider The provider to sign in to.
   * @param settings Settings for the exchange beyond the provider's own.
   */
  public start(provider: AgentProvider, settings: Readonly<Record<string, unknown>>): void {
    if (this.current !== null) {
      logger.debug('SignInDriver', 'A sign-in is already running; ignoring start');
      return;
    }
    if (provider.signIn === undefined) {
      this.emit({ phase: 'error', message: UNSUPPORTED_MESSAGE });
      return;
    }
    logger.info('SignInDriver', `Signing in to ${provider.label}`);
    this.emit({ phase: 'starting' });
    const signIn: AgentSignIn = provider.signIn(
      'login',
      settings,
      (state: HarnessAuthState): void => {
        if (this.current === signIn) {
          this.emit(toProgress(state));
        }
      },
    );
    this.current = signIn;
    void signIn.result
      .catch((): null => null)
      .then((state: HarnessAuthState | null): void => {
        // A cancelled sign-in settles too, as its harness closes; the window already knows.
        if (this.current !== signIn) {
          return;
        }
        this.current = null;
        logger.info('SignInDriver', `Sign-in settled: ${state?.phase ?? 'unanswered'}`);
        this.emit(
          state === null ? { phase: 'error', message: UNSUPPORTED_MESSAGE } : toProgress(state),
        );
      });
  }

  /**
   * Cancels the sign-in in flight. No-op when none is running.
   */
  public cancel(): void {
    const signIn: AgentSignIn | null = this.current;
    if (signIn === null) {
      return;
    }
    logger.info('SignInDriver', 'Cancelling the sign-in');
    this.current = null;
    signIn.cancel();
  }

  /**
   * Signs the user out of a provider.
   * @param provider The provider to sign out of.
   * @param settings Settings for the exchange beyond the provider's own.
   * @returns Returns whether the user is now signed out.
   */
  public async signOut(
    provider: AgentProvider,
    settings: Readonly<Record<string, unknown>>,
  ): Promise<boolean> {
    if (provider.signIn === undefined) {
      return false;
    }
    const state: HarnessAuthState | null = await provider
      .signIn('logout', settings, (): void => undefined)
      .result.catch((): null => null);
    logger.info('SignInDriver', `Sign-out settled: ${state?.phase ?? 'unanswered'}`);
    return state?.phase === 'signed-out';
  }

  /**
   * Cancels any sign-in in flight (called on shutdown).
   */
  public dispose(): void {
    this.cancel();
  }
}

/**
 * Reads a settled exchange as a status.
 * @param state The state that settled it, or null when the provider could not answer.
 * @returns Returns the status.
 */
export function toStatus(state: HarnessAuthState | null): AiSignInStatus {
  if (state === null) {
    return { supported: false, signedIn: false };
  }
  if (state.phase === 'signed-in') {
    return state.account === undefined
      ? { supported: true, signedIn: true }
      : { supported: true, signedIn: true, account: state.account };
  }
  return { supported: true, signedIn: false };
}

/**
 * Reads an exchange's state as one of the sign-in window's phases.
 * @param state The state the provider reported.
 * @returns Returns the progress update.
 */
export function toProgress(state: HarnessAuthState): AiSignInProgress {
  switch (state.phase) {
    case 'starting':
      return { phase: 'starting' };
    case 'browser':
      return state.url === undefined ? { phase: 'browser' } : { phase: 'browser', url: state.url };
    case 'signed-in':
      return { phase: 'success' };
    case 'signed-out':
      return { phase: 'error', message: state.detail ?? 'Sign-in did not complete.' };
  }
}
