import {
  ForgeIdentity,
  ForgeIssue,
  ForgeIssueComment,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';
import { ForgeFetch, ForgeResponse } from './forge-provider';
import { GitHubForge, mapRunStatus, rollUpChecks } from './github-forge';

/**
 * The repository every test reads.
 */
const REPOSITORY: ForgeRepositoryRef = {
  kind: 'github',
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * One canned response, matched by a fragment of the requested URL.
 */
interface Route {
  /**
   * Gets the URL fragment this route answers.
   */
  readonly match: string;

  /**
   * Gets the HTTP status to reply with.
   */
  readonly status: number;

  /**
   * Gets the JSON body to reply with.
   */
  readonly body: unknown;

  /**
   * Gets the response headers, keyed lower-case.
   */
  readonly headers?: Record<string, string>;
}

/**
 * Records the requests made and replies from a route table, so the provider can be exercised with no
 * network.
 */
class FakeHttp {
  /**
   * Holds the URLs requested, in order.
   */
  public readonly urls: string[] = [];

  /**
   * Holds the headers of each request, in order.
   */
  public readonly headers: Record<string, string>[] = [];

  /**
   * Holds the routes answered.
   */
  private readonly routes: Route[];

  /**
   * Initializes a new instance of the {@link FakeHttp} class.
   * @param routes The routes to answer.
   */
  public constructor(routes: readonly Route[]) {
    this.routes = [...routes];
  }

  /**
   * Replaces the route matching a fragment, so a second call can answer differently.
   * @param route The replacement route.
   */
  public setRoute(route: Route): void {
    const index: number = this.routes.findIndex(
      (candidate: Route): boolean => candidate.match === route.match,
    );
    if (index === -1) {
      this.routes.push(route);
    } else {
      this.routes[index] = route;
    }
  }

  /**
   * Gets the fetch to hand the provider.
   */
  public get fetch(): ForgeFetch {
    return (url: string, init?: { headers?: Record<string, string> }): Promise<ForgeResponse> => {
      this.urls.push(url);
      this.headers.push(init?.headers ?? {});
      const route: Route | undefined = this.routes.find((candidate: Route): boolean =>
        url.includes(candidate.match),
      );
      if (route === undefined) {
        return Promise.reject(new Error(`No route for ${url}`));
      }
      const headers: Record<string, string> = route.headers ?? {};
      return Promise.resolve({
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
        json: (): Promise<unknown> => Promise.resolve(route.body),
        header: (name: string): string | null => headers[name.toLowerCase()] ?? null,
      });
    };
  }
}

describe('rollUpChecks', () => {
  it('reportsNone_whenNeitherSystemHasReported', () => {
    // A pull request whose checks have not reported is not "running": the badge stays absent rather
    // than implying work is happening.
    expect(rollUpChecks([], '')).toBe('none');
  });

  it('reportsFailed_whenAnyCheckFailed_evenAlongsideRunningOnes', () => {
    expect(
      rollUpChecks([
        { status: 'completed', conclusion: 'success' },
        { status: 'in_progress', conclusion: null },
        { status: 'completed', conclusion: 'failure' },
      ]),
    ).toBe('failed');
  });

  it('reportsRunning_whenAnythingIsStillGoingAndNothingFailed', () => {
    expect(
      rollUpChecks([
        { status: 'completed', conclusion: 'success' },
        { status: 'queued', conclusion: null },
      ]),
    ).toBe('running');
  });

  it('reportsSucceeded_whenEverythingCompletedWithoutFailing', () => {
    // Neutral and skipped are not failures the user must act on, so they do not spoil a green badge.
    expect(
      rollUpChecks([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'skipped' },
        { status: 'completed', conclusion: 'neutral' },
      ]),
    ).toBe('succeeded');
  });

  it('treatsTimedOutAndActionRequiredAsFailures', () => {
    expect(rollUpChecks([{ status: 'completed', conclusion: 'timed_out' }])).toBe('failed');
    expect(rollUpChecks([{ status: 'completed', conclusion: 'action_required' }])).toBe('failed');
  });

  describe('commit statuses — the other system GitHub shows', () => {
    it('reportsFailed_whenAStatusFailedThoughEveryCheckRunPassed', () => {
      // The bug this exists for: Actions green, Codecov (or any Status-API reporter) red. GitHub
      // shows the union and marks the pull request failed; reading only check runs showed it green.
      expect(rollUpChecks([{ status: 'completed', conclusion: 'success' }], 'failure')).toBe(
        'failed',
      );
      expect(rollUpChecks([{ status: 'completed', conclusion: 'success' }], 'error')).toBe(
        'failed',
      );
    });

    it('reportsFailed_whenAStatusFailedAndThereAreNoCheckRunsAtAll', () => {
      // A repository whose CI is entirely Status-API based (Travis, Jenkins) has no check runs.
      expect(rollUpChecks([], 'failure')).toBe('failed');
    });

    it('reportsRunning_whileAStatusIsStillPending', () => {
      expect(rollUpChecks([{ status: 'completed', conclusion: 'success' }], 'pending')).toBe(
        'running',
      );
    });

    it('reportsSucceeded_whenBothSystemsAreGreen', () => {
      expect(rollUpChecks([{ status: 'completed', conclusion: 'success' }], 'success')).toBe(
        'succeeded',
      );
    });

    it('treatsAnAbsentStatusStateAsSilence_notAsPending', () => {
      // The combined-status endpoint reports `pending` for a commit with NO statuses at all, so the
      // caller passes an empty string instead. Taking the endpoint at its word would leave every
      // repository that uses only Actions pulsing for ever.
      expect(rollUpChecks([{ status: 'completed', conclusion: 'success' }], '')).toBe('succeeded');
    });
  });
});

describe('mapRunStatus', () => {
  it('mapsTheQueuedStates', () => {
    expect(mapRunStatus('queued', '')).toBe('queued');
    expect(mapRunStatus('requested', '')).toBe('queued');
    expect(mapRunStatus('waiting', '')).toBe('queued');
  });

  it('mapsAnythingElseUnfinishedToRunning', () => {
    expect(mapRunStatus('in_progress', '')).toBe('running');
    expect(mapRunStatus('pending', '')).toBe('running');
  });

  it('resolvesACompletedRunByItsConclusion', () => {
    // GitHub reports a finished run as `completed` with the outcome in `conclusion`; "completed" is
    // not something a user wants to read on a row.
    expect(mapRunStatus('completed', 'success')).toBe('succeeded');
    expect(mapRunStatus('completed', 'failure')).toBe('failed');
    expect(mapRunStatus('completed', 'cancelled')).toBe('cancelled');
    expect(mapRunStatus('completed', 'skipped')).toBe('cancelled');
    expect(mapRunStatus('completed', 'timed_out')).toBe('failed');
  });
});

describe('GitHubForge', () => {
  /**
   * Builds a provider over a route table with a token present.
   * @param routes The routes to answer.
   * @param token The token to resolve, or null for none.
   * @returns Returns the provider and its fake transport.
   */
  function setup(
    routes: readonly Route[],
    token: string | null = 'ghp_test',
  ): { forge: GitHubForge; http: FakeHttp } {
    const http: FakeHttp = new FakeHttp(routes);
    return { forge: new GitHubForge(http.fetch, (): string | null => token), http };
  }

  describe('identity', () => {
    it('readsTheAuthenticatedAccount', async () => {
      const { forge, http } = setup([
        { match: '/user', status: 200, body: { login: 'matthew', name: 'Matthew Layton' } },
      ]);

      const result: ForgeResult<ForgeIdentity> = await forge.identity();

      expect(result).toEqual({
        ok: true,
        value: { login: 'matthew', name: 'Matthew Layton' },
      });
      expect(http.urls[0]).toBe('https://api.github.com/user');
    });

    it('sendsTheBearerTokenAndPinsTheApiVersion', async () => {
      const { forge, http } = setup([{ match: '/user', status: 200, body: { login: 'matthew' } }]);

      await forge.identity();

      expect(http.headers[0]['authorization']).toBe('Bearer ghp_test');
      expect(http.headers[0]['x-github-api-version']).toBe('2022-11-28');
    });

    it('reportsAnAccountWithNoDisplayNameAsNull', async () => {
      const { forge } = setup([{ match: '/user', status: 200, body: { login: 'matthew' } }]);

      const result: ForgeResult<ForgeIdentity> = await forge.identity();

      expect(result).toEqual({ ok: true, value: { login: 'matthew', name: null } });
    });

    it('failsAsUnauthorized_whenNoTokenResolves', async () => {
      const { forge, http } = setup([], null);

      const result: ForgeResult<ForgeIdentity> = await forge.identity();

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.unauthorized).toBe(true);
      // No request is made at all when there is nothing to authenticate with.
      expect(http.urls).toEqual([]);
    });

    it('failsAsUnauthorized_whenTheTokenIsRejected', async () => {
      const { forge } = setup([{ match: '/user', status: 401, body: {} }]);

      const result: ForgeResult<ForgeIdentity> = await forge.identity();

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.unauthorized).toBe(true);
      expect(result.ok === false && result.error).toContain('rejected the token');
    });

    it('failsAsUnauthorized_onAForbiddenResponse', async () => {
      // 403 is what an exhausted rate limit and a missing scope both look like; both are answered by
      // going to settings rather than by retrying.
      const { forge } = setup([{ match: '/user', status: 403, body: {} }]);

      const result: ForgeResult<ForgeIdentity> = await forge.identity();

      expect(result.ok === false && result.unauthorized).toBe(true);
    });

    it('failsWithoutClaimingUnauthorized_onANetworkError', async () => {
      const { forge } = setup([]);

      const result: ForgeResult<ForgeIdentity> = await forge.identity();

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.unauthorized).toBe(false);
    });

    it('resolvesTheTokenPerRequest_soAPastedTokenTakesEffectImmediately', async () => {
      const http: FakeHttp = new FakeHttp([
        { match: '/user', status: 200, body: { login: 'matthew' } },
      ]);
      let token: string | null = null;
      const forge: GitHubForge = new GitHubForge(http.fetch, (): string | null => token);

      const before: ForgeResult<ForgeIdentity> = await forge.identity();
      token = 'ghp_pasted';
      const after: ForgeResult<ForgeIdentity> = await forge.identity();

      expect(before.ok).toBe(false);
      expect(after.ok).toBe(true);
    });
  });

  describe('listPullRequests', () => {
    it('mapsPullRequestsAndRollsUpTheirChecks', async () => {
      const { forge } = setup([
        {
          match: '/pulls',
          status: 200,
          body: [
            {
              number: 7,
              title: 'Add the thing',
              html_url: 'https://github.com/onix-labs/onixlabs-studio/pull/7',
              draft: false,
              user: { login: 'matthew' },
              head: { ref: 'feature/thing', sha: 'abc123' },
            },
          ],
        },
        {
          match: '/check-runs',
          status: 200,
          body: { check_runs: [{ status: 'completed', conclusion: 'success' }] },
        },
      ]);

      const result: ForgeResult<readonly ForgePullRequest[]> =
        await forge.listPullRequests(REPOSITORY);

      expect(result.ok).toBe(true);
      expect(result.ok === true && result.value).toEqual([
        {
          number: 7,
          title: 'Add the thing',
          author: 'matthew',
          url: 'https://github.com/onix-labs/onixlabs-studio/pull/7',
          draft: false,
          headRef: 'feature/thing',
          headRefspec: 'refs/pull/7/head',
          checks: 'succeeded',
        },
      ]);
    });

    it('marksAPullRequestFailed_whenOnlyItsCommitStatusFailed', async () => {
      const { forge } = setup([
        {
          match: '/pulls',
          status: 200,
          body: [{ number: 7, title: 'X', head: { ref: 'f', sha: 'abc' }, user: { login: 'm' } }],
        },
        {
          match: '/check-runs',
          status: 200,
          body: { check_runs: [{ status: 'completed', conclusion: 'success' }] },
        },
        {
          match: '/status',
          status: 200,
          body: { state: 'failure', statuses: [{ state: 'failure', context: 'codecov' }] },
        },
      ]);

      const result: ForgeResult<readonly ForgePullRequest[]> =
        await forge.listPullRequests(REPOSITORY);

      expect(result.ok === true && result.value[0].checks).toBe('failed');
    });

    it('ignoresTheCombinedStatus_whenTheCommitCarriesNoStatuses', async () => {
      // Verified against the real API: a commit with no statuses reports `state: 'pending'`.
      const { forge } = setup([
        {
          match: '/pulls',
          status: 200,
          body: [{ number: 7, title: 'X', head: { ref: 'f', sha: 'abc' }, user: { login: 'm' } }],
        },
        {
          match: '/check-runs',
          status: 200,
          body: { check_runs: [{ status: 'completed', conclusion: 'success' }] },
        },
        { match: '/status', status: 200, body: { state: 'pending', statuses: [] } },
      ]);

      const result: ForgeResult<readonly ForgePullRequest[]> =
        await forge.listPullRequests(REPOSITORY);

      expect(result.ok === true && result.value[0].checks).toBe('succeeded');
    });

    it('degradesTheBadgeRatherThanTheListing_whenChecksCannotBeRead', async () => {
      // A missing badge is a far smaller loss than an empty Pull Requests section.
      const { forge } = setup([
        {
          match: '/pulls',
          status: 200,
          body: [{ number: 7, title: 'X', head: { ref: 'f', sha: 'abc' }, user: { login: 'm' } }],
        },
        { match: '/check-runs', status: 500, body: {} },
      ]);

      const result: ForgeResult<readonly ForgePullRequest[]> =
        await forge.listPullRequests(REPOSITORY);

      expect(result.ok).toBe(true);
      expect(result.ok === true && result.value[0].checks).toBe('none');
    });

    it('survivesFieldsTheApiOmits', async () => {
      // The API is external input: a field that is absent or another type must not throw.
      const { forge } = setup([{ match: '/pulls', status: 200, body: [{}] }]);

      const result: ForgeResult<readonly ForgePullRequest[]> =
        await forge.listPullRequests(REPOSITORY);

      expect(result.ok === true && result.value[0]).toEqual({
        number: 0,
        title: '(untitled)',
        author: 'unknown',
        url: '',
        draft: false,
        headRef: '',
        headRefspec: 'refs/pull/0/head',
        checks: 'none',
      });
    });

    it('escapesTheRepositoryIntoThePath', async () => {
      const { forge, http } = setup([{ match: '/pulls', status: 200, body: [] }]);

      await forge.listPullRequests({ ...REPOSITORY, owner: 'a b', name: 'c d' });

      expect(http.urls[0]).toContain('/repos/a%20b/c%20d/pulls');
    });
  });

  describe('listIssues', () => {
    it('mapsIssuesWithLabelsAndAssignees', async () => {
      const { forge } = setup([
        {
          match: '/issues',
          status: 200,
          body: [
            {
              number: 12,
              title: 'Something is broken',
              html_url: 'https://github.com/onix-labs/onixlabs-studio/issues/12',
              user: { login: 'matthew' },
              labels: [{ name: 'bug' }, { name: 'area:git' }],
              assignees: [{ login: 'matthew' }],
              state: 'open',
              body: 'Steps to reproduce are in the log.',
              created_at: '2026-08-01T10:00:00Z',
              updated_at: '2026-08-02T11:30:00Z',
              comments: 3,
              milestone: { title: 'v0.13' },
            },
          ],
        },
      ]);

      const result: ForgeResult<readonly ForgeIssue[]> = await forge.listIssues(REPOSITORY);

      expect(result.ok === true && result.value).toEqual([
        {
          number: 12,
          title: 'Something is broken',
          author: 'matthew',
          url: 'https://github.com/onix-labs/onixlabs-studio/issues/12',
          labels: ['bug', 'area:git'],
          assignees: ['matthew'],
          // Everything below already rides on the list response; asking for it again per issue would
          // spend a request to learn what has been read and thrown away.
          state: 'open',
          body: 'Steps to reproduce are in the log.',
          createdAt: '2026-08-01T10:00:00Z',
          updatedAt: '2026-08-02T11:30:00Z',
          commentCount: 3,
          milestone: 'v0.13',
        },
      ]);
    });

    it('mapsAnIssueThatIsClosed_andCarriesNoMilestone', async () => {
      const { forge } = setup([
        {
          match: '/issues',
          status: 200,
          body: [
            {
              number: 9,
              title: 'Done',
              html_url: 'https://example.com/9',
              user: { login: 'matthew' },
              state: 'closed',
              closed_at: '2026-08-03T09:00:00Z',
              milestone: null,
            },
          ],
        },
      ]);

      const result: ForgeResult<readonly ForgeIssue[]> = await forge.listIssues(REPOSITORY);
      const issue: ForgeIssue | undefined = result.ok === true ? result.value[0] : undefined;

      expect(issue?.state).toBe('closed');
      expect(issue?.closedAt).toBe('2026-08-03T09:00:00Z');
      // Absent rather than empty: there is no milestone, which is not the same as one called "".
      expect(issue?.milestone).toBeUndefined();
      expect(issue?.commentCount).toBe(0);
    });

    it('listIssueComments_readsTheConversationOldestFirst', async () => {
      const { forge } = setup([
        {
          match: '/issues/12/comments',
          status: 200,
          body: [
            {
              id: 5001,
              user: { login: 'matthew' },
              body: 'Reproduced on main.',
              created_at: '2026-08-02T09:00:00Z',
              html_url: 'https://example.com/9#issuecomment-5001',
            },
          ],
        },
      ]);

      const result: ForgeResult<readonly ForgeIssueComment[]> = await forge.listIssueComments(
        REPOSITORY,
        12,
      );

      expect(result.ok === true && result.value).toEqual([
        {
          id: 5001,
          author: 'matthew',
          body: 'Reproduced on main.',
          createdAt: '2026-08-02T09:00:00Z',
          url: 'https://example.com/9#issuecomment-5001',
        },
      ]);
    });

    it('excludesPullRequests_whichTheIssuesEndpointAlsoReturns', async () => {
      // GitHub models a pull request as an issue. Including them here would double-count every one
      // against the Pull Requests section.
      const { forge } = setup([
        {
          match: '/issues',
          status: 200,
          body: [
            { number: 12, title: 'A real issue', user: { login: 'm' } },
            { number: 13, title: 'A pull request', user: { login: 'm' }, pull_request: {} },
          ],
        },
      ]);

      const result: ForgeResult<readonly ForgeIssue[]> = await forge.listIssues(REPOSITORY);

      expect(
        result.ok === true && result.value.map((issue: ForgeIssue): number => issue.number),
      ).toEqual([12]);
    });
  });

  describe('listWorkflowRuns', () => {
    it('mapsRunsFromTheWrappedBody', async () => {
      const { forge } = setup([
        {
          match: '/actions/runs',
          status: 200,
          body: {
            workflow_runs: [
              {
                id: 99,
                name: 'CI',
                status: 'completed',
                conclusion: 'failure',
                html_url: 'https://github.com/onix-labs/onixlabs-studio/actions/runs/99',
                head_branch: 'main',
                event: 'push',
                run_started_at: '2026-08-24T10:00:00Z',
              },
            ],
          },
        },
      ]);

      const result: ForgeResult<readonly ForgeWorkflowRun[]> =
        await forge.listWorkflowRuns(REPOSITORY);

      expect(result.ok === true && result.value).toEqual([
        {
          id: 99,
          name: 'CI',
          status: 'failed',
          url: 'https://github.com/onix-labs/onixlabs-studio/actions/runs/99',
          branch: 'main',
          event: 'push',
          startedAt: '2026-08-24T10:00:00Z',
        },
      ]);
    });

    it('fallsBackToTheCreationTime_whenAQueuedRunHasNotStarted', async () => {
      const { forge } = setup([
        {
          match: '/actions/runs',
          status: 200,
          body: {
            workflow_runs: [{ id: 1, status: 'queued', created_at: '2026-08-24T09:00:00Z' }],
          },
        },
      ]);

      const result: ForgeResult<readonly ForgeWorkflowRun[]> =
        await forge.listWorkflowRuns(REPOSITORY);

      expect(result.ok === true && result.value[0].startedAt).toBe('2026-08-24T09:00:00Z');
      expect(result.ok === true && result.value[0].status).toBe('queued');
    });

    it('yieldsAnEmptyList_whenTheBodyIsNotShapedAsExpected', async () => {
      const { forge } = setup([{ match: '/actions/runs', status: 200, body: {} }]);

      const result: ForgeResult<readonly ForgeWorkflowRun[]> =
        await forge.listWorkflowRuns(REPOSITORY);

      expect(result).toEqual({ ok: true, value: [] });
    });
  });
});

describe('conditional requests and the rate limit', () => {
  /**
   * The identity route, which every test here reads through.
   * @param overrides The route fields to vary.
   * @returns Returns the route.
   */
  function userRoute(overrides: Partial<Route> = {}): Route {
    return { match: '/user', status: 200, body: { login: 'matthew' }, ...overrides };
  }

  it('sendsNoEntityTagOnTheFirstRead_thenRevalidatesWithTheOneItWasGiven', async () => {
    const http: FakeHttp = new FakeHttp([userRoute({ headers: { etag: 'W/"abc"' } })]);
    const forge: GitHubForge = new GitHubForge(http.fetch, (): string => 'ghp_test');

    await forge.identity();
    await forge.identity();

    expect(http.headers[0]['if-none-match']).toBeUndefined();
    expect(http.headers[1]['if-none-match']).toBe('W/"abc"');
  });

  it('servesTheCachedBodyOnNotModified_ratherThanAnEmptyOne', async () => {
    // A 304 carries no body at all; reading one would yield nothing and look like an emptied section.
    const http: FakeHttp = new FakeHttp([userRoute({ headers: { etag: 'W/"abc"' } })]);
    const forge: GitHubForge = new GitHubForge(http.fetch, (): string => 'ghp_test');
    await forge.identity();

    http.setRoute({ match: '/user', status: 304, body: undefined });
    const result: ForgeResult<ForgeIdentity> = await forge.identity();

    expect(result).toEqual({ ok: true, value: { login: 'matthew', name: null } });
  });

  it('doesNotCacheAResponseWithNoEntityTag_sinceItCouldNeverBeRevalidated', async () => {
    const http: FakeHttp = new FakeHttp([userRoute()]);
    const forge: GitHubForge = new GitHubForge(http.fetch, (): string => 'ghp_test');

    await forge.identity();
    await forge.identity();

    expect(http.headers[1]['if-none-match']).toBeUndefined();
  });

  it('dropsTheCacheWhenTheCredentialChanges', async () => {
    // Two accounts do not see the same things at the same URL; serving one's body to the other would
    // be a leak rather than a stale read.
    const http: FakeHttp = new FakeHttp([userRoute({ headers: { etag: 'W/"abc"' } })]);
    let token: string = 'ghp_one';
    const forge: GitHubForge = new GitHubForge(http.fetch, (): string => token);
    await forge.identity();

    token = 'ghp_two';
    await forge.identity();

    expect(http.headers[1]['if-none-match']).toBeUndefined();
  });

  it('stopsAskingOnceTheBudgetIsNearlySpent_andSaysWhenItResumes', async () => {
    const reset: number = 4_000;
    const http: FakeHttp = new FakeHttp([
      userRoute({
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      }),
    ]);
    const forge: GitHubForge = new GitHubForge(
      http.fetch,
      (): string => 'ghp_test',
      (): number => 1_000_000,
    );

    await forge.identity();
    const result: ForgeResult<ForgeIdentity> = await forge.identity();

    expect(result.ok).toBe(false);
    // Refused here, not sent: spending a request to be told the budget is gone cannot help.
    expect(http.urls.length).toBe(1);
    expect(result.ok === false && result.retryAt).toBe(reset * 1000);
    // A budget failure is not an authentication one, and must not send the user to settings.
    expect(result.ok === false && result.unauthorized).toBe(false);
  });

  it('holdsBackAReserve_ratherThanSpendingToTheLastRequest', async () => {
    // Studio is rarely the only thing on a token; the last few belong to whatever the user does next.
    const http: FakeHttp = new FakeHttp([
      userRoute({
        headers: { 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': '4000' },
      }),
    ]);
    const forge: GitHubForge = new GitHubForge(
      http.fetch,
      (): string => 'ghp_test',
      (): number => 1_000_000,
    );

    await forge.identity();
    const result: ForgeResult<ForgeIdentity> = await forge.identity();

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.retryAt).toBe(4_000_000);
  });

  it('recoversOnItsOwn_onceTheWindowHasRolledOver', async () => {
    const http: FakeHttp = new FakeHttp([
      userRoute({
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4000' },
      }),
    ]);
    let now: number = 1_000_000;
    const forge: GitHubForge = new GitHubForge(
      http.fetch,
      (): string => 'ghp_test',
      (): number => now,
    );
    await forge.identity();
    expect((await forge.identity()).ok).toBe(false);

    // Past the reset, without any response having proved it — which is what lets the panel recover
    // rather than waiting for a request nobody will make.
    now = 4_000_001;

    expect((await forge.identity()).ok).toBe(true);
  });

  it('tellsAnExhaustedBudgetApartFromAMissingScope_bothOfWhichAre403', async () => {
    const http: FakeHttp = new FakeHttp([
      userRoute({
        status: 403,
        body: {},
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4000' },
      }),
    ]);
    const forge: GitHubForge = new GitHubForge(
      http.fetch,
      (): string => 'ghp_test',
      (): number => 1_000_000,
    );

    const limited: ForgeResult<ForgeIdentity> = await forge.identity();

    expect(limited.ok === false && limited.retryAt).toBe(4_000_000);
    expect(limited.ok === false && limited.unauthorized).toBe(false);

    // The same status with no budget headers is a scope problem, and does send the user to settings.
    const plain: FakeHttp = new FakeHttp([userRoute({ status: 403, body: {} })]);
    const scoped: ForgeResult<ForgeIdentity> = await new GitHubForge(
      plain.fetch,
      (): string => 'ghp_test',
    ).identity();

    expect(scoped.ok === false && scoped.unauthorized).toBe(true);
    expect(scoped.ok === false && scoped.retryAt).toBeUndefined();
  });

  it('honoursRetryAfter_theSecondaryLimitsOwnMechanism', async () => {
    const http: FakeHttp = new FakeHttp([
      userRoute({ status: 403, body: {}, headers: { 'retry-after': '60' } }),
    ]);
    const forge: GitHubForge = new GitHubForge(
      http.fetch,
      (): string => 'ghp_test',
      (): number => 1_000_000,
    );

    const result: ForgeResult<ForgeIdentity> = await forge.identity();

    expect(result.ok === false && result.retryAt).toBe(1_000_000 + 60_000);
  });

  it('leavesTheLedgerAloneWhenAResponseCarriesNoBudgetHeaders', async () => {
    // An unrelated failure must not look like a budget that has recovered.
    const http: FakeHttp = new FakeHttp([
      userRoute({
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4000' },
      }),
    ]);
    const forge: GitHubForge = new GitHubForge(
      http.fetch,
      (): string => 'ghp_test',
      (): number => 1_000_000,
    );
    await forge.identity();

    http.setRoute({ match: '/user', status: 500, body: {} });

    expect((await forge.identity()).ok).toBe(false);
    expect(http.urls.length).toBe(1);
  });
});
