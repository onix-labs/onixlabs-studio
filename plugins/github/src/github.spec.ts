import { describe, expect, it } from 'vitest';
import { GitHubAuth } from './auth';
import {
  GitHubHosting,
  Http,
  HttpResponse,
  mapRunStatus,
  notSignedInDetail,
  Outcome,
  rollUpChecks,
} from './github';
import {
  HostedAccount,
  HostedAuthStatus,
  HostedCiRun,
  HostedIssue,
  HostedIssueComment,
  HostedPullRequest,
  HostedRepository,
  HostedRepositoryRef,
  HostingCapability,
} from './protocol';

/**
 * The repository every test reads.
 */
const REPOSITORY: HostedRepositoryRef = {
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * One canned response, matched by a fragment of the requested URL.
 */
interface Route {
  readonly match: string;
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * Records the requests made and replies from a route table, so the client runs with no network.
 */
class FakeHttp {
  /**
   * Gets each request, in order.
   */
  public readonly requests: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }[] = [];

  /**
   * Holds the routes answered, first match wins.
   */
  private readonly routes: Route[];

  /**
   * Initializes the fake.
   * @param routes The routes to answer.
   */
  public constructor(routes: readonly Route[]) {
    this.routes = [...routes];
  }

  /**
   * Gets the URLs requested, in order.
   * @returns Returns the URLs.
   */
  public get urls(): readonly string[] {
    return this.requests.map((request) => request.url);
  }

  /**
   * Replaces the route matching a fragment, so a later call can answer differently.
   * @param route The replacement route.
   */
  public setRoute(route: Route): void {
    const index: number = this.routes.findIndex((candidate) => candidate.match === route.match);
    if (index === -1) {
      this.routes.push(route);
    } else {
      this.routes[index] = route;
    }
  }

  /**
   * Gets the fetch to hand the client.
   * @returns Returns the fetch.
   */
  public get fetch(): Http {
    return (url, init): Promise<HttpResponse> => {
      this.requests.push({
        url,
        method: init.method ?? 'GET',
        headers: { ...init.headers },
        ...(init.body === undefined ? {} : { body: init.body }),
      });
      const route: Route | undefined = this.routes.find((candidate) =>
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

/**
 * Builds a resolver whose only credential is Studio's — no CLI — read afresh each time.
 * @param token Reads the token, or null for none.
 * @returns Returns the resolver.
 */
function studioOnly(token: () => string | null): GitHubAuth {
  return new GitHubAuth(
    () => Promise.resolve(null),
    () => Promise.resolve(token()),
  );
}

/**
 * Builds a client over a route table with a token present.
 * @param routes The routes to answer.
 * @param token The token, or null for none.
 * @param now The clock.
 * @returns Returns the client and its fake transport.
 */
function setup(
  routes: readonly Route[],
  token: string | null = 'ghp_test',
  now: () => number = Date.now,
): { github: GitHubHosting; http: FakeHttp } {
  const http: FakeHttp = new FakeHttp(routes);
  return {
    github: new GitHubHosting(
      http.fetch,
      studioOnly(() => token),
      now,
    ),
    http,
  };
}

describe('rollUpChecks', () => {
  it('reportsNone_whenNeitherSystemHasReported', () => {
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

  it('readsCommitStatuses_theOtherSystemGitHubShows', () => {
    // Actions green, Codecov (or any Status-API reporter) red: GitHub shows the union.
    expect(rollUpChecks([{ status: 'completed', conclusion: 'success' }], 'failure')).toBe(
      'failed',
    );
    expect(rollUpChecks([], 'error')).toBe('failed');
    expect(rollUpChecks([{ status: 'completed', conclusion: 'success' }], 'pending')).toBe(
      'running',
    );
    expect(rollUpChecks([{ status: 'completed', conclusion: 'success' }], 'success')).toBe(
      'succeeded',
    );
    // An absent state is silence, not pending.
    expect(rollUpChecks([{ status: 'completed', conclusion: 'success' }], '')).toBe('succeeded');
  });
});

describe('mapRunStatus', () => {
  it('mapsQueuedRunningAndCompletedRuns', () => {
    expect(mapRunStatus('queued', '')).toBe('queued');
    expect(mapRunStatus('requested', '')).toBe('queued');
    expect(mapRunStatus('waiting', '')).toBe('queued');
    expect(mapRunStatus('in_progress', '')).toBe('running');
    expect(mapRunStatus('completed', 'success')).toBe('succeeded');
    expect(mapRunStatus('completed', 'failure')).toBe('failed');
    expect(mapRunStatus('completed', 'cancelled')).toBe('cancelled');
    expect(mapRunStatus('completed', 'skipped')).toBe('cancelled');
    expect(mapRunStatus('completed', 'timed_out')).toBe('failed');
  });
});

describe('GitHubHosting', () => {
  describe('authStatus', () => {
    it('readsTheAuthenticatedAccount_andSaysHowItSignedIn', async () => {
      const { github, http } = setup([
        { match: '/user', status: 200, body: { login: 'matthew', name: 'Matthew Layton' } },
      ]);

      const status: Outcome<HostedAuthStatus> = await github.authStatus('github.com');

      expect(status).toEqual({
        ok: true,
        result: {
          authenticated: true,
          mode: 'studio',
          identity: { login: 'matthew', name: 'Matthew Layton' },
          detail: 'Signed in as matthew.',
        },
      });
      expect(http.urls[0]).toBe('https://api.github.com/user');
    });

    it('sendsTheBearerTokenAndPinsTheApiVersion', async () => {
      const { github, http } = setup([{ match: '/user', status: 200, body: { login: 'm' } }]);

      await github.authStatus('github.com');

      expect(http.requests[0].headers['authorization']).toBe('Bearer ghp_test');
      expect(http.requests[0].headers['x-github-api-version']).toBe('2022-11-28');
    });

    it('saysNotSignedIn_withoutARequest_whenThereIsNoCredential', async () => {
      const { github, http } = setup([], null);

      const status: Outcome<HostedAuthStatus> = await github.authStatus('github.com');

      expect(status.ok && status.result.authenticated).toBe(false);
      expect(status.ok && status.result.mode).toBeNull();
      expect(http.urls).toEqual([]);
    });

    it('saysNotSignedIn_whenTheCredentialIsRejected', async () => {
      const { github } = setup([{ match: '/user', status: 401, body: {} }]);

      const status: Outcome<HostedAuthStatus> = await github.authStatus('github.com');

      expect(status.ok && status.result.authenticated).toBe(false);
      // The test's credential is the token Studio keeps, so that is what the user is sent to fix.
      expect(status.ok && status.result.detail).toBe(
        'GitHub rejected the token saved in Studio. Replace it under Settings → Source Control.',
      );
    });

    it('notSignedIn_pointsAtTheWayTheUserChoseToSignIn', () => {
      // A user who chose a token is not sent to the CLI, nor one who chose the CLI to a token.
      expect(notSignedInDetail('github.com', 'studio')).toBe(
        'Not signed in to github.com. Add a token under Settings → Source Control, or choose another way to sign in there.',
      );
      expect(notSignedInDetail('github.com', 'cli')).toContain('`gh auth login`');
      expect(notSignedInDetail('github.com', 'cli')).not.toContain('Add a token');
      expect(notSignedInDetail('github.com', undefined)).toContain('`gh auth login`');
      expect(notSignedInDetail('github.com', undefined)).toContain('add a token');
    });

    it('servesAGitHubEnterpriseHostUnderApiV3', async () => {
      const { github, http } = setup([{ match: '/user', status: 200, body: { login: 'm' } }]);

      await github.authStatus('ghe.example.com');

      expect(http.urls[0]).toBe('https://ghe.example.com/api/v3/user');
    });
  });

  describe('failures', () => {
    it('codesEachFailureSoASurfaceCanAnswerItTheRightWay', async () => {
      const codes: Record<number, string | undefined> = {};
      for (const status of [401, 403, 404, 500]) {
        const { github } = setup([{ match: '/issues', status, body: {} }]);
        const outcome: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);
        codes[status] = outcome.ok ? 'ok' : outcome.code;
      }

      // A 403 without budget headers is a missing permission, not a sign-in problem.
      expect(codes).toEqual({
        401: 'unauthorized',
        403: 'forbidden',
        404: 'not-found',
        500: undefined,
      });
    });

    it('codesNoCredentialAsUnauthorized', async () => {
      const { github } = setup([], null);

      const outcome: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);

      expect(outcome).toMatchObject({ ok: false, code: 'unauthorized' });
    });

    it('reportsANetworkError_withoutCodingItAsUnauthorized', async () => {
      const { github } = setup([]);

      const outcome: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.code).toBeUndefined();
    });

    it('resolvesTheCredentialPerRequest_soAPastedTokenTakesEffectImmediately', async () => {
      const http: FakeHttp = new FakeHttp([{ match: '/issues', status: 200, body: [] }]);
      let token: string | null = null;
      const github: GitHubHosting = new GitHubHosting(
        http.fetch,
        studioOnly(() => token),
      );

      const before: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);
      token = 'ghp_pasted';
      const after: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);

      expect(before.ok).toBe(false);
      expect(after.ok).toBe(true);
    });
  });

  describe('accounts and repositories', () => {
    it('listAccounts_listsTheUserThenTheirOrganisations', async () => {
      const { github } = setup([
        { match: '/user/orgs', status: 200, body: [{ login: 'onix-labs' }] },
        { match: '/user', status: 200, body: { login: 'matthew', name: 'Matthew' } },
      ]);

      const accounts: Outcome<readonly HostedAccount[]> = await github.listAccounts('github.com');

      expect(accounts).toEqual({
        ok: true,
        result: [
          { login: 'matthew', name: 'Matthew', kind: 'user' },
          { login: 'onix-labs', name: null, kind: 'organization' },
        ],
      });
    });

    it('listRepositories_readsTheUsersOwn_andAnOrganisationsByItsName', async () => {
      const repository: unknown = {
        name: 'studio',
        owner: { login: 'onix-labs' },
        description: 'An IDE',
        private: true,
        default_branch: 'main',
        clone_url: 'https://github.com/onix-labs/studio.git',
        html_url: 'https://github.com/onix-labs/studio',
        updated_at: '2026-10-05T10:00:00Z',
      };
      const { github, http } = setup([
        { match: '/user/repos', status: 200, body: [] },
        { match: '/user/starred', status: 200, body: [] },
        { match: '/orgs/onix-labs/repos', status: 200, body: [repository] },
        { match: '/user', status: 200, body: { login: 'matthew' } },
      ]);

      await github.listRepositories('github.com', 'Matthew');
      const org: Outcome<readonly HostedRepository[]> = await github.listRepositories(
        'github.com',
        'onix-labs',
      );

      // #805: the user's own listing includes what they collaborate on.
      expect(
        http.urls.some((url) => url.includes('/user/repos?affiliation=owner,collaborator')),
      ).toBe(true);
      expect(org).toEqual({
        ok: true,
        result: [
          {
            ref: { host: 'github.com', owner: 'onix-labs', name: 'studio' },
            description: 'An IDE',
            private: true,
            defaultBranch: 'main',
            cloneUrl: 'https://github.com/onix-labs/studio.git',
            webUrl: 'https://github.com/onix-labs/studio',
            updatedAt: '2026-10-05T10:00:00Z',
            starred: false,
          },
        ],
      });
    });

    it('listRepositories_readsEveryPage_untilAShortOne', async () => {
      // #805: a browser, not a glance — a hundred was where the list used to stop.
      const page: (count: number, from: number) => unknown[] = (count: number, from: number) =>
        Array.from({ length: count }, (_value: unknown, index: number) => ({
          name: `repo-${from + index}`,
          owner: { login: 'matthew' },
          updated_at: '2026-10-05T10:00:00Z',
        }));
      const { github, http } = setup([
        {
          match: 'affiliation=owner,collaborator&sort=updated&per_page=100&page=1',
          status: 200,
          body: page(100, 0),
        },
        {
          match: 'affiliation=owner,collaborator&sort=updated&per_page=100&page=2',
          status: 200,
          body: page(30, 100),
        },
        { match: '/user/starred', status: 200, body: [] },
        { match: '/user', status: 200, body: { login: 'matthew' } },
      ]);

      const listed: Outcome<readonly HostedRepository[]> = await github.listRepositories(
        'github.com',
        'matthew',
      );

      expect(listed.ok && listed.result.length).toBe(130);
      expect(http.urls.filter((url) => url.includes('/user/repos')).length).toBe(2);
    });

    it('listRepositories_carriesTheDetails_andMarksWhatTheUserStarred', async () => {
      const raw: (name: string, extra: Record<string, unknown>) => unknown = (
        name: string,
        extra: Record<string, unknown>,
      ) => ({
        name,
        full_name: `Onix-Labs/${name}`,
        owner: { login: 'Onix-Labs' },
        updated_at: '2026-10-05T10:00:00Z',
        ...extra,
      });
      const { github } = setup([
        {
          match: '/orgs/onix-labs/repos',
          status: 200,
          body: [
            raw('studio', {
              language: 'TypeScript',
              stargazers_count: 12,
              fork: false,
              archived: false,
            }),
            raw('old-fork', { language: null, stargazers_count: 0, fork: true, archived: true }),
          ],
        },
        { match: '/user/starred', status: 200, body: [{ full_name: 'onix-labs/studio' }] },
        { match: '/user', status: 200, body: { login: 'matthew' } },
      ]);

      const listed: Outcome<readonly HostedRepository[]> = await github.listRepositories(
        'github.com',
        'onix-labs',
      );

      expect(
        listed.ok &&
          listed.result.map(({ ref, language, stars, fork, archived, starred }) => ({
            name: ref.name,
            language,
            stars,
            fork,
            archived,
            starred,
          })),
      ).toEqual([
        {
          name: 'studio',
          language: 'TypeScript',
          stars: 12,
          fork: false,
          archived: false,
          starred: true,
        },
        { name: 'old-fork', language: null, stars: 0, fork: true, archived: true, starred: false },
      ]);
    });

    it('listStarredRepositories_readsEveryStar_markedStarred', async () => {
      const { github } = setup([
        {
          match: '/user/starred',
          status: 200,
          body: [
            {
              name: 'angular',
              owner: { login: 'angular' },
              language: 'TypeScript',
              stargazers_count: 99000,
              updated_at: '2026-10-05T10:00:00Z',
            },
          ],
        },
      ]);

      const listed: Outcome<readonly HostedRepository[]> =
        await github.listStarredRepositories('github.com');

      expect(
        listed.ok && listed.result.map(({ ref, starred, stars }) => ({ ref, starred, stars })),
      ).toEqual([
        {
          ref: { host: 'github.com', owner: 'angular', name: 'angular' },
          starred: true,
          stars: 99000,
        },
      ]);
    });

    it('createRepository_postsUnderTheRightAccount', async () => {
      const { github, http } = setup([
        {
          match: '/orgs/onix-labs/repos',
          status: 201,
          body: { name: 'new', owner: { login: 'onix-labs' } },
        },
        { match: '/user', status: 200, body: { login: 'matthew' } },
      ]);

      const created: Outcome<HostedRepository> = await github.createRepository(
        'github.com',
        'onix-labs',
        'new',
        true,
        undefined,
      );

      const post: (typeof http.requests)[number] | undefined = http.requests.find(
        (request) => request.method === 'POST',
      );
      expect(post?.url).toBe('https://api.github.com/orgs/onix-labs/repos');
      expect(JSON.parse(post?.body ?? '{}')).toEqual({ name: 'new', private: true });
      expect(created.ok && created.result.ref.name).toBe('new');
    });
  });

  describe('describeRepository', () => {
    it('allowsIssuesOnlyWhenTurnedOn_andCiCommandsOnlyForAUserWhoCanPush', async () => {
      const read: (body: unknown) => Promise<readonly HostingCapability[]> = async (
        body: unknown,
      ): Promise<readonly HostingCapability[]> => {
        const { github } = setup([
          { match: '/repos/onix-labs/onixlabs-studio', status: 200, body },
        ]);
        const described: Outcome<{ readonly capabilities: readonly HostingCapability[] }> =
          await github.describeRepository(REPOSITORY);
        return described.ok ? described.result.capabilities : [];
      };

      expect(await read({ has_issues: true, permissions: { push: true } })).toEqual([
        'pullRequests',
        'createPullRequest',
        'ciRuns',
        'issues',
        'subIssues',
        'createIssue',
        'commentOnIssue',
        'setIssueState',
        'ciRerun',
        'ciCancel',
      ]);
      // #819's acceptance: Issues turned off on the repository.
      expect(await read({ has_issues: false, permissions: { push: false } })).toEqual([
        'pullRequests',
        'createPullRequest',
        'ciRuns',
      ]);
    });

    it('letsAnyoneOpenOrCommentOnIssues_butClosingThemTakesTriage', async () => {
      const read: (body: unknown) => Promise<readonly HostingCapability[]> = async (
        body: unknown,
      ): Promise<readonly HostingCapability[]> => {
        const { github } = setup([
          { match: '/repos/onix-labs/onixlabs-studio', status: 200, body },
        ]);
        const described: Outcome<{ readonly capabilities: readonly HostingCapability[] }> =
          await github.describeRepository(REPOSITORY);
        return described.ok ? described.result.capabilities : [];
      };

      const outsider: readonly HostingCapability[] = await read({ has_issues: true });
      const triager: readonly HostingCapability[] = await read({
        has_issues: true,
        permissions: { push: false, triage: true },
      });

      expect(outsider).toContain('createIssue');
      expect(outsider).toContain('commentOnIssue');
      expect(outsider).not.toContain('setIssueState');
      expect(triager).toContain('setIssueState');
      expect(triager).not.toContain('ciRerun');
    });
  });

  describe('pull requests', () => {
    it('mapsPullRequests_withTheRefToFetch_andRollsUpTheirChecks', async () => {
      const { github } = setup([
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
        { match: '/status', status: 200, body: { state: 'pending', statuses: [] } },
      ]);

      const listed: Outcome<readonly HostedPullRequest[]> =
        await github.listPullRequests(REPOSITORY);

      expect(listed).toEqual({
        ok: true,
        result: [
          {
            number: 7,
            title: 'Add the thing',
            author: 'matthew',
            url: 'https://github.com/onix-labs/onixlabs-studio/pull/7',
            draft: false,
            headRef: 'feature/thing',
            fetchRef: 'refs/pull/7/head',
            checks: 'succeeded',
          },
        ],
      });
    });

    it('marksAPullRequestFailed_whenOnlyItsCommitStatusFailed', async () => {
      const { github } = setup([
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

      const listed: Outcome<readonly HostedPullRequest[]> =
        await github.listPullRequests(REPOSITORY);

      expect(listed.ok && listed.result[0].checks).toBe('failed');
    });

    it('degradesTheBadgeRatherThanTheListing_whenChecksCannotBeRead', async () => {
      const { github } = setup([
        {
          match: '/pulls',
          status: 200,
          body: [{ number: 7, title: 'X', head: { ref: 'f', sha: 'abc' }, user: { login: 'm' } }],
        },
        { match: '/check-runs', status: 500, body: {} },
        { match: '/status', status: 500, body: {} },
      ]);

      const listed: Outcome<readonly HostedPullRequest[]> =
        await github.listPullRequests(REPOSITORY);

      expect(listed.ok && listed.result[0].checks).toBe('none');
    });

    it('survivesFieldsTheApiOmits_andEscapesTheRepositoryIntoThePath', async () => {
      const { github, http } = setup([{ match: '/pulls', status: 200, body: [{}] }]);

      const listed: Outcome<readonly HostedPullRequest[]> = await github.listPullRequests({
        ...REPOSITORY,
        owner: 'a b',
        name: 'c d',
      });

      expect(listed.ok && listed.result[0]).toEqual({
        number: 0,
        title: '(untitled)',
        author: 'unknown',
        url: '',
        draft: false,
        headRef: '',
        fetchRef: 'refs/pull/0/head',
        checks: 'none',
      });
      expect(http.urls[0]).toContain('/repos/a%20b/c%20d/pulls');
    });
  });

  describe('issues', () => {
    it('mapsIssues_andLeavesOutThePullRequestsTheEndpointAlsoReturns', async () => {
      const { github } = setup([
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
            { number: 13, title: 'A pull request', user: { login: 'm' }, pull_request: {} },
          ],
        },
      ]);

      const listed: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);

      expect(listed).toEqual({
        ok: true,
        result: [
          {
            number: 12,
            title: 'Something is broken',
            author: 'matthew',
            url: 'https://github.com/onix-labs/onixlabs-studio/issues/12',
            labels: ['bug', 'area:git'],
            assignees: ['matthew'],
            state: 'open',
            body: 'Steps to reproduce are in the log.',
            createdAt: '2026-08-01T10:00:00Z',
            updatedAt: '2026-08-02T11:30:00Z',
            commentCount: 3,
            milestone: 'v0.13',
          },
        ],
      });
    });

    it('mapsAClosedIssue_withNoMilestoneAsAbsent', async () => {
      const { github } = setup([
        {
          match: '/issues',
          status: 200,
          body: [
            {
              number: 9,
              title: 'Done',
              user: { login: 'm' },
              state: 'closed',
              closed_at: '2026-08-03T09:00:00Z',
              milestone: null,
            },
          ],
        },
      ]);

      const listed: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);
      const issue: HostedIssue | undefined = listed.ok ? listed.result[0] : undefined;

      expect(issue?.state).toBe('closed');
      expect(issue?.closedAt).toBe('2026-08-03T09:00:00Z');
      expect(issue?.milestone).toBeUndefined();
      expect(issue?.commentCount).toBe(0);
    });

    it('listIssueComments_readsTheConversation_withStringIds', async () => {
      const { github } = setup([
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

      const listed: Outcome<readonly HostedIssueComment[]> = await github.listIssueComments(
        REPOSITORY,
        12,
      );

      expect(listed.ok && listed.result[0]).toEqual({
        id: '5001',
        author: 'matthew',
        body: 'Reproduced on main.',
        createdAt: '2026-08-02T09:00:00Z',
        url: 'https://example.com/9#issuecomment-5001',
      });
    });

    it('listSubIssues_readsTheParentsSubIssues', async () => {
      const { github, http } = setup([
        {
          match: '/issues/12/sub_issues',
          status: 200,
          body: [{ number: 14, title: 'Part one', user: { login: 'm' } }],
        },
      ]);

      const listed: Outcome<readonly HostedIssue[]> = await github.listSubIssues(REPOSITORY, 12);

      expect(http.urls[0]).toContain('/repos/onix-labs/onixlabs-studio/issues/12/sub_issues');
      expect(listed.ok && listed.result.map((issue) => issue.number)).toEqual([14]);
    });

    it('turnsAnIssueNumberThatIsNotOneIntoZero_ratherThanAPathSegment', async () => {
      const { github, http } = setup([{ match: '/comments', status: 200, body: [] }]);

      await github.listIssueComments(REPOSITORY, Number.NaN);

      expect(http.urls[0]).toContain('/issues/0/comments');
    });
  });

  describe('CI runs', () => {
    it('mapsRuns_withStringIds_andABranchlessRunAsNull', async () => {
      const { github } = setup([
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
              { id: 1, status: 'queued', created_at: '2026-08-24T09:00:00Z' },
            ],
          },
        },
      ]);

      const listed: Outcome<readonly HostedCiRun[]> = await github.listCiRuns(REPOSITORY);

      expect(listed.ok && listed.result).toEqual([
        {
          id: '99',
          name: 'CI',
          status: 'failed',
          url: 'https://github.com/onix-labs/onixlabs-studio/actions/runs/99',
          branch: 'main',
          event: 'push',
          startedAt: '2026-08-24T10:00:00Z',
        },
        {
          id: '1',
          name: 'Workflow',
          status: 'queued',
          url: '',
          branch: null,
          event: '',
          // A queued run has not started; its creation time is the closest honest answer.
          startedAt: '2026-08-24T09:00:00Z',
        },
      ]);
    });

    it('runCommand_postsTheCommand_andRefusesARunIdThatIsNotDigits', async () => {
      const { github, http } = setup([
        { match: '/actions/runs/99/cancel', status: 202, body: undefined },
      ]);

      const cancelled: Outcome<Readonly<Record<string, never>>> = await github.runCommand(
        REPOSITORY,
        '99',
        'cancel',
      );
      const smuggled: Outcome<Readonly<Record<string, never>>> = await github.runCommand(
        REPOSITORY,
        '99/../../x',
        'rerun',
      );

      expect(cancelled).toEqual({ ok: true, result: {} });
      expect(http.requests[0].method).toBe('POST');
      expect(smuggled).toMatchObject({ ok: false, code: 'refused' });
      expect(http.requests.length).toBe(1);
    });
  });
});

describe('writing', () => {
  const ISSUE_BODY: unknown = {
    number: 12,
    title: 'Fix login',
    html_url: 'https://github.com/onix-labs/onixlabs-studio/issues/12',
    user: { login: 'matthew' },
    labels: [],
    assignees: [],
    state: 'open',
    body: 'It breaks.',
    created_at: '2026-10-06T09:00:00Z',
    updated_at: '2026-10-06T09:00:00Z',
    comments: 0,
  };

  it('createIssue_postsTheTitleAndBody_andAnswersWithTheIssue', async () => {
    const { github, http } = setup([{ match: '/issues', status: 201, body: ISSUE_BODY }]);

    const created: Outcome<HostedIssue> = await github.createIssue(
      REPOSITORY,
      'Fix login',
      'It breaks.',
    );

    expect(http.requests[0].method).toBe('POST');
    expect(http.urls[0]).toBe('https://api.github.com/repos/onix-labs/onixlabs-studio/issues');
    expect(JSON.parse(http.requests[0].body ?? '{}')).toEqual({
      title: 'Fix login',
      body: 'It breaks.',
    });
    expect(created).toMatchObject({ ok: true, result: { number: 12, title: 'Fix login' } });
  });

  it('createIssue_refusesAnEmptyTitle_withoutARequest', async () => {
    const { github, http } = setup([]);

    expect(await github.createIssue(REPOSITORY, '   ', undefined)).toMatchObject({
      ok: false,
      code: 'refused',
    });
    expect(http.requests).toEqual([]);
  });

  it('commentOnIssue_postsToTheIssuesConversation_whichAPullRequestSharesToo', async () => {
    const { github, http } = setup([
      {
        match: '/issues/7/comments',
        status: 201,
        body: { id: 5, user: { login: 'matthew' }, body: 'Done.', created_at: 'x', html_url: 'u' },
      },
    ]);

    const comment: Outcome<HostedIssueComment> = await github.commentOnIssue(
      REPOSITORY,
      7,
      'Done.',
    );

    expect(http.requests[0].method).toBe('POST');
    expect(JSON.parse(http.requests[0].body ?? '{}')).toEqual({ body: 'Done.' });
    expect(comment).toEqual({
      ok: true,
      result: { id: '5', author: 'matthew', body: 'Done.', createdAt: 'x', url: 'u' },
    });
  });

  it('setIssueState_patchesTheState_withGitHubsWordForTheReason', async () => {
    const { github, http } = setup([
      { match: '/issues/12', status: 200, body: { ...(ISSUE_BODY as object), state: 'closed' } },
    ]);

    const closed: Outcome<HostedIssue> = await github.setIssueState(
      REPOSITORY,
      12,
      'closed',
      'notPlanned',
    );
    await github.setIssueState(REPOSITORY, 12, 'open', undefined);

    expect(http.requests[0].method).toBe('PATCH');
    expect(JSON.parse(http.requests[0].body ?? '{}')).toEqual({
      state: 'closed',
      state_reason: 'not_planned',
    });
    expect(JSON.parse(http.requests[1].body ?? '{}')).toEqual({
      state: 'open',
      state_reason: 'reopened',
    });
    expect(closed).toMatchObject({ ok: true, result: { state: 'closed' } });
  });

  it('createPullRequest_postsTheBranches_andAnswersWithThePullRequest', async () => {
    const { github, http } = setup([
      {
        match: '/pulls',
        status: 201,
        body: {
          number: 851,
          title: 'Add writes',
          html_url: 'https://github.com/onix-labs/onixlabs-studio/pull/851',
          draft: true,
          user: { login: 'matthew' },
          head: { ref: 'feat/851', sha: 'abc' },
        },
      },
    ]);

    const opened: Outcome<HostedPullRequest> = await github.createPullRequest(REPOSITORY, {
      title: 'Add writes',
      head: 'feat/851',
      base: 'main',
      draft: true,
    });

    expect(JSON.parse(http.requests[0].body ?? '{}')).toEqual({
      title: 'Add writes',
      head: 'feat/851',
      base: 'main',
      draft: true,
    });
    expect(opened).toEqual({
      ok: true,
      result: {
        number: 851,
        title: 'Add writes',
        author: 'matthew',
        url: 'https://github.com/onix-labs/onixlabs-studio/pull/851',
        draft: true,
        headRef: 'feat/851',
        fetchRef: 'refs/pull/851/head',
        checks: 'none',
      },
    });
  });

  it('aWriteGitHubRefuses_saysWhy', async () => {
    const { github } = setup([{ match: '/issues', status: 403, body: {} }]);

    expect(await github.createIssue(REPOSITORY, 'Fix login', undefined)).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
  });
});

describe('conditional requests and the rate limit', () => {
  /**
   * The issues route, which every test here reads through.
   * @param overrides The route fields to vary.
   * @returns Returns the route.
   */
  function issuesRoute(overrides: Partial<Route> = {}): Route {
    return { match: '/issues', status: 200, body: [], ...overrides };
  }

  it('revalidatesWithTheEntityTagItWasGiven_andServesTheCachedBodyOnNotModified', async () => {
    const body: unknown = [{ number: 1, title: 'Cached', user: { login: 'm' } }];
    const { github, http } = setup([issuesRoute({ body, headers: { etag: 'W/"abc"' } })]);
    await github.listIssues(REPOSITORY);

    http.setRoute({ match: '/issues', status: 304, body: undefined });
    const second: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);

    expect(http.requests[0].headers['if-none-match']).toBeUndefined();
    expect(http.requests[1].headers['if-none-match']).toBe('W/"abc"');
    // A 304 carries no body; reading one would look like an emptied section.
    expect(second.ok && second.result.map((issue) => issue.title)).toEqual(['Cached']);
  });

  it('dropsTheCacheWhenTheCredentialChanges', async () => {
    // Two accounts do not see the same things at the same URL.
    const http: FakeHttp = new FakeHttp([issuesRoute({ headers: { etag: 'W/"abc"' } })]);
    let token: string = 'ghp_one';
    const github: GitHubHosting = new GitHubHosting(
      http.fetch,
      studioOnly(() => token),
    );
    await github.listIssues(REPOSITORY);

    token = 'ghp_two';
    await github.listIssues(REPOSITORY);

    expect(http.requests[1].headers['if-none-match']).toBeUndefined();
  });

  it('stopsAskingOnceTheBudgetIsNearlySpent_andSaysWhenItResumes', async () => {
    const { github, http } = setup(
      [issuesRoute({ headers: { 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': '4000' } })],
      'ghp_test',
      () => 1_000_000,
    );

    await github.listIssues(REPOSITORY);
    const refused: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);

    // Refused here, not sent; and a reserve is held back for whatever the user does next.
    expect(http.urls.length).toBe(1);
    expect(refused).toMatchObject({
      ok: false,
      code: 'rate-limited',
      retryAt: new Date(4_000_000).toISOString(),
    });
  });

  it('recoversOnItsOwn_onceTheWindowHasRolledOver', async () => {
    let now: number = 1_000_000;
    const { github } = setup(
      [issuesRoute({ headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4000' } })],
      'ghp_test',
      () => now,
    );
    await github.listIssues(REPOSITORY);
    expect((await github.listIssues(REPOSITORY)).ok).toBe(false);

    now = 4_000_001;

    expect((await github.listIssues(REPOSITORY)).ok).toBe(true);
  });

  it('tellsAnExhaustedBudgetApartFromAMissingPermission_bothOfWhichAre403', async () => {
    const limited: { github: GitHubHosting; http: FakeHttp } = setup(
      [
        issuesRoute({
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4000' },
        }),
      ],
      'ghp_test',
      () => 1_000_000,
    );
    const scoped: { github: GitHubHosting; http: FakeHttp } = setup([issuesRoute({ status: 403 })]);

    expect(await limited.github.listIssues(REPOSITORY)).toMatchObject({ code: 'rate-limited' });
    expect(await scoped.github.listIssues(REPOSITORY)).toMatchObject({ code: 'forbidden' });
  });

  it('honoursRetryAfter_theSecondaryLimitsOwnMechanism', async () => {
    const { github } = setup(
      [issuesRoute({ status: 403, headers: { 'retry-after': '60' } })],
      'ghp_test',
      () => 1_000_000,
    );

    const outcome: Outcome<readonly HostedIssue[]> = await github.listIssues(REPOSITORY);

    expect(outcome).toMatchObject({ retryAt: new Date(1_060_000).toISOString() });
  });

  it('keepsEachHostsBudgetApart', async () => {
    const { github, http } = setup(
      [
        {
          match: 'api.github.com',
          status: 200,
          body: [],
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4000' },
        },
        { match: 'ghe.example.com', status: 200, body: [] },
      ],
      'ghp_test',
      () => 1_000_000,
    );
    await github.listIssues(REPOSITORY);

    const enterprise: Outcome<readonly HostedIssue[]> = await github.listIssues({
      ...REPOSITORY,
      host: 'ghe.example.com',
    });

    expect(enterprise.ok).toBe(true);
    expect(http.urls.length).toBe(2);
  });
});
