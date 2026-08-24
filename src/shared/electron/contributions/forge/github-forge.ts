import {
  ForgeCheckStatus,
  ForgeIdentity,
  ForgeIssue,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeRunStatus,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';
import { ForgeFetch, ForgeProvider, ForgeResponse, ForgeTokenResolver } from './forge-provider';

/**
 * The REST API origin for github.com. A self-hosted instance would vary this, which is why it is
 * derived from the repository's host rather than hardcoded at the call sites.
 */
const PUBLIC_API_ORIGIN: string = 'https://api.github.com';

/**
 * How many entries a list request asks for. One page is deliberate: the panel's sections are a glance
 * at what is open, not a browser, and paging would cost rate-limit budget for rows nobody scrolls to.
 */
const PAGE_SIZE: number = 50;

/**
 * The API version header GitHub asks integrations to pin, so a future default change cannot silently
 * reshape the responses this maps.
 */
const API_VERSION: string = '2022-11-28';

/**
 * The raw account shape, as much of it as this reads.
 */
interface RawUser {
  readonly login?: unknown;
  readonly name?: unknown;
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
 * The check-run conclusions that mean the user has something to fix. `neutral`, `skipped`, `stale`
 * and `cancelled` are deliberately absent: none of them is a failure to act on.
 */
const FAILING_CONCLUSIONS: readonly string[] = [
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
];

/**
 * Rolls a commit's checks up to the panel's badge status.
 *
 * GitHub reports CI through **two** systems and shows the union of them: check runs (the Checks API,
 * which is what GitHub Actions and most Apps use) and commit statuses (the older Status API, which is
 * what Codecov, Vercel, Travis, Jenkins and friends still use). Reading only the first makes a pull
 * request whose Actions pass but whose commit status failed show green here and red on GitHub.
 *
 * @param runs The check runs for the commit.
 * @param statusState The combined state of the commit's statuses, or an empty string when the commit
 * has none. It must be empty rather than `pending` in that case — the combined-status endpoint reports
 * `pending` for a commit with no statuses at all, and taking that at face value would leave every
 * repository that uses only Actions pulsing for ever.
 * @returns Returns the rolled-up status.
 */
export function rollUpChecks(
  runs: readonly { readonly status?: unknown; readonly conclusion?: unknown }[],
  statusState: string = '',
): ForgeCheckStatus {
  if (runs.length === 0 && statusState.length === 0) {
    // Nothing has reported at all. `none` rather than `running`, so the badge stays absent instead of
    // implying work is happening.
    return 'none';
  }
  // Failure dominates: one failed check is what the user needs to see, whatever the others did.
  const failed: boolean =
    runs.some((run): boolean => FAILING_CONCLUSIONS.includes(asString(run.conclusion))) ||
    statusState === 'failure' ||
    statusState === 'error';
  if (failed) {
    return 'failed';
  }
  const running: boolean =
    runs.some((run): boolean => asString(run.status) !== 'completed') || statusState === 'pending';
  if (running) {
    return 'running';
  }
  // Everything settled and nothing failed.
  return 'succeeded';
}

/**
 * Maps a workflow run's status and conclusion onto the panel's run lifecycle. GitHub splits the two —
 * a finished run reports `completed` with the outcome in `conclusion` — which the panel does not, since
 * "completed" is not something a user wants to read on a row.
 * @param status The run's status.
 * @param conclusion The run's conclusion, present once it has completed.
 * @returns Returns the run status.
 */
export function mapRunStatus(status: string, conclusion: string): ForgeRunStatus {
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
 * The GitHub implementation of the {@link ForgeProvider} seam (#432).
 *
 * Every request is made here in the main process, never the renderer: the token must not cross the
 * boundary, and the renderer is treated as hostile. The token is resolved per request through the
 * injected resolver rather than captured at construction, so pasting or clearing one in settings takes
 * effect immediately.
 *
 * Failures are returned rather than thrown, and a 401 or 403 is distinguished from any other failure so
 * the panel can answer it with "sign in" instead of "try again".
 */
export class GitHubForge implements ForgeProvider {
  /**
   * Gets the forge this provider serves.
   */
  public readonly kind: string = 'github';

  /**
   * Holds the fetch used to reach the API.
   */
  private readonly http: ForgeFetch;

  /**
   * Holds the credential resolver, consulted per request.
   */
  private readonly token: ForgeTokenResolver;

  /**
   * Initializes a new instance of the {@link GitHubForge} class.
   * @param http The fetch used to reach the API.
   * @param token Resolves the credential to authenticate with.
   */
  public constructor(http: ForgeFetch, token: ForgeTokenResolver) {
    this.http = http;
    this.token = token;
  }

  /**
   * Reads the account the current credential authenticates as.
   * @returns Returns the identity, or the reason it could not be read.
   */
  public async identity(): Promise<ForgeResult<ForgeIdentity>> {
    const result: ForgeResult<unknown> = await this.get('github.com', '/user');
    if (!result.ok) {
      return result;
    }
    const user: RawUser = result.value ?? {};
    const login: string = asString(user.login);
    if (login.length === 0) {
      return { ok: false, error: 'GitHub returned an account with no login.', unauthorized: false };
    }
    const name: string = asString(user.name);
    return { ok: true, value: { login, name: name.length === 0 ? null : name } };
  }

  /**
   * Lists a repository's open pull requests, most recently updated first.
   * @param repository The repository to read.
   * @returns Returns the pull requests, or the reason they could not be read.
   */
  public async listPullRequests(
    repository: ForgeRepositoryRef,
  ): Promise<ForgeResult<readonly ForgePullRequest[]>> {
    const path: string = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls?state=open&sort=updated&direction=desc&per_page=${PAGE_SIZE}`;
    const result: ForgeResult<unknown> = await this.get(repository.host, path);
    if (!result.ok) {
      return result;
    }
    const raw: readonly RawPullRequest[] = Array.isArray(result.value)
      ? (result.value as readonly RawPullRequest[])
      : [];
    // Check runs are a request per pull request, so they are fetched together rather than in series —
    // a repository with a dozen open pull requests would otherwise take a dozen round trips.
    const checks: readonly ForgeCheckStatus[] = await Promise.all(
      raw.map((pull: RawPullRequest): Promise<ForgeCheckStatus> => {
        const sha: string = asString(pull.head?.sha);
        return sha.length === 0
          ? Promise.resolve<ForgeCheckStatus>('none')
          : this.checksFor(repository, sha);
      }),
    );
    return {
      ok: true,
      value: raw.map(
        (pull: RawPullRequest, index: number): ForgePullRequest => ({
          number: asNumber(pull.number),
          title: asString(pull.title, '(untitled)'),
          author: asString(pull.user?.login, 'unknown'),
          url: asString(pull.html_url),
          draft: pull.draft === true,
          headRef: asString(pull.head?.ref),
          // GitHub publishes every pull request's head under this ref on the base repository, which
          // is what makes a fork's pull request checkoutable at all.
          headRefspec: `refs/pull/${asNumber(pull.number)}/head`,
          checks: checks[index],
        }),
      ),
    };
  }

  /**
   * Lists a repository's open issues, most recently updated first.
   * @param repository The repository to read.
   * @returns Returns the issues, or the reason they could not be read.
   */
  public async listIssues(
    repository: ForgeRepositoryRef,
  ): Promise<ForgeResult<readonly ForgeIssue[]>> {
    const path: string = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues?state=open&sort=updated&direction=desc&per_page=${PAGE_SIZE}`;
    const result: ForgeResult<unknown> = await this.get(repository.host, path);
    if (!result.ok) {
      return result;
    }
    const raw: readonly RawIssue[] = Array.isArray(result.value)
      ? (result.value as readonly RawIssue[])
      : [];
    return {
      ok: true,
      value: raw
        // GitHub's issues endpoint returns pull requests too, marked by a `pull_request` member. The
        // panel lists them in their own section, so including them here would double-count every one.
        .filter((issue: RawIssue): boolean => issue.pull_request === undefined)
        .map(
          (issue: RawIssue): ForgeIssue => ({
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
          }),
        ),
    };
  }

  /**
   * Lists a repository's recent CI/CD workflow runs, most recent first.
   * @param repository The repository to read.
   * @returns Returns the runs, or the reason they could not be read.
   */
  public async listWorkflowRuns(
    repository: ForgeRepositoryRef,
  ): Promise<ForgeResult<readonly ForgeWorkflowRun[]>> {
    const path: string = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/actions/runs?per_page=${PAGE_SIZE}`;
    const result: ForgeResult<unknown> = await this.get(repository.host, path);
    if (!result.ok) {
      return result;
    }
    const body: { readonly workflow_runs?: unknown } = result.value ?? {};
    const raw: readonly RawWorkflowRun[] = Array.isArray(body.workflow_runs)
      ? (body.workflow_runs as readonly RawWorkflowRun[])
      : [];
    return {
      ok: true,
      value: raw.map(
        (run: RawWorkflowRun): ForgeWorkflowRun => ({
          id: asNumber(run.id),
          name: asString(run.name, 'Workflow'),
          status: mapRunStatus(asString(run.status), asString(run.conclusion)),
          url: asString(run.html_url),
          branch: asString(run.head_branch),
          event: asString(run.event),
          // A queued run has no start time yet; its creation time is the closest honest answer.
          startedAt: asString(run.run_started_at, asString(run.created_at)),
        }),
      ),
    };
  }

  /**
   * Re-runs a workflow run. GitHub starts a new run rather than mutating this one.
   * @param repository The repository the run belongs to.
   * @param runId The run to re-run.
   * @returns Returns nothing on success, or the reason it could not be started.
   */
  public rerunWorkflowRun(
    repository: ForgeRepositoryRef,
    runId: number,
  ): Promise<ForgeResult<void>> {
    return this.post(repository, runId, 'rerun');
  }

  /**
   * Cancels a workflow run that is in flight.
   * @param repository The repository the run belongs to.
   * @param runId The run to cancel.
   * @returns Returns nothing on success, or the reason it could not be cancelled.
   */
  public cancelWorkflowRun(
    repository: ForgeRepositoryRef,
    runId: number,
  ): Promise<ForgeResult<void>> {
    return this.post(repository, runId, 'cancel');
  }

  /**
   * Posts a workflow-run command. The run id is coerced to an integer rather than interpolated as
   * given: it arrives from the renderer, and a non-numeric value would otherwise extend the path.
   * @param repository The repository the run belongs to.
   * @param runId The run to act on.
   * @param action The command's path segment.
   * @returns Returns nothing on success, or the reason it failed.
   */
  private async post(
    repository: ForgeRepositoryRef,
    runId: number,
    action: 'rerun' | 'cancel',
  ): Promise<ForgeResult<void>> {
    const id: number = Math.trunc(runId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return { ok: false, error: 'Invalid workflow run.', unauthorized: false };
    }
    const path: string = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/actions/runs/${id}/${action}`;
    const result: ForgeResult<unknown> = await this.send(repository.host, path);
    return result.ok ? { ok: true, value: undefined } : result;
  }

  /**
   * Reads the rolled-up check status for a commit. A failure here is swallowed to `none` rather than
   * failing the whole listing: a missing badge is a far smaller loss than an empty Pull Requests
   * section, and checks are the one part of the row that is decoration.
   * @param repository The repository the commit is in.
   * @param sha The commit to read checks for.
   * @returns Returns the rolled-up status.
   */
  private async checksFor(repository: ForgeRepositoryRef, sha: string): Promise<ForgeCheckStatus> {
    const base: string = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(sha)}`;
    // Both systems, together rather than in series: they are independent, and a pull request already
    // costs one round trip of its own.
    const [checks, statuses]: [ForgeResult<unknown>, ForgeResult<unknown>] = await Promise.all([
      this.get(repository.host, `${base}/check-runs`),
      this.get(repository.host, `${base}/status`),
    ]);
    const runs: readonly { status?: unknown; conclusion?: unknown }[] = checks.ok
      ? readCheckRuns(checks.value)
      : [];
    return rollUpChecks(runs, statuses.ok ? readStatusState(statuses.value) : '');
  }

  /**
   * Performs an authenticated POST with no body, for the run commands. GitHub answers these with 201
   * or 202 and an empty body, so nothing is parsed back.
   * @param host The forge host, which determines the API origin.
   * @param path The API path.
   * @returns Returns success, or the reason the request failed.
   */
  private async send(host: string, path: string): Promise<ForgeResult<unknown>> {
    const token: string | null = this.token();
    if (token === null) {
      return {
        ok: false,
        error: 'No GitHub token. Add one in Settings → Source Control.',
        unauthorized: true,
      };
    }
    try {
      const response: ForgeResponse = await this.http(`${originFor(host)}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': API_VERSION,
        },
      });
      return response.ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: describeStatus(response.status),
            unauthorized: response.status === 401 || response.status === 403,
          };
    } catch (error: unknown) {
      return { ok: false, error: messageOf(error), unauthorized: false };
    }
  }

  /**
   * Performs an authenticated GET and returns its parsed body, mapping every failure mode onto a
   * result the panel can render.
   * @param host The forge host, which determines the API origin.
   * @param path The API path, including any query string.
   * @returns Returns the parsed body, or the reason it could not be read.
   */
  private async get(host: string, path: string): Promise<ForgeResult<unknown>> {
    const token: string | null = this.token();
    if (token === null) {
      return {
        ok: false,
        error: 'No GitHub token. Add one in Settings → Source Control.',
        unauthorized: true,
      };
    }
    let response: ForgeResponse;
    try {
      response = await this.http(`${originFor(host)}${path}`, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': API_VERSION,
        },
      });
    } catch (error: unknown) {
      // Offline, DNS failure, TLS refusal. The message is the network stack's, which is more useful
      // here than a generic one, but it is never the token — nothing secret reaches this path.
      return { ok: false, error: messageOf(error), unauthorized: false };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: describeStatus(response.status),
        unauthorized: response.status === 401 || response.status === 403,
      };
    }
    try {
      return { ok: true, value: await response.json() };
    } catch (error: unknown) {
      return { ok: false, error: messageOf(error), unauthorized: false };
    }
  }
}

/**
 * Reads the check runs out of a check-runs response.
 * @param body The parsed response body.
 * @returns Returns the check runs, or an empty list when the body is not shaped as expected.
 */
function readCheckRuns(body: unknown): readonly { status?: unknown; conclusion?: unknown }[] {
  const wrapper: { readonly check_runs?: unknown } = body ?? {};
  return Array.isArray(wrapper.check_runs)
    ? (wrapper.check_runs as readonly { status?: unknown; conclusion?: unknown }[])
    : [];
}

/**
 * Reads the combined state out of a commit-status response, treating a commit with no statuses as
 * having no state at all rather than as pending — which is what the endpoint literally reports for it.
 * @param body The parsed response body.
 * @returns Returns the combined state, or an empty string when the commit carries no statuses.
 */
function readStatusState(body: unknown): string {
  const wrapper: { readonly state?: unknown; readonly statuses?: unknown } = body ?? {};
  const statuses: readonly unknown[] = Array.isArray(wrapper.statuses) ? wrapper.statuses : [];
  return statuses.length === 0 ? '' : asString(wrapper.state);
}

/**
 * Resolves a forge host to its REST API origin.
 * @param host The forge host.
 * @returns Returns the API origin.
 */
function originFor(host: string): string {
  // github.com's API lives on a separate hostname; a GitHub Enterprise instance serves it under
  // `/api/v3` on the same host, which is why this is a function rather than a constant.
  return host === 'github.com' || host === 'www.github.com'
    ? PUBLIC_API_ORIGIN
    : `https://${host}/api/v3`;
}

/**
 * Describes an HTTP failure in terms the user can act on.
 * @param status The status code.
 * @returns Returns the message.
 */
function describeStatus(status: number): string {
  switch (status) {
    case 401:
      return 'GitHub rejected the token. Check it in Settings → Source Control.';
    case 403:
      return 'GitHub refused the request — the token may lack the required scope, or the rate limit is exhausted.';
    case 404:
      return 'Not found on GitHub. The repository may be private and the token unable to see it.';
    default:
      return `GitHub returned HTTP ${status}.`;
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
