import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Forge } from '@shared/angular/services/forge/forge';
import { Repository } from '@shared/angular/services/repository/repository';
import { GitRemote } from '@shared/angular/services/repository/repository-data';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
import { ForgePullRequest, ForgeRepositoryRef, ForgeResult } from '@shared/api/forge-types';
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

  public pullRequests(): Promise<ForgeResult<readonly ForgePullRequest[]>> {
    return Promise.resolve(this.pullRequestResult);
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
        { name: 'gone', url: '', branches: ['gone/old'] },
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
});
