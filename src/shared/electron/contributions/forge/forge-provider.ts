import {
  ForgeIdentity,
  ForgeIssue,
  ForgeIssueComment,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';

/**
 * A minimal response shape, so a provider does not depend on DOM or Node fetch types. Mirrors the seam
 * the model catalogue and the package-management registries use.
 */
export interface ForgeResponse {
  /**
   * Gets a value indicating whether the status is in the success range.
   */
  readonly ok: boolean;

  /**
   * Gets the HTTP status code.
   */
  readonly status: number;

  /**
   * Reads the body as parsed JSON.
   * @returns Returns the parsed body.
   */
  json(): Promise<unknown>;

  /**
   * Reads a response header, case-insensitively.
   *
   * Present because the rate limit and the entity tag are only knowable from headers: a forge that
   * answers 304 sends no body at all, and the budget that decides whether to ask again is not in one
   * either.
   *
   * @param name The header name.
   * @returns Returns the header value, or null when the response carries none.
   */
  header(name: string): string | null;
}

/**
 * A minimal fetch signature, injected so a provider is testable without a network.
 */
export type ForgeFetch = (
  url: string,
  init?: {
    /**
     * Gets the request method; absent for a GET.
     */
    readonly method?: string;

    /**
     * Gets the request headers.
     */
    readonly headers?: Record<string, string>;

    /**
     * Gets the signal aborting the request.
     */
    readonly signal?: AbortSignal;
  },
) => Promise<ForgeResponse>;

/**
 * Resolves the credential a provider authenticates with, or null when none is available. Kept as a
 * callback rather than a value so a token stored (or cleared) mid-session takes effect on the next
 * request without the provider being rebuilt.
 */
export type ForgeTokenResolver = () => string | null;

/**
 * A forge backend: the hosting service a repository's remote points at.
 *
 * The seam exists so the Repository panel renders pull requests, issues and CI runs without knowing
 * which forge produced them — GitHub is the only implementation today (#432), and GitLab, Bitbucket or
 * a self-hosted instance slot in here rather than anywhere downstream.
 *
 * Every method returns a {@link ForgeResult} rather than throwing, because the caller is across an IPC
 * boundary that would flatten a thrown error to a string, and the panel has to distinguish "none" from
 * "could not read" from "not signed in".
 */
export interface ForgeProvider {
  /**
   * Gets the forge this provider serves.
   */
  readonly kind: string;

  /**
   * Reads the account the current credential authenticates as. The probe behind the settings page's
   * signed-in state.
   * @returns Returns the identity, or the reason it could not be read.
   */
  identity(): Promise<ForgeResult<ForgeIdentity>>;

  /**
   * Lists a repository's open pull requests, most recently updated first.
   * @param repository The repository to read.
   * @returns Returns the pull requests, or the reason they could not be read.
   */
  listPullRequests(
    repository: ForgeRepositoryRef,
  ): Promise<ForgeResult<readonly ForgePullRequest[]>>;

  /**
   * Lists a repository's open issues, most recently updated first. Pull requests are excluded — on a
   * forge that models them as issues, listing both here would double-count them.
   * @param repository The repository to read.
   * @returns Returns the issues, or the reason they could not be read.
   */
  listIssues(repository: ForgeRepositoryRef): Promise<ForgeResult<readonly ForgeIssue[]>>;

  /**
   * Lists an issue's comments, oldest first.
   * @param repository The repository to read.
   * @param issueNumber The issue whose comments to read.
   * @returns Returns the comments, or the reason they could not be read.
   */
  listIssueComments(
    repository: ForgeRepositoryRef,
    issueNumber: number,
  ): Promise<ForgeResult<readonly ForgeIssueComment[]>>;

  /**
   * Lists a repository's recent CI/CD workflow runs, most recent first.
   * @param repository The repository to read.
   * @returns Returns the runs, or the reason they could not be read.
   */
  listWorkflowRuns(
    repository: ForgeRepositoryRef,
  ): Promise<ForgeResult<readonly ForgeWorkflowRun[]>>;

  /**
   * Re-runs a CI/CD workflow run. The forge starts a *new* run rather than mutating this one, so the
   * caller re-reads the list to see it.
   * @param repository The repository the run belongs to.
   * @param runId The run to re-run.
   * @returns Returns nothing on success, or the reason it could not be started.
   */
  rerunWorkflowRun(repository: ForgeRepositoryRef, runId: number): Promise<ForgeResult<void>>;

  /**
   * Cancels a CI/CD workflow run that is in flight.
   * @param repository The repository the run belongs to.
   * @param runId The run to cancel.
   * @returns Returns nothing on success, or the reason it could not be cancelled.
   */
  cancelWorkflowRun(repository: ForgeRepositoryRef, runId: number): Promise<ForgeResult<void>>;
}
