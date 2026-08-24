import {
  ForgeIdentity,
  ForgeIssue,
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
  private readonly routes: readonly Route[];

  /**
   * Initializes a new instance of the {@link FakeHttp} class.
   * @param routes The routes to answer.
   */
  public constructor(routes: readonly Route[]) {
    this.routes = routes;
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
      return Promise.resolve({
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
        json: (): Promise<unknown> => Promise.resolve(route.body),
      });
    };
  }
}

describe('rollUpChecks', () => {
  it('reportsNone_whenThereAreNoChecks', () => {
    // A pull request whose checks have not reported is not "running": the badge stays absent rather
    // than implying work is happening.
    expect(rollUpChecks([])).toBe('none');
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
          checks: 'succeeded',
        },
      ]);
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
