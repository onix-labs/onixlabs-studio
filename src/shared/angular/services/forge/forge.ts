import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Bridge } from '@shared/api/bridge';
import { ForgeChannel, ForgeClient } from '@shared/api/forge-channels';
import { HostedAccount, HostedRepository, HostingAuthMode } from '@shared/api/hosting-protocol';
import {
  ForgeHostAccount,
  ForgeIssue,
  ForgeIssueComment,
  ForgePullRequest,
  ForgeRepositoryCapabilities,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';

/**
 * The result returned when the backend is not reachable — running as a plain web app, or under tests —
 * so callers get the same shape they would from a genuine failure rather than needing an environment
 * check of their own.
 */
const UNAVAILABLE_RESULT: ForgeResult<never> = {
  ok: false,
  error: 'Forge integration is unavailable outside the desktop application.',
  unauthorized: false,
};

/**
 * The renderer client for the forge backend — the hosting plugins (#432, #820): a thin, typed wrapper over the generic
 * {@link Bridge} that names the {@link ForgeChannel} channels so no view touches `window.bridge`
 * directly.
 *
 * There is deliberately no way to read a token here. Storing and clearing one are requests the main
 * process acts on; what comes back is a {@link ForgeHostAccount}, which says who the credential belongs
 * to and how the plugin signed in but never what the credential is.
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
   * Says what a repository allows.
   * @param repository The repository.
   * @returns Returns the capabilities, or null when no installed plugin serves it.
   */
  public describe(repository: ForgeRepositoryRef): Promise<ForgeRepositoryCapabilities | null> {
    return (
      this.bridge?.invoke<ForgeRepositoryCapabilities | null>(ForgeChannel.Describe, repository) ??
      Promise.resolve(null)
    );
  }

  /**
   * Lists every host the installed hosting plugins serve, with how each is signed in.
   * @returns Returns the hosts, highest-priority plugin first; none outside the desktop application.
   */
  public hosts(): Promise<readonly ForgeHostAccount[]> {
    return (
      this.bridge?.invoke<readonly ForgeHostAccount[]>(ForgeChannel.Hosts) ?? Promise.resolve([])
    );
  }

  /**
   * Chooses how a plugin signs in to one of its hosts.
   * @param pluginId The plugin.
   * @param host The host.
   * @param mode The way to sign in, or null to let the plugin decide.
   * @returns Returns the host's resulting account, or null when the plugin does not serve it.
   */
  public setAuthMode(
    pluginId: string,
    host: string,
    mode: HostingAuthMode | null,
  ): Promise<ForgeHostAccount | null> {
    this.log.info('forge', `Signing ${pluginId} in to ${host} with ${mode ?? 'its default'}`);
    return (
      this.bridge?.invoke<ForgeHostAccount | null>(
        ForgeChannel.SetAuthMode,
        pluginId,
        host,
        mode,
      ) ?? Promise.resolve(null)
    );
  }

  /**
   * Stores a personal access token for a host.
   * @param pluginId The plugin serving the host.
   * @param host The host.
   * @param token The token to store; a blank token clears it instead.
   * @returns Returns the host's resulting account, or null when the plugin does not serve it.
   */
  public setToken(pluginId: string, host: string, token: string): Promise<ForgeHostAccount | null> {
    // Deliberately not logged, not even at trace: the argument is the secret.
    this.log.info('forge', `Storing a token for ${host}`);
    return (
      this.bridge?.invoke<ForgeHostAccount | null>(ForgeChannel.SetToken, pluginId, host, token) ??
      Promise.resolve(null)
    );
  }

  /**
   * Clears the token stored for a host.
   * @param pluginId The plugin serving the host.
   * @param host The host.
   * @returns Returns the host's resulting account, which may still be signed in when the host's CLI
   * login remains; or null when the plugin does not serve it.
   */
  public clearToken(pluginId: string, host: string): Promise<ForgeHostAccount | null> {
    this.log.info('forge', `Clearing the token stored for ${host}`);
    return (
      this.bridge?.invoke<ForgeHostAccount | null>(ForgeChannel.ClearToken, pluginId, host) ??
      Promise.resolve(null)
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
   * Lists an issue's comments, oldest first.
   * @param repository The repository to read.
   * @param issueNumber The issue whose comments to read.
   * @returns Returns the comments, or the reason they could not be read.
   */
  public issueComments(
    repository: ForgeRepositoryRef,
    issueNumber: number,
  ): Promise<ForgeResult<readonly ForgeIssueComment[]>> {
    return (
      this.bridge?.invoke<ForgeResult<readonly ForgeIssueComment[]>>(
        ForgeChannel.IssueComments,
        repository,
        issueNumber,
      ) ?? Promise.resolve(UNAVAILABLE_RESULT)
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

  /**
   * Re-runs a CI/CD workflow run.
   * @param repository The repository the run belongs to.
   * @param runId The run to re-run.
   * @returns Returns nothing on success, or the reason it could not be started.
   */
  public rerunWorkflowRun(
    repository: ForgeRepositoryRef,
    runId: string,
  ): Promise<ForgeResult<void>> {
    this.log.info('forge', `Re-running workflow run ${runId}`);
    return (
      this.bridge?.invoke<ForgeResult<void>>(ForgeChannel.RerunWorkflowRun, repository, runId) ??
      Promise.resolve(UNAVAILABLE_RESULT)
    );
  }

  /**
   * Cancels a CI/CD workflow run that is in flight.
   * @param repository The repository the run belongs to.
   * @param runId The run to cancel.
   * @returns Returns nothing on success, or the reason it could not be cancelled.
   */
  public cancelWorkflowRun(
    repository: ForgeRepositoryRef,
    runId: string,
  ): Promise<ForgeResult<void>> {
    this.log.info('forge', `Cancelling workflow run ${runId}`);
    return (
      this.bridge?.invoke<ForgeResult<void>>(ForgeChannel.CancelWorkflowRun, repository, runId) ??
      Promise.resolve(UNAVAILABLE_RESULT)
    );
  }

  /**
   * Lists the accounts the user acts as on a host: themselves, and their organisations (#805).
   * @param host The host.
   * @returns Returns the accounts, or the reason they could not be read.
   */
  public accounts(host: string): Promise<ForgeResult<readonly HostedAccount[]>> {
    return (
      this.bridge?.invoke<ForgeResult<readonly HostedAccount[]>>(ForgeChannel.Accounts, host) ??
      Promise.resolve(UNAVAILABLE_RESULT)
    );
  }

  /**
   * Lists an account's repositories on a host (#805).
   * @param host The host.
   * @param account The account's login.
   * @returns Returns the repositories, or the reason they could not be read.
   */
  public repositories(
    host: string,
    account: string,
  ): Promise<ForgeResult<readonly HostedRepository[]>> {
    return (
      this.bridge?.invoke<ForgeResult<readonly HostedRepository[]>>(
        ForgeChannel.Repositories,
        host,
        account,
      ) ?? Promise.resolve(UNAVAILABLE_RESULT)
    );
  }

  /**
   * Lists every repository the user starred on a host, whoever owns it (#805).
   * @param host The host.
   * @returns Returns the repositories, or the reason they could not be read.
   */
  public starredRepositories(host: string): Promise<ForgeResult<readonly HostedRepository[]>> {
    return (
      this.bridge?.invoke<ForgeResult<readonly HostedRepository[]>>(
        ForgeChannel.StarredRepositories,
        host,
      ) ?? Promise.resolve(UNAVAILABLE_RESULT)
    );
  }
}
