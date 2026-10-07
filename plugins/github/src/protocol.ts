// The hosting protocol, as the GitHub plugin speaks it.
//
// Deliberately a copy rather than an import of the application's `@shared/api`: the plugin is a
// separate program whose contract with Studio is the protocol, not shared TypeScript. A third-party
// hosting plugin would write these from the documented protocol, and a first-party one reaching into
// `src/` would make itself unextractable and let a change in the app break a shipped plugin unnoticed.
// The same rule the Git and harness plugins follow.
//
// Transport: newline-delimited JSON over standard streams. One request per line on stdin, one response
// per line on stdout, correlated by `id`. Mid-request, the plugin may write a credential request
// (`{ request: 'credential' }`) and read Studio's answer from stdin.

/**
 * Holds the protocol version this build speaks. A plugin announcing a different major version is
 * refused rather than spoken to: one that misreads a request may act on the user's account in a way
 * they did not ask for.
 */
// 1.2 (#805) adds optional repository details — language, stars, fork, archived, starred — so a
// repository browser can offer views on them. Optional, so a 1.1 plugin is still understood.
export const HOSTING_PROTOCOL_VERSION: string = '1.2';

/**
 * Names one optional capability a hosting plugin can advertise.
 *
 * Capabilities exist at two levels. A plugin declares in its manifest what it can do at all, and the
 * handshake confirms it. A repository then narrows that further: GitHub lets an owner turn Issues or
 * Actions off, the user may lack permission to re-run a workflow, and a self-hosted server's version
 * decides what its API offers — so {@link HostingOperations.describeRepository} says what *that*
 * repository allows, and Studio offers only what both levels allow.
 */
export type HostingCapability =
  /**
   * Listing the accounts the signed-in user can act as: themselves and their organisations.
   */
  | 'accounts'

  /**
   * Listing an account's repositories.
   */
  | 'listRepositories'

  /**
   * Creating a repository under an account.
   */
  | 'createRepository'

  /**
   * Listing pull (merge) requests and their checks.
   */
  | 'pullRequests'

  /**
   * Opening a pull (merge) request.
   */
  | 'createPullRequest'

  /**
   * Listing issues and their comments.
   */
  | 'issues'

  /**
   * Opening an issue.
   */
  | 'createIssue'

  /**
   * Commenting on an issue or a pull request — one conversation on most hosts.
   */
  | 'commentOnIssue'

  /**
   * Closing or reopening an issue.
   */
  | 'setIssueState'

  /**
   * Listing an issue's sub-issues.
   */
  | 'subIssues'

  /**
   * Listing CI runs.
   */
  | 'ciRuns'

  /**
   * Re-running a finished CI run.
   */
  | 'ciRerun'

  /**
   * Cancelling a CI run in progress. Separate from re-running because a host, or the user's
   * permissions, may allow one without the other.
   */
  | 'ciCancel'

  /**
   * Offering agents tools of the plugin's own describing — the host-specific layer.
   */
  | 'agentTools';

/**
 * Lists every optional capability. Closed on purpose: a capability is the join between what a plugin
 * says and what a surface checks, so a misspelled one would not fail — it would silently never be
 * offered.
 */
export const HOSTING_CAPABILITIES: readonly HostingCapability[] = [
  'accounts',
  'listRepositories',
  'createRepository',
  'pullRequests',
  'createPullRequest',
  'issues',
  'createIssue',
  'commentOnIssue',
  'setIssueState',
  'subIssues',
  'ciRuns',
  'ciRerun',
  'ciCancel',
  'agentTools',
];

/**
 * Names how a plugin signs in to a host, which the user chooses in Settings, per host.
 *
 * - `cli`: the host's own command-line login (`gh` for GitHub). The plugin asks the CLI itself — knowing
 *   about `gh` is the GitHub plugin's business, not core's — so Studio, the terminal and agents' own
 *   tools all act as one account.
 * - `studio`: a login Studio keeps in its encrypted store, handed over through the credential request.
 *
 * With no choice made, a plugin uses its CLI when that is signed in and asks Studio otherwise.
 */
export type HostingAuthMode = 'cli' | 'studio';

/**
 * Lists the ways a plugin may sign in.
 */
export const HOSTING_AUTH_MODES: readonly HostingAuthMode[] = ['cli', 'studio'];

/**
 * Names a repository on a host.
 */
export interface HostedRepositoryRef {
  /**
   * Gets the host's name, lowercased, such as `github.com`.
   */
  readonly host: string;

  /**
   * Gets the owning account's name.
   */
  readonly owner: string;

  /**
   * Gets the repository's name.
   */
  readonly name: string;
}

/**
 * Describes who the plugin is signed in as.
 */
export interface HostedIdentity {
  /**
   * Gets the account's login, such as `octocat`.
   */
  readonly login: string;

  /**
   * Gets the account's display name, or null when it has none.
   */
  readonly name: string | null;
}

/**
 * Describes how a plugin is signed in to one host.
 */
export interface HostedAuthStatus {
  /**
   * Gets whether the host accepted the plugin's credential.
   */
  readonly authenticated: boolean;

  /**
   * Gets how the plugin signed in, or null when it could not.
   */
  readonly mode: HostingAuthMode | null;

  /**
   * Gets who it is signed in as, or null when it is not.
   */
  readonly identity: HostedIdentity | null;

  /**
   * Gets what to tell the user — who they are signed in as, or what to do to sign in.
   */
  readonly detail: string;
}

/**
 * Describes an account the signed-in user can act as.
 */
export interface HostedAccount {
  /**
   * Gets the account's login.
   */
  readonly login: string;

  /**
   * Gets the account's display name, or null when it has none.
   */
  readonly name: string | null;

  /**
   * Gets whether the account is the user themselves or an organisation they belong to.
   */
  readonly kind: 'user' | 'organization';
}

/**
 * Describes a repository on a host.
 */
export interface HostedRepository {
  /**
   * Gets where the repository is.
   */
  readonly ref: HostedRepositoryRef;

  /**
   * Gets the repository's description, or null when it has none.
   */
  readonly description: string | null;

  /**
   * Gets whether the repository is private.
   */
  readonly private: boolean;

  /**
   * Gets the default branch, or null for an empty repository.
   */
  readonly defaultBranch: string | null;

  /**
   * Gets the URL to clone it from.
   */
  readonly cloneUrl: string;

  /**
   * Gets the URL of its page in a browser.
   */
  readonly webUrl: string;

  /**
   * Gets when it last changed, as an ISO 8601 timestamp.
   */
  readonly updatedAt: string;

  /**
   * Gets its main language, or null when the host names none. Absent when the plugin does not say
   * (added in 1.2, like every field below).
   */
  readonly language?: string | null;

  /**
   * Gets how many users starred it. Absent when the plugin does not say.
   */
  readonly stars?: number;

  /**
   * Gets whether it is a fork of another repository. Absent when the plugin does not say.
   */
  readonly fork?: boolean;

  /**
   * Gets whether it is archived (read-only). Absent when the plugin does not say.
   */
  readonly archived?: boolean;

  /**
   * Gets whether the signed-in user starred it. Absent when the plugin does not say.
   */
  readonly starred?: boolean;
}

/**
 * Describes the combined state of a pull request's checks.
 */
export type HostedCheckStatus = 'running' | 'succeeded' | 'failed' | 'none';

/**
 * Describes a pull (merge) request.
 */
export interface HostedPullRequest {
  /**
   * Gets its number within the repository.
   */
  readonly number: number;

  /**
   * Gets its title.
   */
  readonly title: string;

  /**
   * Gets its author's login.
   */
  readonly author: string;

  /**
   * Gets the URL of its page in a browser.
   */
  readonly url: string;

  /**
   * Gets whether it is a draft.
   */
  readonly draft: boolean;

  /**
   * Gets the name of the branch it proposes.
   */
  readonly headRef: string;

  /**
   * Gets the ref to fetch from the repository's remote to check its head out — `refs/pull/N/head` on
   * GitHub, `refs/merge-requests/N/head` on GitLab. The host's convention, so the plugin says it.
   */
  readonly fetchRef: string;

  /**
   * Gets the combined state of its checks.
   */
  readonly checks: HostedCheckStatus;
}

/**
 * Describes an issue.
 */
export interface HostedIssue {
  /**
   * Gets its number within the repository.
   */
  readonly number: number;

  /**
   * Gets its title.
   */
  readonly title: string;

  /**
   * Gets its author's login.
   */
  readonly author: string;

  /**
   * Gets the URL of its page in a browser.
   */
  readonly url: string;

  /**
   * Gets its labels' names.
   */
  readonly labels: readonly string[];

  /**
   * Gets its assignees' logins.
   */
  readonly assignees: readonly string[];

  /**
   * Gets whether it is open.
   */
  readonly state: 'open' | 'closed';

  /**
   * Gets its body, as the host's markdown.
   */
  readonly body: string;

  /**
   * Gets when it was opened, as an ISO 8601 timestamp.
   */
  readonly createdAt: string;

  /**
   * Gets when it last changed, as an ISO 8601 timestamp.
   */
  readonly updatedAt: string;

  /**
   * Gets when it was closed, when it is.
   */
  readonly closedAt?: string;

  /**
   * Gets how many comments it has.
   */
  readonly commentCount: number;

  /**
   * Gets its milestone's title, when it has one.
   */
  readonly milestone?: string;
}

/**
 * Says why an issue was closed: its work is done, or it will not be done.
 */
export type HostedCloseReason = 'completed' | 'notPlanned';

/**
 * Describes a comment on an issue.
 */
export interface HostedIssueComment {
  /**
   * Gets its identifier, unique within the host.
   */
  readonly id: string;

  /**
   * Gets its author's login.
   */
  readonly author: string;

  /**
   * Gets its body, as the host's markdown.
   */
  readonly body: string;

  /**
   * Gets when it was written, as an ISO 8601 timestamp.
   */
  readonly createdAt: string;

  /**
   * Gets the URL of the comment in a browser.
   */
  readonly url: string;
}

/**
 * Describes where a CI run is.
 */
export type HostedCiRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Describes one CI run — a GitHub Actions workflow run, a GitLab pipeline.
 */
export interface HostedCiRun {
  /**
   * Gets its identifier, unique within the repository.
   */
  readonly id: string;

  /**
   * Gets the name of what ran.
   */
  readonly name: string;

  /**
   * Gets where it is.
   */
  readonly status: HostedCiRunStatus;

  /**
   * Gets the URL of its page in a browser.
   */
  readonly url: string;

  /**
   * Gets the branch it ran on, or null when it ran on none.
   */
  readonly branch: string | null;

  /**
   * Gets what started it, in the host's words (`push`, `pull_request`, `schedule`).
   */
  readonly event: string;

  /**
   * Gets when it started, as an ISO 8601 timestamp.
   */
  readonly startedAt: string;
}

/**
 * Describes a tool a plugin offers agents.
 *
 * The plugin's own describing, so it can offer everything its host's API can do — releases, projects,
 * discussions, repository settings — without core knowing what any of it is.
 */
export interface HostingAgentTool {
  /**
   * Gets the tool's name, unique within the plugin, such as `create_release`.
   */
  readonly name: string;

  /**
   * Gets what the tool does, written for the agent choosing it.
   */
  readonly description: string;

  /**
   * Gets the JSON Schema of the tool's input.
   */
  readonly inputSchema: Readonly<Record<string, unknown>>;

  /**
   * Gets whether the tool changes anything on the host. A tool that does goes through the run's
   * permission posture and per-tool policies; one that only reads does not.
   */
  readonly writes: boolean;
}

/**
 * Describes why a request failed, when the reason is one a surface handles differently from a plain
 * failure.
 *
 * - `unauthorized`: the host refused the credential, or there is none — the user should sign in.
 * - `forbidden`: signed in, but not allowed to do this.
 * - `not-found`: the repository, issue or run does not exist, or is invisible to the user.
 * - `rate-limited`: the host is rationing requests; `retryAt` says when to try again.
 * - `unsupported`: the plugin, or this repository, does not offer it. The host answers this itself.
 * - `refused`: the host would not send the request — an unknown host, a malformed request, or an agent
 *   write the user declined.
 */
export type HostingErrorCode =
  'unauthorized' | 'forbidden' | 'not-found' | 'rate-limited' | 'unsupported' | 'refused';

/**
 * Describes what a plugin says it is, in answer to `initialize`.
 */
export interface HostingDescription {
  /**
   * Gets the protocol version the plugin speaks.
   */
  readonly protocol: string;

  /**
   * Gets the optional capabilities the plugin supports. The host intersects these with what the
   * manifest declared: a manifest is a promise, and this is the plugin itself answering.
   */
  readonly capabilities: readonly HostingCapability[];
}

/**
 * Lists every request, its parameters, and what a successful answer carries.
 */
export interface HostingOperations {
  /**
   * The handshake: sent once, immediately after the process starts. `auth` holds the user's sign-in
   * choice for each host that has one; a host absent from it uses the plugin's default.
   */
  readonly initialize: {
    readonly params: {
      readonly protocol: string;
      readonly auth: Readonly<Record<string, HostingAuthMode>>;
    };
    readonly result: HostingDescription;
  };

  /**
   * Says how the plugin is signed in to a host, checking the credential against it.
   */
  readonly authStatus: {
    readonly params: { readonly host: string };
    readonly result: HostedAuthStatus;
  };

  readonly listAccounts: {
    readonly params: { readonly host: string };
    readonly result: readonly HostedAccount[];
  };

  readonly listRepositories: {
    readonly params: { readonly host: string; readonly account: string };
    readonly result: readonly HostedRepository[];
  };

  readonly createRepository: {
    readonly params: {
      readonly host: string;
      readonly account: string;
      readonly name: string;
      readonly private: boolean;
      readonly description?: string;
    };
    readonly result: HostedRepository;
  };

  /**
   * Says what one repository allows — the second level of capabilities. A capability the plugin has but
   * the repository does not allow (Issues turned off, no permission to re-run) is left out.
   */
  readonly describeRepository: {
    readonly params: RepositoryParams;
    readonly result: { readonly capabilities: readonly HostingCapability[] };
  };

  readonly listPullRequests: {
    readonly params: RepositoryParams;
    readonly result: readonly HostedPullRequest[];
  };

  readonly listIssues: {
    readonly params: RepositoryParams;
    readonly result: readonly HostedIssue[];
  };

  readonly listIssueComments: {
    readonly params: IssueParams;
    readonly result: readonly HostedIssueComment[];
  };

  readonly listSubIssues: {
    readonly params: IssueParams;
    readonly result: readonly HostedIssue[];
  };

  readonly listCiRuns: {
    readonly params: RepositoryParams;
    readonly result: readonly HostedCiRun[];
  };

  /**
   * Opens an issue. Its body is the host's markdown.
   */
  readonly createIssue: {
    readonly params: RepositoryParams & { readonly title: string; readonly body?: string };
    readonly result: HostedIssue;
  };

  /**
   * Comments on an issue or a pull request, which share one conversation on most hosts.
   */
  readonly commentOnIssue: {
    readonly params: IssueParams & { readonly body: string };
    readonly result: HostedIssueComment;
  };

  /**
   * Closes or reopens an issue. `reason` says why one was closed, where the host records it.
   */
  readonly setIssueState: {
    readonly params: IssueParams & {
      readonly state: 'open' | 'closed';
      readonly reason?: HostedCloseReason;
    };
    readonly result: HostedIssue;
  };

  /**
   * Opens a pull (merge) request from `head` into `base`. `head` may name another account's fork as
   * `owner:branch`, where the host allows it.
   */
  readonly createPullRequest: {
    readonly params: RepositoryParams & {
      readonly title: string;
      readonly head: string;
      readonly base: string;
      readonly body?: string;
      readonly draft?: boolean;
    };
    readonly result: HostedPullRequest;
  };

  readonly rerunCiRun: { readonly params: RunParams; readonly result: Done };
  readonly cancelCiRun: { readonly params: RunParams; readonly result: Done };

  /**
   * Lists the tools the plugin offers agents, for a repository or for none.
   */
  readonly listAgentTools: {
    readonly params: { readonly repository?: HostedRepositoryRef };
    readonly result: readonly HostingAgentTool[];
  };

  /**
   * Runs one of the plugin's agent tools. `output` is what the agent is shown.
   */
  readonly invokeAgentTool: {
    readonly params: {
      readonly name: string;
      readonly input: unknown;
      readonly repository?: HostedRepositoryRef;
    };
    readonly result: { readonly output: string; readonly isError?: boolean };
  };
}

/**
 * Names one request.
 */
export type HostingOp = keyof HostingOperations;

/**
 * Gets the parameters of a request.
 */
export type HostingParams<Op extends HostingOp> = HostingOperations[Op]['params'];

/**
 * Gets what a successful answer to a request carries.
 */
export type HostingResult<Op extends HostingOp> = HostingOperations[Op]['result'];

/**
 * Parameters naming a repository.
 */
interface RepositoryParams {
  readonly repository: HostedRepositoryRef;
}

/**
 * Parameters naming an issue.
 */
interface IssueParams extends RepositoryParams {
  readonly issue: number;
}

/**
 * Parameters naming a CI run.
 */
interface RunParams extends RepositoryParams {
  readonly runId: string;
}

/**
 * The result of an operation that only succeeds or fails.
 */
type Done = Readonly<Record<string, never>>;

/**
 * The requests that name a repository in `params.repository`, which the host checks against the hosts
 * the plugin serves and against what that repository allows.
 */
export const HOSTING_REPOSITORY_OPS: readonly HostingOp[] = [
  'describeRepository',
  'listPullRequests',
  'listIssues',
  'listIssueComments',
  'listSubIssues',
  'listCiRuns',
  'rerunCiRun',
  'cancelCiRun',
  'createIssue',
  'commentOnIssue',
  'setIssueState',
  'createPullRequest',
];

/**
 * The requests that change something on the host. One the user makes from Studio's own controls is the
 * user acting, and is sent as asked; one an agent makes goes through the run's permission posture and
 * per-tool policies first. `invokeAgentTool` is one only when the tool says it writes.
 */
export const HOSTING_WRITE_OPS: readonly HostingOp[] = [
  'createRepository',
  'rerunCiRun',
  'cancelCiRun',
  'createIssue',
  'commentOnIssue',
  'setIssueState',
  'createPullRequest',
];

/**
 * The requests that only read. Identical concurrent reads are answered by one request — several
 * surfaces poll the same repository.
 */
export const HOSTING_READ_OPS: readonly HostingOp[] = [
  'authStatus',
  'listAccounts',
  'listRepositories',
  'describeRepository',
  'listPullRequests',
  'listIssues',
  'listIssueComments',
  'listSubIssues',
  'listCiRuns',
  'listAgentTools',
];

/**
 * The capability each optional request needs. A request absent from this table needs none.
 */
export const HOSTING_OP_CAPABILITY: Readonly<Partial<Record<HostingOp, HostingCapability>>> = {
  listAccounts: 'accounts',
  listRepositories: 'listRepositories',
  createRepository: 'createRepository',
  listPullRequests: 'pullRequests',
  listIssues: 'issues',
  listIssueComments: 'issues',
  listSubIssues: 'subIssues',
  listCiRuns: 'ciRuns',
  rerunCiRun: 'ciRerun',
  cancelCiRun: 'ciCancel',
  createIssue: 'createIssue',
  commentOnIssue: 'commentOnIssue',
  setIssueState: 'setIssueState',
  createPullRequest: 'createPullRequest',
  listAgentTools: 'agentTools',
  invokeAgentTool: 'agentTools',
};

/**
 * Describes a request sent to a plugin.
 */
export interface HostingRequest<Op extends HostingOp = HostingOp> {
  /**
   * Gets the request correlation identifier.
   */
  readonly id: number;

  /**
   * Gets the operation requested.
   */
  readonly op: Op;

  /**
   * Gets the operation's parameters.
   */
  readonly params: HostingParams<Op>;
}

/**
 * Describes a plugin's answer to a request: the result on success, or the reason it failed.
 */
export type HostingResponse<Op extends HostingOp = HostingOp> =
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the success case.
       */
      readonly ok: true;

      /**
       * Gets the operation's result.
       */
      readonly result: HostingResult<Op>;
    }
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the failure case.
       */
      readonly ok: false;

      /**
       * Gets a human-readable reason the request failed, suitable for showing to the user.
       */
      readonly error: string;

      /**
       * Gets the reason's code, when the outcome is one a surface handles differently.
       */
      readonly code?: HostingErrorCode;

      /**
       * Gets when to try again, as an ISO 8601 timestamp, when the host is rationing requests.
       */
      readonly retryAt?: string;
    };

/**
 * Describes a plugin asking Studio for a host's credential, mid-request. Written to stdout like a
 * response, and told apart from one by `request`.
 */
export interface HostingCredentialRequest {
  /**
   * Discriminates the message.
   */
  readonly request: 'credential';

  /**
   * Gets the correlation identifier the answer carries back.
   */
  readonly callId: number;

  /**
   * Gets the host whose credential is wanted. Studio answers only for a host the plugin's manifest
   * declares, and only when the user's choice for it is not `cli`.
   */
  readonly host: string;
}

/**
 * Describes Studio's answer to a credential request, written to the plugin's stdin.
 */
export interface HostingCredentialAnswer {
  /**
   * Discriminates the message.
   */
  readonly answer: 'credential';

  /**
   * Gets the correlation identifier of the request this answers.
   */
  readonly callId: number;

  /**
   * Gets the credential, or null when Studio holds none for the host or will not hand it over.
   */
  readonly token: string | null;
}

/**
 * Determines whether a plugin's announced protocol version is compatible with this build's: the same
 * major version.
 * @param announced The version the plugin announced.
 * @returns Returns true when the plugin may be spoken to.
 */
export function isCompatibleHostingProtocol(announced: unknown): boolean {
  if (typeof announced !== 'string' || !/^\d+(\.\d+)*$/.test(announced)) {
    return false;
  }
  const major: (version: string) => string = (version: string): string => version.split('.')[0];
  return major(announced) === major(HOSTING_PROTOCOL_VERSION);
}

/**
 * Determines whether a value is a known optional capability.
 * @param value The candidate.
 * @returns Returns true when the value names a capability.
 */
export function isHostingCapability(value: unknown): value is HostingCapability {
  return typeof value === 'string' && (HOSTING_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Determines whether a value is a known sign-in mode.
 * @param value The candidate.
 * @returns Returns true when the value names a mode.
 */
export function isHostingAuthMode(value: unknown): value is HostingAuthMode {
  return typeof value === 'string' && (HOSTING_AUTH_MODES as readonly string[]).includes(value);
}
