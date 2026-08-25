import { vi } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Forge } from '@shared/angular/services/forge/forge';
import { Repository } from '@shared/angular/services/repository/repository';
import { GitRemote } from '@shared/angular/services/repository/repository-data';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
import {
  ForgeIssue,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';
import { ForgeRepository, ForgeSection } from './forge-repository';

/**
 * The repository the fake forge detects.
 */
const REFERENCE: ForgeRepositoryRef = {
  kind: 'github',
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * Builds a pull request.
 * @param overrides The fields to vary.
 * @returns Returns the pull request.
 */
function pullRequest(overrides: Partial<ForgePullRequest> = {}): ForgePullRequest {
  return {
    number: 7,
    title: 'Add the thing',
    author: 'matthew',
    url: 'https://github.com/onix-labs/onixlabs-studio/pull/7',
    draft: false,
    headRef: 'feature/thing',
    headRefspec: 'refs/pull/7/head',
    checks: 'succeeded',
    ...overrides,
  };
}

/**
 * Builds a workflow run.
 * @param overrides The fields to vary.
 * @returns Returns the run.
 */
function run(overrides: Partial<ForgeWorkflowRun> = {}): ForgeWorkflowRun {
  return {
    id: 99,
    name: 'CI',
    status: 'succeeded',
    url: 'https://github.com/onix-labs/onixlabs-studio/actions/runs/99',
    branch: 'main',
    event: 'push',
    startedAt: '2026-08-24T10:00:00Z',
    ...overrides,
  };
}

/**
 * A recording stand-in for the forge client.
 */
class FakeForge {
  public readonly isAvailable: boolean = true;

  /**
   * Holds the remote URLs {@link detect} was asked about, in order.
   */
  public readonly detected: string[] = [];

  /**
   * Holds the URLs that resolve to a forge repository; anything else resolves to null.
   */
  public forgeUrls: readonly string[] = ['https://github.com/onix-labs/onixlabs-studio.git'];

  /**
   * Holds what {@link pullRequests} resolves to.
   */
  public pullRequestResult: ForgeResult<readonly ForgePullRequest[]> = {
    ok: true,
    value: [pullRequest()],
  };

  public detect(remoteUrl: string): Promise<ForgeRepositoryRef | null> {
    this.detected.push(remoteUrl);
    return Promise.resolve(this.forgeUrls.includes(remoteUrl) ? REFERENCE : null);
  }

  /**
   * Counts the reads of each section, so the poll can be observed.
   */
  public readonly readCounts: { pullRequests: number } = { pullRequests: 0 };

  public pullRequests(): Promise<ForgeResult<readonly ForgePullRequest[]>> {
    this.readCounts.pullRequests += 1;
    return Promise.resolve(this.pullRequestResult);
  }

  /**
   * Holds what {@link issues} resolves to.
   */
  public issueResult: ForgeResult<readonly ForgeIssue[]> = {
    ok: true,
    value: [
      {
        number: 12,
        title: 'Something is broken',
        author: 'matthew',
        url: 'https://github.com/onix-labs/onixlabs-studio/issues/12',
        labels: ['bug'],
        assignees: [],
      },
    ],
  };

  /**
   * Holds what {@link workflowRuns} resolves to.
   */
  public runResult: ForgeResult<readonly ForgeWorkflowRun[]> = { ok: true, value: [run()] };

  /**
   * Holds the run commands issued, in order.
   */
  public readonly commands: string[] = [];

  public issues(): Promise<ForgeResult<readonly ForgeIssue[]>> {
    return Promise.resolve(this.issueResult);
  }

  public workflowRuns(): Promise<ForgeResult<readonly ForgeWorkflowRun[]>> {
    return Promise.resolve(this.runResult);
  }

  public rerunWorkflowRun(_: ForgeRepositoryRef, runId: number): Promise<ForgeResult<void>> {
    this.commands.push(`rerun:${runId}`);
    return Promise.resolve({ ok: true, value: undefined });
  }

  public cancelWorkflowRun(_: ForgeRepositoryRef, runId: number): Promise<ForgeResult<void>> {
    this.commands.push(`cancel:${runId}`);
    return Promise.resolve({ ok: true, value: undefined });
  }
}

/**
 * A stand-in for this view's repository.
 */
class FakeRepository {
  public readonly remotes: WritableSignal<readonly GitRemote[]> = signal<readonly GitRemote[]>([]);
  public readonly bound: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Holds the arguments of each {@link checkoutRef} call.
   */
  public readonly checkouts: { remote: string; sourceRef: string; local: string }[] = [];

  public isBound(): boolean {
    return this.bound();
  }

  public checkoutRef(remote: string, sourceRef: string, local: string): Promise<MutationResult> {
    this.checkouts.push({ remote, sourceRef, local });
    return Promise.resolve({ success: true });
  }
}

describe('ForgeRepository', () => {
  let forge: FakeForge;
  let repository: FakeRepository;
  let service: ForgeRepository;

  beforeEach(() => {
    forge = new FakeForge();
    repository = new FakeRepository();
    TestBed.configureTestingModule({
      providers: [
        ForgeRepository,
        { provide: Forge, useValue: forge },
        { provide: Repository, useValue: repository },
      ],
    });
    service = TestBed.inject(ForgeRepository);
  });

  describe('detect', () => {
    it('resolvesTheRepositoryFromARemote', async () => {
      repository.remotes.set([
        { name: 'origin', url: 'https://github.com/onix-labs/onixlabs-studio.git', branches: [] },
      ]);

      await expect(service.detect()).resolves.toEqual(REFERENCE);
      expect(service.repositoryRef()).toEqual(REFERENCE);
      expect(service.hasForge()).toBe(true);
    });

    it('prefersOrigin_whenSeveralRemotesResolve', async () => {
      // A fork has both; the pull requests a contributor cares about are on the one they push to.
      forge.forgeUrls = ['https://github.com/a/b.git', 'https://github.com/c/d.git'];
      repository.remotes.set([
        { name: 'upstream', url: 'https://github.com/c/d.git', branches: [] },
        { name: 'origin', url: 'https://github.com/a/b.git', branches: [] },
      ]);

      await service.detect();

      expect(forge.detected[0]).toBe('https://github.com/a/b.git');
    });

    it('skipsARemoteWithNoUrl', async () => {
      // A stale refs/remotes entry for a removed remote carries no URL.
      repository.remotes.set([
        { name: 'gone', url: '', branches: [{ name: 'gone/old', commit: 'c1' }] },
        { name: 'origin', url: 'https://github.com/onix-labs/onixlabs-studio.git', branches: [] },
      ]);

      await service.detect();

      expect(forge.detected).toEqual(['https://github.com/onix-labs/onixlabs-studio.git']);
    });

    it('resolvesNull_whenNoRemoteIsOnASupportedForge', async () => {
      repository.remotes.set([
        { name: 'origin', url: 'https://git.example.com/a/b.git', branches: [] },
      ]);

      await expect(service.detect()).resolves.toBeNull();
      expect(service.hasForge()).toBe(false);
    });

    it('resolvesNull_forARepositoryWithNoRemotes', async () => {
      await expect(service.detect()).resolves.toBeNull();
    });
  });

  describe('loadPullRequests', () => {
    beforeEach(() => {
      repository.remotes.set([
        { name: 'origin', url: 'https://github.com/onix-labs/onixlabs-studio.git', branches: [] },
      ]);
    });

    it('readsThePullRequests', async () => {
      await service.loadPullRequests();

      const section: ForgeSection<ForgePullRequest> = service.pullRequests();
      expect(section.state).toBe('ready');
      expect(section.items.map((pull: ForgePullRequest): number => pull.number)).toEqual([7]);
      expect(section.message).toBeNull();
    });

    it('reportsNoForge_whenTheRemoteIsNotOnOne', async () => {
      forge.forgeUrls = [];

      await service.loadPullRequests();

      expect(service.pullRequests().state).toBe('no-forge');
      expect(service.pullRequests().message).toContain('supported forge');
    });

    it('reportsNoRepository_whenNothingIsOpen', async () => {
      repository.bound.set(false);

      await service.loadPullRequests();

      expect(service.pullRequests().state).toBe('no-repository');
    });

    it('keepsUnauthorizedDistinctFromAnyOtherFailure', async () => {
      // The two are answered differently: one by signing in, the other by trying again.
      forge.pullRequestResult = { ok: false, error: 'Rejected', unauthorized: true };
      await service.loadPullRequests();
      expect(service.pullRequests().state).toBe('unauthorized');

      forge.pullRequestResult = { ok: false, error: 'Offline', unauthorized: false };
      await service.loadPullRequests();
      expect(service.pullRequests().state).toBe('error');
      expect(service.pullRequests().message).toBe('Offline');
    });

    it('reportsReadyWithNoItems_whenThereAreNoOpenPullRequests', async () => {
      // "The forge says there are none" is a different thing from "the read failed", and only the
      // result type can tell them apart — an empty list cannot.
      forge.pullRequestResult = { ok: true, value: [] };

      await service.loadPullRequests();

      expect(service.pullRequests().state).toBe('ready');
      expect(service.pullRequests().items).toEqual([]);
    });

    it('detectsOnce_thenReusesTheReference', async () => {
      await service.loadPullRequests();
      await service.loadPullRequests();

      expect(forge.detected.length).toBe(1);
    });
  });

  describe('checkout', () => {
    beforeEach(async () => {
      repository.remotes.set([
        { name: 'origin', url: 'https://github.com/onix-labs/onixlabs-studio.git', branches: [] },
      ]);
      await service.detect();
    });

    it('fetchesTheForgesHeadRef_ratherThanCheckingOutABranchName', async () => {
      // A pull request from a fork has its branch in the contributor's repository, not this one; the
      // head ref is the only thing reachable from here.
      await service.checkout(pullRequest());

      expect(repository.checkouts).toEqual([
        { remote: 'origin', sourceRef: 'refs/pull/7/head', local: 'feature/thing' },
      ]);
    });

    it('namesTheLocalBranchAfterTheNumber_whenTheForgeGaveNoHeadRef', async () => {
      await service.checkout(pullRequest({ number: 9, headRef: '' }));

      expect(repository.checkouts[0].local).toBe('pr-9');
    });

    it('failsWithoutTouchingGit_whenNoForgeWasDetected', async () => {
      service.reset();

      const result: MutationResult = await service.checkout(pullRequest());

      expect(result.success).toBe(false);
      expect(repository.checkouts).toEqual([]);
    });
  });

  it('reset_clearsEverythingRead', async () => {
    repository.remotes.set([
      { name: 'origin', url: 'https://github.com/onix-labs/onixlabs-studio.git', branches: [] },
    ]);
    await service.loadPullRequests();
    expect(service.pullRequests().state).toBe('ready');

    service.reset();

    expect(service.repositoryRef()).toBeNull();
    expect(service.hasForge()).toBe(false);
    expect(service.pullRequests().state).toBe('no-repository');
  });

  describe('issues and workflow runs', () => {
    beforeEach(() => {
      repository.remotes.set([
        { name: 'origin', url: 'https://github.com/onix-labs/onixlabs-studio.git', branches: [] },
      ]);
    });

    it('readsTheIssues', async () => {
      await service.loadIssues();

      expect(service.issues().state).toBe('ready');
      expect(service.issues().items.map((issue: ForgeIssue): number => issue.number)).toEqual([12]);
    });

    it('readsTheWorkflowRuns', async () => {
      await service.loadWorkflowRuns();

      expect(service.workflowRuns().state).toBe('ready');
      expect(
        service.workflowRuns().items.map((entry: ForgeWorkflowRun): number => entry.id),
      ).toEqual([99]);
    });

    it('everySectionReportsTheSameUnhappyState', async () => {
      // A section that said "no forge" differently from its neighbours would be a puzzle rather than
      // a panel, which is why all three share one loader.
      forge.forgeUrls = [];

      await Promise.all([
        service.loadPullRequests(),
        service.loadIssues(),
        service.loadWorkflowRuns(),
      ]);

      expect(service.pullRequests().state).toBe('no-forge');
      expect(service.issues().state).toBe('no-forge');
      expect(service.workflowRuns().state).toBe('no-forge');
    });

    it('rerun_issuesTheCommandAndReReadsTheRuns', async () => {
      await service.loadWorkflowRuns();
      forge.runResult = { ok: true, value: [run({ id: 100, status: 'queued' })] };

      await service.rerun(run());

      expect(forge.commands).toEqual(['rerun:99']);
      // The forge starts a NEW run, so the list is what shows the result.
      expect(
        service.workflowRuns().items.map((entry: ForgeWorkflowRun): number => entry.id),
      ).toEqual([100]);
    });

    it('cancel_issuesTheCommand', async () => {
      await service.loadWorkflowRuns();

      await service.cancel(run({ id: 42 }));

      expect(forge.commands).toEqual(['cancel:42']);
    });

    it('runCommands_failWithoutTouchingTheForge_whenNoRepositoryWasDetected', async () => {
      const result: ForgeResult<void> = await service.rerun(run());

      expect(result.ok).toBe(false);
      expect(forge.commands).toEqual([]);
    });
  });

  describe('staleness, the rate limit, and polling', () => {
    beforeEach(() => {
      repository.remotes.set([
        { name: 'origin', url: 'https://github.com/onix-labs/onixlabs-studio.git', branches: [] },
      ]);
    });

    it('keepsTheLastGoodDataWhenAReadFails_ratherThanBlanking', async () => {
      // Pull requests read a minute ago are still the best answer available; losing them because the
      // network blinked tells the user less than leaving them up does.
      await service.loadPullRequests();
      expect(service.pullRequests().items.length).toBe(1);

      forge.pullRequestResult = { ok: false, error: 'Offline', unauthorized: false };
      await service.loadPullRequests();

      expect(service.pullRequests().state).toBe('error');
      expect(service.pullRequests().items.length).toBe(1);
      expect(service.pullRequests().stale).toBe(true);
    });

    it('clearsOnAnAuthenticationFailure_becauseTheCredentialCanNoLongerSeeIt', async () => {
      await service.loadPullRequests();

      forge.pullRequestResult = { ok: false, error: 'Rejected', unauthorized: true };
      await service.loadPullRequests();

      expect(service.pullRequests().items).toEqual([]);
      expect(service.pullRequests().stale).toBe(false);
    });

    it('reportsRateLimited_distinctlyFromAnyOtherFailure_andSaysHowLong', async () => {
      await service.loadPullRequests();
      forge.pullRequestResult = {
        ok: false,
        error: 'Rate limit exhausted.',
        unauthorized: false,
        retryAt: Date.now() + 12 * 60_000,
      };

      await service.loadPullRequests();

      expect(service.pullRequests().state).toBe('rate-limited');
      expect(service.pullRequests().message).toContain('12 minutes');
      // Still showing what it had, since none of it stopped being true.
      expect(service.pullRequests().items.length).toBe(1);
    });

    it('doesNotBlankWhileLoading', async () => {
      // A poll that emptied the section for the length of a request would make an idle panel flicker.
      await service.loadPullRequests();
      forge.pullRequestResult = { ok: true, value: [pullRequest()] };

      const pending: Promise<void> = service.loadPullRequests();
      // Read mid-flight: the section is loading, and still holding what it had.
      const duringLoad: number = service.pullRequests().items.length;
      await pending;

      expect(duringLoad).toBe(1);
    });

    it('pollsNothingUntilASectionIsWatched', async () => {
      vi.useFakeTimers();
      try {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(forge.readCounts.pullRequests).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('pollsAWatchedSection_andStopsWhenItIsUnwatched', async () => {
      vi.useFakeTimers();
      try {
        service.watch('pullRequests');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(forge.readCounts.pullRequests).toBe(1);

        service.unwatch('pullRequests');
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(forge.readCounts.pullRequests).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stopsPollingWhileTheViewIsNotTheOneInFront', async () => {
      // Every view stays mounted while hidden, so a live panel says nothing about anyone looking.
      vi.useFakeTimers();
      try {
        service.watch('pullRequests');
        service.setActive(false);
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(forge.readCounts.pullRequests).toBe(0);

        service.setActive(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(forge.readCounts.pullRequests).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('dispose_stopsThePoll', async () => {
      vi.useFakeTimers();
      try {
        service.watch('pullRequests');
        service.dispose();
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        expect(forge.readCounts.pullRequests).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('watch_ignoresASectionThatIsNotForgeBacked', async () => {
      vi.useFakeTimers();
      try {
        service.watch('tags');
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        expect(forge.readCounts.pullRequests).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
