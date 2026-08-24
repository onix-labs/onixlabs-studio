// The forge capability's IPC channels and renderer-facing client. The renderer's Forge service and the
// main-process ForgeContribution both name their channels from here, carried over the generic
// window.bridge transport. The backend is contributed through the main-process contribution registry
// (#389); it is not a core manager.
//
// Every network call and every credential lives in the main process. The renderer can ask for a token
// to be stored or cleared, and can read the resulting status — it can never read the token back.

import {
  ForgeAuthStatus,
  ForgeIssue,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from './forge-types';

/**
 * Names the forge IPC channels. Every operation is a request/response `invoke`.
 */
export enum ForgeChannel {
  /**
   * Resolves a git remote URL to the repository it names on a forge, or null when it names none
   * Studio can talk to (invoke).
   */
  Detect = 'forge:detect',

  /**
   * Reads the current authentication status, verifying the resolved credential against the forge
   * (invoke).
   */
  AuthStatus = 'forge:auth-status',

  /**
   * Stores a personal access token, encrypted at rest, and returns the resulting status (invoke).
   */
  SetToken = 'forge:set-token',

  /**
   * Clears the stored token and returns the resulting status — which may still be authenticated, when
   * a `gh` CLI login remains (invoke).
   */
  ClearToken = 'forge:clear-token',

  /**
   * Lists a repository's open pull requests (invoke).
   */
  PullRequests = 'forge:pull-requests',

  /**
   * Lists a repository's open issues (invoke).
   */
  Issues = 'forge:issues',

  /**
   * Lists a repository's recent CI/CD workflow runs (invoke).
   */
  WorkflowRuns = 'forge:workflow-runs',
}

/**
 * Defines the renderer-facing forge operations, each mapping to a {@link ForgeChannel} over the bridge.
 */
export interface ForgeClient {
  /**
   * Resolves a git remote URL to the repository it names on a forge.
   * @param remoteUrl The remote's URL, in any form git writes it.
   * @returns Returns the repository reference, or null when the URL names no forge Studio can talk to.
   */
  detect(remoteUrl: string): Promise<ForgeRepositoryRef | null>;

  /**
   * Reads the current authentication status.
   * @returns Returns the status.
   */
  authStatus(): Promise<ForgeAuthStatus>;

  /**
   * Stores a personal access token.
   * @param token The token to store; a blank token clears it instead.
   * @returns Returns the resulting status.
   */
  setToken(token: string): Promise<ForgeAuthStatus>;

  /**
   * Clears the stored token.
   * @returns Returns the resulting status.
   */
  clearToken(): Promise<ForgeAuthStatus>;

  /**
   * Lists a repository's open pull requests.
   * @param repository The repository to read.
   * @returns Returns the pull requests, or the reason they could not be read.
   */
  pullRequests(repository: ForgeRepositoryRef): Promise<ForgeResult<readonly ForgePullRequest[]>>;

  /**
   * Lists a repository's open issues.
   * @param repository The repository to read.
   * @returns Returns the issues, or the reason they could not be read.
   */
  issues(repository: ForgeRepositoryRef): Promise<ForgeResult<readonly ForgeIssue[]>>;

  /**
   * Lists a repository's recent CI/CD workflow runs.
   * @param repository The repository to read.
   * @returns Returns the runs, or the reason they could not be read.
   */
  workflowRuns(repository: ForgeRepositoryRef): Promise<ForgeResult<readonly ForgeWorkflowRun[]>>;
}
