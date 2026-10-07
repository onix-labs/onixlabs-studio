// The GitHub REST client behind the hosting protocol (#820). Moved from core's forge contribution
// (#432), which it replaces: the same requests, entity-tag cache and rate-limit ledger, now answering
// the protocol's host-neutral types, plus the account and repository listing #805 is built against.
import { Clock, EtagCache, RateLimitLedger } from './budget';
import { GitHubAuth, ResolvedCredential } from './auth';
import { debug } from './log';
import {
  HostedAccount,
  HostedAuthStatus,
  HostedCheckStatus,
  HostedCiRun,
  HostedCiRunStatus,
  HostedCloseReason,
  HostedIdentity,
  HostedIssue,
  HostedIssueComment,
  HostedPullRequest,
  HostedRepository,
  HostedRepositoryRef,
  HostingAuthMode,
  HostingCapability,
  HostingErrorCode,
} from './protocol';

/**
 * How many entries a list request asks for. One page is deliberate: a panel's sections are a glance at
 * what is open, not a browser, and paging would cost rate-limit budget for rows nobody scrolls to.
 */
const PAGE_SIZE: number = 50;

/**
 * How many repositories each page of a listing asks for: GitHub's maximum.
 */
const REPOSITORY_PAGE_SIZE: number = 100;

/**
 * The most pages a repository listing reads (#805). Unlike a panel's glance at what is open, the
 * repository browser is a browser — but an account with thousands of repositories would spend the
 * rate-limit budget on pages nobody scrolls to, so a listing stops at a thousand.
 */
const REPOSITORY_PAGE_LIMIT: number = 10;

/**
 * The API version header GitHub asks integrations to pin.
 */
const API_VERSION: string = '2022-11-28';

/**
 * The check-run conclusions that mean the user has something to fix.
 */
const FAILING_CONCLUSIONS: readonly string[] = [
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
];

/**
 * Describes what a request produced: its result, or why it failed.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly result: T }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code?: HostingErrorCode;
      readonly retryAt?: string;
    };

/**
 * Describes a fetch response, as much of one as this reads.
 */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  header(name: string): string | null;
}

/**
 * Performs an HTTP request. Injected so the client is testable without a network.
 */
export type Http = (
  url: string,
  init: {
    readonly method?: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<HttpResponse>;

/**
 * The state kept per host: its cache and budget, both of which belong to the credential they were
 * filled against and are dropped when it changes.
 */
interface HostState {
  readonly cache: EtagCache;
  readonly ledger: RateLimitLedger;
  seenToken: string | null;
}

/**
 * The raw account shape, as much of it as this reads.
 */
interface RawUser {
  readonly login?: unknown;
  readonly name?: unknown;
}

/**
 * The raw repository shape, as much of it as this reads.
 */
interface RawRepository {
  readonly full_name?: unknown;
  readonly language?: unknown;
  readonly stargazers_count?: unknown;
  readonly fork?: unknown;
  readonly archived?: unknown;
  readonly forks_count?: unknown;
  readonly open_issues_count?: unknown;
  readonly topics?: unknown;
  readonly license?: { readonly spdx_id?: unknown; readonly name?: unknown } | null;
  readonly homepage?: unknown;
  readonly pushed_at?: unknown;
  readonly name?: unknown;
  readonly owner?: RawUser;
  readonly description?: unknown;
  readonly private?: unknown;
  readonly default_branch?: unknown;
  readonly clone_url?: unknown;
  readonly html_url?: unknown;
  readonly updated_at?: unknown;
  readonly has_issues?: unknown;
  readonly permissions?: { readonly push?: unknown; readonly triage?: unknown };
}

/**
 * The raw pull-request shape, as much of it as this reads.
 */
interface RawPullRequest {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly html_url?: unknown;
  readonly draft?: unknown;
  readonly user?: RawUser;
  readonly head?: { readonly ref?: unknown; readonly sha?: unknown };
}

/**
 * The raw issue shape, as much of it as this reads.
 */
interface RawIssue {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly html_url?: unknown;
  readonly user?: RawUser;
  readonly pull_request?: unknown;
  readonly labels?: readonly { readonly name?: unknown }[];
  readonly assignees?: readonly RawUser[];
  readonly state?: unknown;
  readonly body?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly closed_at?: unknown;
  readonly comments?: unknown;
  readonly milestone?: { readonly title?: unknown } | null;
}

/**
 * The comment fields read from GitHub's issue-comments endpoint.
 */
interface RawIssueComment {
  readonly id?: unknown;
  readonly user?: RawUser;
  readonly body?: unknown;
  readonly created_at?: unknown;
  readonly html_url?: unknown;
}

/**
 * The raw workflow-run shape, as much of it as this reads.
 */
interface RawWorkflowRun {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly status?: unknown;
  readonly conclusion?: unknown;
  readonly html_url?: unknown;
  readonly head_branch?: unknown;
  readonly event?: unknown;
  readonly run_started_at?: unknown;
  readonly created_at?: unknown;
}

/**
 * Reads a value as a string, falling back when it is absent or another type. The API is external input:
 * every field is treated as optional-and-possibly-wrong rather than trusted to match the documentation.
 * @param value The value to read.
 * @param fallback The value to use when it is not a string.
 * @returns Returns the string.
 */
function asString(value: unknown, fallback: string = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Reads a value as a number, falling back when it is absent or another type.
 * @param value The value to read.
 * @param fallback The value to use when it is not a number.
 * @returns Returns the number.
 */
function asNumber(value: unknown, fallback: number = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Reads a value as an identifier string: a number or a string, as GitHub issues them.
 * @param value The value to read.
 * @returns Returns the identifier, or an empty string when it is neither.
 */
function asId(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : asString(value);
}

/**
 * Rolls a commit's checks up to one status.
 *
 * GitHub reports CI through **two** systems and shows the union of them: check runs (the Checks API,
 * which GitHub Actions and most Apps use) and commit statuses (the older Status API, which Codecov,
 * Vercel, Travis and Jenkins still use). Reading only the first makes a pull request whose Actions pass
 * but whose commit status failed show green here and red on GitHub.
 * @param runs The check runs for the commit.
 * @param statusState The combined state of the commit's statuses, or an empty string when it has none —
 * the combined-status endpoint reports `pending` for a commit with no statuses at all, and taking that
 * at face value would leave every repository that uses only Actions pulsing for ever.
 * @returns Returns the rolled-up status.
 */
export function rollUpChecks(
  runs: readonly { readonly status?: unknown; readonly conclusion?: unknown }[],
  statusState: string = '',
): HostedCheckStatus {
  if (runs.length === 0 && statusState.length === 0) {
    return 'none';
  }
  const failed: boolean =
    runs.some((run): boolean => FAILING_CONCLUSIONS.includes(asString(run.conclusion))) ||
    statusState === 'failure' ||
    statusState === 'error';
  if (failed) {
    return 'failed';
  }
  const running: boolean =
    runs.some((run): boolean => asString(run.status) !== 'completed') || statusState === 'pending';
  return running ? 'running' : 'succeeded';
}

/**
 * Maps a workflow run's status and conclusion onto a CI run's lifecycle. GitHub splits the two — a
 * finished run reports `completed` with the outcome in `conclusion`.
 * @param status The run's status.
 * @param conclusion The run's conclusion, present once it has completed.
 * @returns Returns the run status.
 */
export function mapRunStatus(status: string, conclusion: string): HostedCiRunStatus {
  if (status !== 'completed') {
    return status === 'queued' || status === 'requested' || status === 'waiting'
      ? 'queued'
      : 'running';
  }
  switch (conclusion) {
    case 'success':
      return 'succeeded';
    case 'cancelled':
    case 'skipped':
      return 'cancelled';
    default:
      return 'failed';
  }
}

/**
 * Resolves a host to its REST API origin: github.com's API lives on its own hostname, and a GitHub
 * Enterprise server serves it under `/api/v3` on the same host.
 * @param host The host.
 * @returns Returns the API origin.
 */
export function originFor(host: string): string {
  return host === 'github.com' || host === 'www.github.com'
    ? 'https://api.github.com'
    : `https://${host}/api/v3`;
}

/**
 * Builds the API path of a repository.
 * @param repository The repository.
 * @returns Returns the path, with each segment encoded so a hostile name cannot extend it.
 */
function repoPath(repository: HostedRepositoryRef): string {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
}

/**
 * Speaks GitHub's REST API for every host the plugin serves.
 *
 * Failures are returned rather than thrown, and coded so a surface can answer each the right way: a 401
 * with "sign in", a 404 with "not found", an exhausted budget with when to try again.
 */
export class GitHubHosting {
  /**
   * Holds each host's cache and budget.
   */
  private readonly hosts: Map<string, HostState> = new Map<string, HostState>();

  /**
   * Initializes the client.
   * @param http The fetch used to reach the API.
   * @param auth Resolves each host's credential.
   * @param now The clock the rate-limit ledger reads.
   */
  public constructor(
    private readonly http: Http,
    private readonly auth: GitHubAuth,
    private readonly now: Clock = Date.now,
  ) {}

  /**
   * Says how the plugin is signed in to a host, checking the credential against it.
   * @param host The host.
   * @returns Returns the status.
   */
  public async authStatus(host: string): Promise<Outcome<HostedAuthStatus>> {
    const credential: ResolvedCredential | null = await this.auth.resolve(host);
    if (credential === null) {
      return {
        ok: true,
        result: {
          authenticated: false,
          mode: null,
          identity: null,
          detail: notSignedInDetail(host, this.auth.choiceFor(host)),
        },
      };
    }
    const identity: Outcome<HostedIdentity> = await this.identity(host);
    if (!identity.ok) {
      return {
        ok: true,
        result: {
          authenticated: false,
          mode: credential.mode,
          identity: null,
          detail: identity.error,
        },
      };
    }
    return {
      ok: true,
      result: {
        authenticated: true,
        mode: credential.mode,
        identity: identity.result,
        detail:
          credential.mode === 'cli'
            ? `Signed in as ${identity.result.login} using the GitHub CLI's login.`
            : `Signed in as ${identity.result.login}.`,
      },
    };
  }

  /**
   * Lists the accounts the signed-in user can act as: themselves, then their organisations.
   * @param host The host.
   * @returns Returns the accounts.
   */
  public async listAccounts(host: string): Promise<Outcome<readonly HostedAccount[]>> {
    const user: Outcome<unknown> = await this.get(host, '/user');
    if (!user.ok) {
      return user;
    }
    const raw: RawUser = user.result ?? {};
    const orgs: Outcome<unknown> = await this.get(
      host,
      `/user/orgs?per_page=${REPOSITORY_PAGE_SIZE}`,
    );
    const organisations: readonly RawUser[] =
      orgs.ok && Array.isArray(orgs.result) ? (orgs.result as readonly RawUser[]) : [];
    return {
      ok: true,
      result: [
        { login: asString(raw.login), name: nameOf(raw), kind: 'user' as const },
        ...organisations.map((org: RawUser): HostedAccount => ({
          login: asString(org.login),
          name: nameOf(org),
          kind: 'organization',
        })),
      ].filter((account: HostedAccount): boolean => account.login.length > 0),
    };
  }

  /**
   * Lists an account's repositories, most recently updated first. The signed-in user's own account
   * lists what they own, private included; any other is listed as an organisation.
   * @param host The host.
   * @param account The account's login.
   * @returns Returns the repositories.
   */
  public async listRepositories(
    host: string,
    account: string,
  ): Promise<Outcome<readonly HostedRepository[]>> {
    const me: Outcome<HostedIdentity> = await this.identity(host);
    if (!me.ok) {
      return me;
    }
    // The user's own listing is what they own and what they collaborate on (#805); an organisation's
    // is listed under the organisation, so its repositories are not read twice.
    const path: string =
      me.result.login.toLowerCase() === account.toLowerCase()
        ? '/user/repos?affiliation=owner,collaborator&sort=updated'
        : `/orgs/${encodeURIComponent(account)}/repos?sort=updated`;
    const listed: Outcome<readonly RawRepository[]> = await this.pages<RawRepository>(host, path);
    if (!listed.ok) {
      return listed;
    }
    // Starring is a fact about the user, not the repository, so it is a listing of its own. A failure
    // to read it leaves the repositories unmarked rather than failing the listing.
    const starred: Outcome<readonly RawRepository[]> = await this.pages<RawRepository>(
      host,
      '/user/starred?sort=updated',
    );
    const stars: ReadonlySet<string> | null = starred.ok
      ? new Set<string>(starred.result.map((repo: RawRepository): string => fullName(repo)))
      : null;
    return {
      ok: true,
      result: listed.result.map((repo: RawRepository) =>
        toRepository(host, repo, stars === null ? undefined : stars.has(fullName(repo))),
      ),
    };
  }

  /**
   * Lists every repository the signed-in user starred, whoever owns it (#805).
   * @param host The host.
   * @returns Returns the repositories, each marked starred.
   */
  public async listStarredRepositories(
    host: string,
  ): Promise<Outcome<readonly HostedRepository[]>> {
    const starred: Outcome<readonly RawRepository[]> = await this.pages<RawRepository>(
      host,
      '/user/starred?sort=updated',
    );
    return starred.ok
      ? {
          ok: true,
          result: starred.result.map((repo: RawRepository) => toRepository(host, repo, true)),
        }
      : starred;
  }

  /**
   * Reads every page of a list endpoint, up to {@link REPOSITORY_PAGE_LIMIT}: a page shorter than
   * {@link REPOSITORY_PAGE_SIZE} is the last.
   * @param host The host.
   * @param path The endpoint, with its query, without paging.
   * @returns Returns every entry, in order.
   */
  private async pages<T>(host: string, path: string): Promise<Outcome<readonly T[]>> {
    const entries: T[] = [];
    for (let page: number = 1; page <= REPOSITORY_PAGE_LIMIT; page += 1) {
      const listed: Outcome<unknown> = await this.get(
        host,
        `${path}&per_page=${REPOSITORY_PAGE_SIZE}&page=${page}`,
      );
      if (!listed.ok) {
        return listed;
      }
      const batch: readonly T[] = Array.isArray(listed.result) ? (listed.result as T[]) : [];
      entries.push(...batch);
      if (batch.length < REPOSITORY_PAGE_SIZE) {
        break;
      }
    }
    return { ok: true, result: entries };
  }

  /**
   * Creates a repository under the signed-in user or one of their organisations.
   * @param host The host.
   * @param account The owning account's login.
   * @param name The repository's name.
   * @param isPrivate Whether it is private.
   * @param description Its description, when it has one.
   * @returns Returns the repository created.
   */
  public async createRepository(
    host: string,
    account: string,
    name: string,
    isPrivate: boolean,
    description: string | undefined,
  ): Promise<Outcome<HostedRepository>> {
    const me: Outcome<HostedIdentity> = await this.identity(host);
    if (!me.ok) {
      return me;
    }
    const path: string =
      me.result.login.toLowerCase() === account.toLowerCase()
        ? '/user/repos'
        : `/orgs/${encodeURIComponent(account)}/repos`;
    const created: Outcome<unknown> = await this.send(host, 'POST', path, {
      name,
      private: isPrivate,
      ...(description === undefined ? {} : { description }),
    });
    return created.ok ? { ok: true, result: toRepository(host, created.result ?? {}) } : created;
  }

  /**
   * Says what a repository allows: Issues only when they are turned on, and re-running or cancelling
   * CI only for a user who can push.
   * @param repository The repository.
   * @returns Returns the capabilities.
   */
  public async describeRepository(
    repository: HostedRepositoryRef,
  ): Promise<Outcome<{ readonly capabilities: readonly HostingCapability[] }>> {
    const read: Outcome<unknown> = await this.get(repository.host, repoPath(repository));
    if (!read.ok) {
      return read;
    }
    const raw: RawRepository = read.result ?? {};
    const issues: boolean = raw.has_issues !== false;
    const canPush: boolean = raw.permissions?.push === true;
    // Closing someone else's issue takes triage; anyone signed in may open one or comment.
    const canTriage: boolean = canPush || raw.permissions?.triage === true;
    return {
      ok: true,
      result: {
        capabilities: [
          'pullRequests',
          // A pull request can come from a fork, so opening one needs no push access here.
          'createPullRequest',
          'ciRuns',
          ...(issues ? (['issues', 'subIssues', 'createIssue', 'commentOnIssue'] as const) : []),
          ...(issues && canTriage ? (['setIssueState'] as const) : []),
          ...(canPush ? (['ciRerun', 'ciCancel'] as const) : []),
        ],
      },
    };
  }

  /**
   * Lists a repository's open pull requests, most recently updated first.
   * @param repository The repository.
   * @returns Returns the pull requests.
   */
  public async listPullRequests(
    repository: HostedRepositoryRef,
  ): Promise<Outcome<readonly HostedPullRequest[]>> {
    const listed: Outcome<unknown> = await this.get(
      repository.host,
      `${repoPath(repository)}/pulls?state=open&sort=updated&direction=desc&per_page=${PAGE_SIZE}`,
    );
    if (!listed.ok) {
      return listed;
    }
    const raw: readonly RawPullRequest[] = Array.isArray(listed.result)
      ? (listed.result as readonly RawPullRequest[])
      : [];
    // Checks are a request per pull request, so they are fetched together rather than in series.
    const checks: readonly HostedCheckStatus[] = await Promise.all(
      raw.map((pull: RawPullRequest): Promise<HostedCheckStatus> => {
        const sha: string = asString(pull.head?.sha);
        return sha.length === 0
          ? Promise.resolve<HostedCheckStatus>('none')
          : this.checksFor(repository, sha);
      }),
    );
    return {
      ok: true,
      result: raw.map((pull: RawPullRequest, index: number): HostedPullRequest =>
        toPullRequest(pull, checks[index]),
      ),
    };
  }

  /**
   * Lists a repository's open issues, most recently updated first.
   * @param repository The repository.
   * @returns Returns the issues.
   */
  public async listIssues(
    repository: HostedRepositoryRef,
  ): Promise<Outcome<readonly HostedIssue[]>> {
    const listed: Outcome<unknown> = await this.get(
      repository.host,
      `${repoPath(repository)}/issues?state=open&sort=updated&direction=desc&per_page=${PAGE_SIZE}`,
    );
    return listed.ok ? { ok: true, result: toIssues(listed.result) } : listed;
  }

  /**
   * Lists an issue's comments, oldest first.
   * @param repository The repository.
   * @param issue The issue's number.
   * @returns Returns the comments.
   */
  public async listIssueComments(
    repository: HostedRepositoryRef,
    issue: number,
  ): Promise<Outcome<readonly HostedIssueComment[]>> {
    const listed: Outcome<unknown> = await this.get(
      repository.host,
      `${repoPath(repository)}/issues/${issueNumber(issue)}/comments?per_page=${PAGE_SIZE}`,
    );
    if (!listed.ok) {
      return listed;
    }
    const raw: readonly RawIssueComment[] = Array.isArray(listed.result)
      ? (listed.result as readonly RawIssueComment[])
      : [];
    return { ok: true, result: raw.map(toComment) };
  }

  /**
   * Lists an issue's sub-issues.
   * @param repository The repository.
   * @param issue The parent issue's number.
   * @returns Returns the sub-issues.
   */
  public async listSubIssues(
    repository: HostedRepositoryRef,
    issue: number,
  ): Promise<Outcome<readonly HostedIssue[]>> {
    const listed: Outcome<unknown> = await this.get(
      repository.host,
      `${repoPath(repository)}/issues/${issueNumber(issue)}/sub_issues?per_page=${PAGE_SIZE}`,
    );
    return listed.ok ? { ok: true, result: toIssues(listed.result) } : listed;
  }

  /**
   * Lists a repository's recent workflow runs, most recent first.
   * @param repository The repository.
   * @returns Returns the runs.
   */
  public async listCiRuns(
    repository: HostedRepositoryRef,
  ): Promise<Outcome<readonly HostedCiRun[]>> {
    const listed: Outcome<unknown> = await this.get(
      repository.host,
      `${repoPath(repository)}/actions/runs?per_page=${PAGE_SIZE}`,
    );
    if (!listed.ok) {
      return listed;
    }
    const body: { readonly workflow_runs?: unknown } = listed.result ?? {};
    const raw: readonly RawWorkflowRun[] = Array.isArray(body.workflow_runs)
      ? (body.workflow_runs as readonly RawWorkflowRun[])
      : [];
    return {
      ok: true,
      result: raw.map((run: RawWorkflowRun): HostedCiRun => ({
        id: asId(run.id),
        name: asString(run.name, 'Workflow'),
        status: mapRunStatus(asString(run.status), asString(run.conclusion)),
        url: asString(run.html_url),
        branch: asString(run.head_branch).length === 0 ? null : asString(run.head_branch),
        event: asString(run.event),
        // A queued run has no start time yet; its creation time is the closest honest answer.
        startedAt: asString(run.run_started_at, asString(run.created_at)),
      })),
    };
  }

  /**
   * Opens an issue.
   * @param repository The repository.
   * @param title Its title.
   * @param body Its body, as GitHub markdown, when it has one.
   * @returns Returns the issue opened.
   */
  public async createIssue(
    repository: HostedRepositoryRef,
    title: string,
    body: string | undefined,
  ): Promise<Outcome<HostedIssue>> {
    if (title.trim().length === 0) {
      return { ok: false, error: 'An issue needs a title.', code: 'refused' };
    }
    const sent: Outcome<unknown> = await this.send(
      repository.host,
      'POST',
      `${repoPath(repository)}/issues`,
      { title, ...(body === undefined ? {} : { body }) },
    );
    return sent.ok ? { ok: true, result: toIssue(sent.result ?? {}) } : sent;
  }

  /**
   * Comments on an issue or a pull request. GitHub keeps a pull request's conversation on the issue it
   * is, so one endpoint serves both.
   * @param repository The repository.
   * @param issue The issue's or pull request's number.
   * @param body The comment, as GitHub markdown.
   * @returns Returns the comment written.
   */
  public async commentOnIssue(
    repository: HostedRepositoryRef,
    issue: number,
    body: string,
  ): Promise<Outcome<HostedIssueComment>> {
    if (body.trim().length === 0) {
      return { ok: false, error: 'A comment needs a body.', code: 'refused' };
    }
    const sent: Outcome<unknown> = await this.send(
      repository.host,
      'POST',
      `${repoPath(repository)}/issues/${issueNumber(issue)}/comments`,
      { body },
    );
    return sent.ok ? { ok: true, result: toComment(sent.result ?? {}) } : sent;
  }

  /**
   * Closes or reopens an issue, recording why one was closed.
   * @param repository The repository.
   * @param issue The issue's number.
   * @param state Whether it should be open or closed.
   * @param reason Why it is being closed, when it is.
   * @returns Returns the issue as it now is.
   */
  public async setIssueState(
    repository: HostedRepositoryRef,
    issue: number,
    state: 'open' | 'closed',
    reason: HostedCloseReason | undefined,
  ): Promise<Outcome<HostedIssue>> {
    const stateReason: string | undefined =
      state === 'open' ? 'reopened' : reason === 'notPlanned' ? 'not_planned' : reason;
    const sent: Outcome<unknown> = await this.send(
      repository.host,
      'PATCH',
      `${repoPath(repository)}/issues/${issueNumber(issue)}`,
      { state, ...(stateReason === undefined ? {} : { state_reason: stateReason }) },
    );
    return sent.ok ? { ok: true, result: toIssue(sent.result ?? {}) } : sent;
  }

  /**
   * Opens a pull request from `head` into `base`.
   * @param repository The repository.
   * @param request What to open: its title, branches, body and whether it is a draft.
   * @returns Returns the pull request opened.
   */
  public async createPullRequest(
    repository: HostedRepositoryRef,
    request: {
      readonly title: string;
      readonly head: string;
      readonly base: string;
      readonly body?: string;
      readonly draft?: boolean;
    },
  ): Promise<Outcome<HostedPullRequest>> {
    if (
      request.title.trim().length === 0 ||
      request.head.length === 0 ||
      request.base.length === 0
    ) {
      return {
        ok: false,
        error: 'A pull request needs a title, a head branch and a base branch.',
        code: 'refused',
      };
    }
    const sent: Outcome<unknown> = await this.send(
      repository.host,
      'POST',
      `${repoPath(repository)}/pulls`,
      {
        title: request.title,
        head: request.head,
        base: request.base,
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(request.draft === true ? { draft: true } : {}),
      },
    );
    // Checks start only after it is opened, so a fresh pull request has none to report yet.
    return sent.ok ? { ok: true, result: toPullRequest(sent.result ?? {}, 'none') } : sent;
  }

  /**
   * Re-runs or cancels a workflow run. The run id must be all digits: it reaches the request path, and
   * anything else could extend it.
   * @param repository The repository.
   * @param runId The run.
   * @param action Which command.
   * @returns Returns nothing on success.
   */
  public async runCommand(
    repository: HostedRepositoryRef,
    runId: string,
    action: 'rerun' | 'cancel',
  ): Promise<Outcome<Readonly<Record<string, never>>>> {
    if (!/^\d+$/.test(runId)) {
      return { ok: false, error: 'Invalid workflow run.', code: 'refused' };
    }
    const sent: Outcome<unknown> = await this.send(
      repository.host,
      'POST',
      `${repoPath(repository)}/actions/runs/${runId}/${action}`,
    );
    return sent.ok ? { ok: true, result: {} } : sent;
  }

  /**
   * Reads the account the host's credential authenticates as.
   * @param host The host.
   * @returns Returns the identity.
   */
  private async identity(host: string): Promise<Outcome<HostedIdentity>> {
    const read: Outcome<unknown> = await this.get(host, '/user');
    if (!read.ok) {
      return read;
    }
    const user: RawUser = read.result ?? {};
    const login: string = asString(user.login);
    return login.length === 0
      ? { ok: false, error: 'GitHub returned an account with no login.' }
      : { ok: true, result: { login, name: nameOf(user) } };
  }

  /**
   * Reads the rolled-up check status for a commit. A failure is swallowed to `none` rather than failing
   * the whole listing: a missing badge is a far smaller loss than an empty section.
   * @param repository The repository.
   * @param sha The commit.
   * @returns Returns the rolled-up status.
   */
  private async checksFor(
    repository: HostedRepositoryRef,
    sha: string,
  ): Promise<HostedCheckStatus> {
    const base: string = `${repoPath(repository)}/commits/${encodeURIComponent(sha)}`;
    const [checks, statuses]: [Outcome<unknown>, Outcome<unknown>] = await Promise.all([
      this.get(repository.host, `${base}/check-runs`),
      this.get(repository.host, `${base}/status`),
    ]);
    const wrapper: { readonly check_runs?: unknown } = checks.ok ? (checks.result ?? {}) : {};
    const runs: readonly { status?: unknown; conclusion?: unknown }[] = Array.isArray(
      wrapper.check_runs,
    )
      ? (wrapper.check_runs as readonly { status?: unknown; conclusion?: unknown }[])
      : [];
    return rollUpChecks(runs, statuses.ok ? readStatusState(statuses.result) : '');
  }

  /**
   * Gets a host's cache and budget, dropping both when its credential has changed — a different
   * credential sees different things at the same URL, and carries its own budget.
   * @param host The host.
   * @param token The credential about to be used.
   * @returns Returns the state.
   */
  private stateFor(host: string, token: string): HostState {
    let state: HostState | undefined = this.hosts.get(host);
    if (state === undefined) {
      state = { cache: new EtagCache(), ledger: new RateLimitLedger(this.now), seenToken: null };
      this.hosts.set(host, state);
    }
    if (state.seenToken !== token) {
      state.cache.clear();
      state.ledger.clear();
      state.seenToken = token;
    }
    return state;
  }

  /**
   * Performs an authenticated write with an optional JSON body.
   * @param host The host.
   * @param method The method.
   * @param path The API path.
   * @param body The body, when there is one.
   * @returns Returns the parsed response body, or why the request failed.
   */
  private async send(
    host: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Outcome<unknown>> {
    const credential: ResolvedCredential | null = await this.auth.resolve(host);
    if (credential === null) {
      return notSignedIn(host, this.auth.choiceFor(host));
    }
    debug('github', `${method} ${host}${path}`);
    let response: HttpResponse;
    try {
      response = await this.http(`${originFor(host)}${path}`, {
        method,
        headers: {
          ...headers(credential.token),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error: unknown) {
      return { ok: false, error: messageOf(error) };
    }
    if (!response.ok) {
      return failure(response.status, credential.mode);
    }
    try {
      return { ok: true, result: response.status === 204 ? null : await response.json() };
    } catch {
      // A run command answers 202 with an empty body, which is a success with nothing to read.
      return { ok: true, result: null };
    }
  }

  /**
   * Performs an authenticated GET and returns its parsed body.
   * @param host The host.
   * @param path The API path, including any query string.
   * @returns Returns the parsed body, or why it could not be read.
   */
  private async get(host: string, path: string): Promise<Outcome<unknown>> {
    const credential: ResolvedCredential | null = await this.auth.resolve(host);
    if (credential === null) {
      return notSignedIn(host, this.auth.choiceFor(host));
    }
    const state: HostState = this.stateFor(host, credential.token);
    const blockedUntil: number | null = state.ledger.blockedUntil();
    if (blockedUntil !== null) {
      // Refused here rather than sent and refused by GitHub: spending a request to be told the budget
      // is gone is the one thing that cannot help.
      return rateLimited(blockedUntil);
    }
    const url: string = `${originFor(host)}${path}`;
    const etag: string | null = state.cache.tagFor(url);
    debug('github', `GET ${url}${etag === null ? '' : ' (conditional)'}`);
    let response: HttpResponse;
    try {
      response = await this.http(url, {
        headers: {
          ...headers(credential.token),
          // GitHub does not charge a conditional request that answers 304, so a poll costs nothing
          // while nothing has changed.
          ...(etag === null ? {} : { 'if-none-match': etag }),
        },
      });
    } catch (error: unknown) {
      return { ok: false, error: messageOf(error) };
    }
    state.ledger.record(
      response.header('x-ratelimit-remaining'),
      response.header('x-ratelimit-reset'),
      response.header('retry-after'),
    );
    if (response.status === 304 && state.cache.has(url)) {
      return { ok: true, result: state.cache.bodyFor(url) };
    }
    if (!response.ok) {
      const exhausted: number | null = state.ledger.blockedUntil();
      // A 403 is what both an exhausted budget and a missing scope look like; the headers tell them
      // apart, and the two are answered differently — one by waiting, one by the user.
      return response.status === 403 && exhausted !== null
        ? rateLimited(exhausted)
        : failure(response.status, credential.mode);
    }
    try {
      const body: unknown = await response.json();
      state.cache.store(url, response.header('etag'), body);
      return { ok: true, result: body };
    } catch (error: unknown) {
      return { ok: false, error: messageOf(error) };
    }
  }
}

/**
 * Builds the headers every request carries.
 * @param token The credential.
 * @returns Returns the headers.
 */
function headers(token: string): Readonly<Record<string, string>> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': API_VERSION,
  };
}

/**
 * Reads an account's display name, or null when it has none.
 * @param user The raw account.
 * @returns Returns the name.
 */
function nameOf(user: RawUser): string | null {
  const name: string = asString(user.name);
  return name.length === 0 ? null : name;
}

/**
 * Validates an issue number before it reaches a request path: anything that is not a positive whole
 * number becomes zero, which GitHub answers with a plain 404.
 * @param value The number.
 * @returns Returns it, or zero.
 */
function issueNumber(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * Maps a raw repository to the protocol's.
 * @param host The host it is on.
 * @param raw The raw repository.
 * @returns Returns the repository.
 */
function toRepository(host: string, raw: RawRepository, starred?: boolean): HostedRepository {
  const description: string = asString(raw.description);
  const defaultBranch: string = asString(raw.default_branch);
  const language: string = asString(raw.language);
  return {
    ref: { host, owner: asString(raw.owner?.login), name: asString(raw.name) },
    description: description.length === 0 ? null : description,
    private: raw.private === true,
    defaultBranch: defaultBranch.length === 0 ? null : defaultBranch,
    cloneUrl: asString(raw.clone_url),
    webUrl: asString(raw.html_url),
    updatedAt: asString(raw.updated_at),
    // The 1.2 details (#805). Each is left out when GitHub did not send it, so a reader can tell "not a
    // fork" from "not said".
    ...(raw.language === undefined ? {} : { language: language.length === 0 ? null : language }),
    ...(typeof raw.stargazers_count === 'number' ? { stars: raw.stargazers_count } : {}),
    ...(typeof raw.fork === 'boolean' ? { fork: raw.fork } : {}),
    ...(typeof raw.archived === 'boolean' ? { archived: raw.archived } : {}),
    ...(starred === undefined ? {} : { starred }),
    ...(typeof raw.forks_count === 'number' ? { forks: raw.forks_count } : {}),
    ...(typeof raw.open_issues_count === 'number' ? { openIssues: raw.open_issues_count } : {}),
    ...(Array.isArray(raw.topics)
      ? {
          topics: raw.topics.filter(
            (topic: unknown): topic is string => typeof topic === 'string' && topic.length > 0,
          ),
        }
      : {}),
    ...(raw.license === undefined ? {} : { license: licenseName(raw.license) }),
    ...(raw.homepage === undefined ? {} : { homepage: nonEmpty(raw.homepage) }),
    ...(raw.pushed_at === undefined ? {} : { pushedAt: nonEmpty(raw.pushed_at) }),
  };
}

/**
 * Names a repository's licence: its SPDX id, or — for a licence GitHub does not recognise, which it
 * marks `NOASSERTION` — the name it gives instead.
 * @param license The raw licence, or null for none.
 * @returns Returns the name, or null when there is no licence.
 */
function licenseName(
  license: { readonly spdx_id?: unknown; readonly name?: unknown } | null,
): string | null {
  if (license === null) {
    return null;
  }
  const spdx: string = asString(license.spdx_id);
  if (spdx.length > 0 && spdx !== 'NOASSERTION') {
    return spdx;
  }
  return nonEmpty(license.name);
}

/**
 * Reads an optional string GitHub may send empty: an empty string or a non-string reads as none.
 * @param value The raw value.
 * @returns Returns the string, or null.
 */
function nonEmpty(value: unknown): string | null {
  const text: string = asString(value);
  return text.length === 0 ? null : text;
}

/**
 * Names a raw repository as `owner/name`, lowercased, for matching it against the user's starred list.
 * @param raw The raw repository.
 * @returns Returns its full name.
 */
function fullName(raw: RawRepository): string {
  const named: string = asString(raw.full_name);
  return (
    named.length > 0 ? named : `${asString(raw.owner?.login)}/${asString(raw.name)}`
  ).toLowerCase();
}

/**
 * Maps a raw issue listing to the protocol's issues. GitHub's issues endpoint returns pull requests
 * too, marked by a `pull_request` member; they have their own listing, so they are left out here.
 * @param body The parsed response body.
 * @returns Returns the issues.
 */
function toIssues(body: unknown): readonly HostedIssue[] {
  const raw: readonly RawIssue[] = Array.isArray(body) ? (body as readonly RawIssue[]) : [];
  return raw.filter((issue: RawIssue): boolean => issue.pull_request === undefined).map(toIssue);
}

/**
 * Maps a raw pull request to the protocol's.
 * @param pull The raw pull request.
 * @param checks The combined state of its checks.
 * @returns Returns the pull request.
 */
function toPullRequest(pull: RawPullRequest, checks: HostedCheckStatus): HostedPullRequest {
  return {
    number: asNumber(pull.number),
    title: asString(pull.title, '(untitled)'),
    author: asString(pull.user?.login, 'unknown'),
    url: asString(pull.html_url),
    draft: pull.draft === true,
    headRef: asString(pull.head?.ref),
    // GitHub publishes every pull request's head under this ref on the base repository, which is
    // what makes a fork's pull request checkoutable at all.
    fetchRef: `refs/pull/${asNumber(pull.number)}/head`,
    checks,
  };
}

/**
 * Maps a raw issue comment to the protocol's.
 * @param comment The raw comment.
 * @returns Returns the comment.
 */
function toComment(comment: RawIssueComment): HostedIssueComment {
  return {
    id: asId(comment.id),
    author: asString(comment.user?.login, 'unknown'),
    body: asString(comment.body),
    createdAt: asString(comment.created_at),
    url: asString(comment.html_url),
  };
}

/**
 * Maps a raw issue to the protocol's.
 * @param issue The raw issue.
 * @returns Returns the issue.
 */
function toIssue(issue: RawIssue): HostedIssue {
  return {
    number: asNumber(issue.number),
    title: asString(issue.title, '(untitled)'),
    author: asString(issue.user?.login, 'unknown'),
    url: asString(issue.html_url),
    labels: (issue.labels ?? [])
      .map((label: { readonly name?: unknown }): string => asString(label.name))
      .filter((name: string): boolean => name.length > 0),
    assignees: (issue.assignees ?? [])
      .map((user: RawUser): string => asString(user.login))
      .filter((login: string): boolean => login.length > 0),
    state: asString(issue.state) === 'closed' ? 'closed' : 'open',
    body: asString(issue.body),
    createdAt: asString(issue.created_at),
    updatedAt: asString(issue.updated_at),
    ...(asString(issue.closed_at).length === 0 ? {} : { closedAt: asString(issue.closed_at) }),
    commentCount: asNumber(issue.comments),
    ...(asString(issue.milestone?.title).length === 0
      ? {}
      : { milestone: asString(issue.milestone?.title) }),
  };
}

/**
 * Reads the combined state out of a commit-status response, treating a commit with no statuses as
 * having no state at all rather than as pending.
 * @param body The parsed response body.
 * @returns Returns the combined state, or an empty string when the commit carries no statuses.
 */
function readStatusState(body: unknown): string {
  const wrapper: { readonly state?: unknown; readonly statuses?: unknown } = body ?? {};
  const statuses: readonly unknown[] = Array.isArray(wrapper.statuses) ? wrapper.statuses : [];
  return statuses.length === 0 ? '' : asString(wrapper.state);
}

/**
 * Says a host is not signed in to, and what to do about it — in terms of the way the user chose to
 * sign in, so a user who chose a token is not sent to the CLI, nor one who chose the CLI to a token.
 * @param host The host.
 * @param choice How the user chose to sign in to it, or undefined when the plugin decides.
 * @returns Returns the message.
 */
export function notSignedInDetail(host: string, choice: HostingAuthMode | undefined): string {
  switch (choice) {
    case 'cli':
      return `Not signed in to ${host}. Sign in with the GitHub CLI (\`gh auth login\`), or choose another way to sign in under Settings → Source Control.`;
    case 'studio':
      return `Not signed in to ${host}. Add a token under Settings → Source Control, or choose another way to sign in there.`;
    default:
      return `Not signed in to ${host}. Sign in with the GitHub CLI (\`gh auth login\`), or add a token under Settings → Source Control.`;
  }
}

/**
 * Builds the failure for a host with no credential.
 * @param host The host.
 * @param choice How the user chose to sign in to it, or undefined when the plugin decides.
 * @returns Returns the failure.
 */
function notSignedIn(host: string, choice: HostingAuthMode | undefined): Outcome<never> {
  return { ok: false, error: notSignedInDetail(host, choice), code: 'unauthorized' };
}

/**
 * Builds the failure for an exhausted budget.
 * @param until When it resets, in epoch milliseconds.
 * @returns Returns the failure.
 */
function rateLimited(until: number): Outcome<never> {
  return {
    ok: false,
    error: 'GitHub’s rate limit is exhausted.',
    code: 'rate-limited',
    retryAt: new Date(until).toISOString(),
  };
}

/**
 * Describes an HTTP failure in terms the user can act on.
 * @param status The status code.
 * @param mode How the rejected credential was obtained, which is what the user has to fix.
 * @returns Returns the failure.
 */
function failure(status: number, mode: HostingAuthMode): Outcome<never> {
  switch (status) {
    case 401:
      return {
        ok: false,
        error:
          mode === 'cli'
            ? 'GitHub rejected the GitHub CLI’s login. Sign in again with `gh auth login`.'
            : 'GitHub rejected the token saved in Studio. Replace it under Settings → Source Control.',
        code: 'unauthorized',
      };
    case 403:
      return {
        ok: false,
        error: 'GitHub refused the request — the credential may lack the permission it needs.',
        code: 'forbidden',
      };
    case 404:
      return {
        ok: false,
        error:
          'Not found on GitHub. The repository may be private and the credential unable to see it.',
        code: 'not-found',
      };
    default:
      return { ok: false, error: `GitHub returned HTTP ${status}.` };
  }
}

/**
 * Reads an error's message without assuming it is an Error.
 * @param error The caught value.
 * @returns Returns the message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
