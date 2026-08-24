import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Bridge } from '@shared/api/bridge';
import { ForgeChannel, ForgeClient } from '@shared/api/forge-channels';
import {
  ForgeAuthStatus,
  ForgeIssue,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';

/**
 * The status reported when the backend is not reachable at all — running as a plain web app, or under
 * tests. Distinct from "not signed in": there is nothing here to sign in to.
 */
const UNAVAILABLE: ForgeAuthStatus = {
  source: 'none',
  authenticated: false,
  hasStoredToken: false,
  identity: null,
  detail: 'Forge integration is unavailable outside the desktop application.',
};

/**
 * The result returned when the backend is not reachable, so callers get the same shape they would from
 * a genuine failure rather than needing an environment check of their own.
 */
const UNAVAILABLE_RESULT: ForgeResult<never> = {
  ok: false,
  error: UNAVAILABLE.detail,
  unauthorized: false,
};

/**
 * The renderer client for the forge backend contribution (#432): a thin, typed wrapper over the generic
 * {@link Bridge} that names the {@link ForgeChannel} channels so no view touches `window.bridge`
 * directly.
 *
 * There is deliberately no way to read a token here. Storing and clearing one are requests the main
 * process acts on; what comes back is a {@link ForgeAuthStatus}, which says who the credential belongs
 * to and where it came from but never what it is.
 */
@Service()
export class Forge implements ForgeClient {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets a value indicating whether the forge backend is reachable at all.
   */
  public readonly isAvailable: boolean = window.bridge !== undefined;

  /**
   * Resolves a git remote URL to the repository it names on a forge.
   * @param remoteUrl The remote's URL, in any form git writes it.
   * @returns Returns the repository reference, or null when the URL names no forge Studio can talk to.
   */
  public detect(remoteUrl: string): Promise<ForgeRepositoryRef | null> {
    return (
      this.bridge?.invoke<ForgeRepositoryRef | null>(ForgeChannel.Detect, remoteUrl) ??
      Promise.resolve(null)
    );
  }

  /**
   * Reads the current authentication status.
   * @returns Returns the status.
   */
  public authStatus(): Promise<ForgeAuthStatus> {
    return (
      this.bridge?.invoke<ForgeAuthStatus>(ForgeChannel.AuthStatus) ?? Promise.resolve(UNAVAILABLE)
    );
  }

  /**
   * Stores a personal access token.
   * @param token The token to store; a blank token clears it instead.
   * @returns Returns the resulting status.
   */
  public setToken(token: string): Promise<ForgeAuthStatus> {
    // Deliberately not logged, not even at trace: the argument is the secret.
    this.log.info('forge', 'Storing a forge token');
    return (
      this.bridge?.invoke<ForgeAuthStatus>(ForgeChannel.SetToken, token) ??
      Promise.resolve(UNAVAILABLE)
    );
  }

  /**
   * Clears the stored token.
   * @returns Returns the resulting status, which may still be authenticated when a CLI login remains.
   */
  public clearToken(): Promise<ForgeAuthStatus> {
    this.log.info('forge', 'Clearing the stored forge token');
    return (
      this.bridge?.invoke<ForgeAuthStatus>(ForgeChannel.ClearToken) ?? Promise.resolve(UNAVAILABLE)
    );
  }

  /**
   * Lists a repository's open pull requests.
   * @param repository The repository to read.
   * @returns Returns the pull requests, or the reason they could not be read.
   */
  public pullRequests(
    repository: ForgeRepositoryRef,
  ): Promise<ForgeResult<readonly ForgePullRequest[]>> {
    return (
      this.bridge?.invoke<ForgeResult<readonly ForgePullRequest[]>>(
        ForgeChannel.PullRequests,
        repository,
      ) ?? Promise.resolve(UNAVAILABLE_RESULT)
    );
  }

  /**
   * Lists a repository's open issues.
   * @param repository The repository to read.
   * @returns Returns the issues, or the reason they could not be read.
   */
  public issues(repository: ForgeRepositoryRef): Promise<ForgeResult<readonly ForgeIssue[]>> {
    return (
      this.bridge?.invoke<ForgeResult<readonly ForgeIssue[]>>(ForgeChannel.Issues, repository) ??
      Promise.resolve(UNAVAILABLE_RESULT)
    );
  }

  /**
   * Lists a repository's recent CI/CD workflow runs.
   * @param repository The repository to read.
   * @returns Returns the runs, or the reason they could not be read.
   */
  public workflowRuns(
    repository: ForgeRepositoryRef,
  ): Promise<ForgeResult<readonly ForgeWorkflowRun[]>> {
    return (
      this.bridge?.invoke<ForgeResult<readonly ForgeWorkflowRun[]>>(
        ForgeChannel.WorkflowRuns,
        repository,
      ) ?? Promise.resolve(UNAVAILABLE_RESULT)
    );
  }
}
