// The forge capability's IPC channels and renderer-facing client. The renderer's Forge service and the
// main-process HostingManager both name their channels from here, carried over the generic
// window.bridge transport. Behind them is the hosting host: every request is answered by whichever
// hosting plugin serves the repository's host (#819, #820), and with none installed there is no forge.
//
// Every network call and every credential lives in the main process. The renderer can ask for a token
// to be stored or cleared, and can read the resulting status — it can never read the token back.

import { HostedAccount, HostedRepository, HostingAuthMode } from './hosting-protocol';
import {
  ForgeHostAccount,
  ForgeRepositoryCapabilities,
  ForgeIssue,
  ForgeIssueComment,
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
   * Says what a repository allows — its plugin's capabilities narrowed to the repository's own — or
   * null when no installed plugin serves it (invoke).
   */
  Describe = 'forge:describe',

  /**
   * Lists every host the installed hosting plugins serve, with how each is signed in, verifying each
   * credential against its host (invoke).
   */
  Hosts = 'forge:hosts',

  /**
   * Chooses how a plugin signs in to one of its hosts, restarting the plugin, and returns the host's
   * resulting account (invoke).
   */
  SetAuthMode = 'forge:set-auth-mode',

  /**
   * Stores a personal access token for a host, encrypted at rest, and returns the host's resulting
   * account (invoke).
   */
  SetToken = 'forge:set-token',

  /**
   * Clears the token stored for a host and returns its resulting account — which may still be
   * authenticated, when the host's CLI login remains (invoke).
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
   * Lists one issue's comments (invoke).
   */
  IssueComments = 'forge:issue-comments',

  /**
   * Lists a repository's recent CI/CD workflow runs (invoke).
   */
  WorkflowRuns = 'forge:workflow-runs',

  /**
   * Re-runs a CI/CD workflow run (invoke).
   */
  RerunWorkflowRun = 'forge:rerun-workflow-run',

  /**
   * Cancels a CI/CD workflow run that is in flight (invoke).
   */
  CancelWorkflowRun = 'forge:cancel-workflow-run',

  /**
   * Lists the accounts the user acts as on a host: themselves, and their organisations (invoke, #805).
   */
  Accounts = 'forge:accounts',

  /**
   * Lists an account's repositories on a host (invoke, #805).
   */
  Repositories = 'forge:repositories',

  /**
   * Lists every repository the user starred on a host, whoever owns it (invoke, #805).
   */
  StarredRepositories = 'forge:starred-repositories',
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
   * Says what a repository allows.
   * @param repository The repository.
   * @returns Returns the capabilities, or null when no installed plugin serves it.
   */
  describe(repository: ForgeRepositoryRef): Promise<ForgeRepositoryCapabilities | null>;

  /**
   * Lists every host the installed hosting plugins serve, with how each is signed in.
   * @returns Returns the hosts, highest-priority plugin first.
   */
  hosts(): Promise<readonly ForgeHostAccount[]>;

  /**
   * Chooses how a plugin signs in to one of its hosts.
   * @param pluginId The plugin.
   * @param host The host.
   * @param mode The way to sign in, or null to let the plugin decide.
   * @returns Returns the host's resulting account, or null when the plugin does not serve it.
   */
  setAuthMode(
    pluginId: string,
    host: string,
    mode: HostingAuthMode | null,
  ): Promise<ForgeHostAccount | null>;

  /**
   * Stores a personal access token for a host.
   * @param pluginId The plugin serving the host.
   * @param host The host.
   * @param token The token to store; a blank token clears it instead.
   * @returns Returns the host's resulting account, or null when the plugin does not serve it.
   */
  setToken(pluginId: string, host: string, token: string): Promise<ForgeHostAccount | null>;

  /**
   * Clears the token stored for a host.
   * @param pluginId The plugin serving the host.
   * @param host The host.
   * @returns Returns the host's resulting account, or null when the plugin does not serve it.
   */
  clearToken(pluginId: string, host: string): Promise<ForgeHostAccount | null>;

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
   * Lists an issue's comments, oldest first.
   * @param repository The repository to read.
   * @param issueNumber The issue whose comments to read.
   * @returns Returns the comments, or the reason they could not be read.
   */
  issueComments(
    repository: ForgeRepositoryRef,
    issueNumber: number,
  ): Promise<ForgeResult<readonly ForgeIssueComment[]>>;

  /**
   * Lists a repository's recent CI/CD workflow runs.
   * @param repository The repository to read.
   * @returns Returns the runs, or the reason they could not be read.
   */
  workflowRuns(repository: ForgeRepositoryRef): Promise<ForgeResult<readonly ForgeWorkflowRun[]>>;

  /**
   * Re-runs a CI/CD workflow run.
   * @param repository The repository the run belongs to.
   * @param runId The run to re-run.
   * @returns Returns nothing on success, or the reason it could not be started.
   */
  rerunWorkflowRun(repository: ForgeRepositoryRef, runId: string): Promise<ForgeResult<void>>;

  /**
   * Cancels a CI/CD workflow run that is in flight.
   * @param repository The repository the run belongs to.
   * @param runId The run to cancel.
   * @returns Returns nothing on success, or the reason it could not be cancelled.
   */
  cancelWorkflowRun(repository: ForgeRepositoryRef, runId: string): Promise<ForgeResult<void>>;

  /**
   * Lists the accounts the user acts as on a host: themselves, and the organisations they belong to.
   * @param host The host, which an installed hosting plugin must serve.
   * @returns Returns the accounts, or the reason they could not be read.
   */
  accounts(host: string): Promise<ForgeResult<readonly HostedAccount[]>>;

  /**
   * Lists an account's repositories on a host.
   * @param host The host, which an installed hosting plugin must serve.
   * @param account The account's login.
   * @returns Returns the repositories, or the reason they could not be read.
   */
  repositories(host: string, account: string): Promise<ForgeResult<readonly HostedRepository[]>>;

  /**
   * Lists every repository the user starred on a host, whoever owns it.
   * @param host The host, which an installed hosting plugin must serve.
   * @returns Returns the repositories, or the reason they could not be read.
   */
  starredRepositories(host: string): Promise<ForgeResult<readonly HostedRepository[]>>;
}
