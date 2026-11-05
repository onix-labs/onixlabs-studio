import { TestBed } from '@angular/core/testing';
import {
  WorkspaceKind,
  WorktreeAddOptions,
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeDescriptor,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { WorktreeClient } from '@shared/api/worktree-channels';
import { Worktrees } from '@shared/angular/services/worktree/worktrees';
import { WorktreeSession } from './worktree-session';

/**
 * A checkout the container holds.
 */
function checkout(id: string, branch: string | null = id, alias?: string): WorktreeCheckoutInfo {
  return {
    id,
    path: `/container/${id}`,
    exists: true,
    branch,
    ...(alias === undefined ? {} : { alias }),
  };
}

/**
 * A checkout's status.
 */
function status(id: string, branch: string | null): WorktreeCheckoutStatus {
  return { id, branch, changes: 0, ahead: 0, behind: 0, branches: [] };
}

/**
 * A container of the given checkouts.
 */
function descriptor(...checkouts: readonly WorktreeCheckoutInfo[]): WorktreeDescriptor {
  return { root: '/container', origin: null, checkouts };
}

/**
 * A fake of the worktree IPC client: programmable replies, and a record of the mutations.
 */
class FakeClient implements WorktreeClient {
  public description: WorktreeDescriptor | null = descriptor(checkout('a'), checkout('b'));
  public statuses: readonly WorktreeCheckoutStatus[] | null = [];
  public branchNames: readonly string[] | null = ['main', 'origin/dev'];
  public outcome: WorktreeOutcome<null> = { ok: true, value: null };
  public added: WorktreeOutcome<WorktreeCheckoutInfo> = { ok: true, value: checkout('c') };
  public pending: Promise<unknown> | undefined = undefined;
  public describes: number = 0;
  public statusReads: number = 0;
  public readonly calls: string[] = [];

  public resolve(): Promise<WorkspaceKind | null> {
    return Promise.resolve(null);
  }

  public describe(): Promise<WorktreeDescriptor | null> {
    this.describes += 1;
    return Promise.resolve(this.description);
  }

  public promote(): Promise<WorktreeOutcome<WorktreeDescriptor>> {
    return Promise.resolve({ ok: false, error: 'unused' });
  }

  public async addCheckout(
    root: string,
    options: WorktreeAddOptions,
  ): Promise<WorktreeOutcome<WorktreeCheckoutInfo>> {
    this.calls.push(`add:${root}:${options.branch ?? ''}`);
    await this.pending;
    return this.added;
  }

  public async removeCheckout(root: string, id: string): Promise<WorktreeOutcome<null>> {
    this.calls.push(`remove:${root}:${id}`);
    await this.pending;
    return this.outcome;
  }

  public renameCheckout(root: string, id: string, alias: string): Promise<WorktreeOutcome<null>> {
    this.calls.push(`rename:${id}:${alias}`);
    return Promise.resolve(this.outcome);
  }

  public openCheckout(): Promise<WorktreeOutcome<string>> {
    return Promise.resolve({ ok: false, error: 'unused' });
  }

  public status(): Promise<readonly WorktreeCheckoutStatus[] | null> {
    this.statusReads += 1;
    return Promise.resolve(this.statuses);
  }

  public branches(): Promise<readonly string[] | null> {
    return Promise.resolve(this.branchNames);
  }

  public deleteBranch(
    root: string,
    id: string,
    name: string,
    force: boolean,
  ): Promise<WorktreeOutcome<null>> {
    this.calls.push(`deleteBranch:${id}:${name}:${force}`);
    return Promise.resolve(this.outcome);
  }

  public createBranch(
    root: string,
    id: string,
    name: string,
    checkedOut: boolean,
  ): Promise<WorktreeOutcome<null>> {
    this.calls.push(`createBranch:${id}:${name}:${checkedOut}`);
    return Promise.resolve(this.outcome);
  }
}

describe('WorktreeSession', () => {
  let client: FakeClient;
  let session: WorktreeSession;

  /**
   * Lets the status read an initialisation starts land.
   */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  beforeEach((): void => {
    client = new FakeClient();
    TestBed.configureTestingModule({
      providers: [WorktreeSession, { provide: Worktrees, useValue: { client } }],
    });
    session = TestBed.inject(WorktreeSession);
  });

  describe('an ordinary tab', () => {
    it('isContainer_beforeInitialize_isFalse', () => {
      expect(session.isContainer()).toBe(false);
      expect(session.activeLabel()).toBeNull();
    });

    it.each([
      ['add', (): Promise<WorktreeOutcome<unknown>> => session.add({})],
      ['rename', (): Promise<WorktreeOutcome<unknown>> => session.rename('a', 'x')],
      [
        'createBranch',
        (): Promise<WorktreeOutcome<unknown>> => session.createBranch('a', 'x', true),
      ],
      [
        'deleteBranch',
        (): Promise<WorktreeOutcome<unknown>> => session.deleteBranch('a', 'x', true),
      ],
      ['remove', (): Promise<WorktreeOutcome<unknown>> => session.remove('a')],
    ])('%s_notAContainer_isRefusedWithoutTouchingTheDisk', async (_name, act) => {
      const outcome: WorktreeOutcome<unknown> = await act();

      expect(outcome).toEqual({ ok: false, error: 'The tab is not a worktree container.' });
      expect(client.calls).toEqual([]);
    });

    it('reads_notAContainer_doNothing', async () => {
      await session.refresh();
      await session.refreshStatus();

      expect(await session.loadBranches()).toEqual([]);
      expect(client.describes).toBe(0);
      expect(client.statusReads).toBe(0);
    });
  });

  describe('outside Electron', () => {
    beforeEach((): void => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [WorktreeSession, { provide: Worktrees, useValue: { client: undefined } }],
      });
      session = TestBed.inject(WorktreeSession);
      session.initialize('/container', descriptor(checkout('a')));
    });

    it('mutations_withoutAClient_areRefused', async () => {
      expect((await session.add({})).ok).toBe(false);
      expect((await session.remove('a')).ok).toBe(false);
    });

    it('reads_withoutAClient_doNothing', async () => {
      await session.refresh();

      expect(await session.loadBranches()).toEqual([]);
    });
  });

  describe('entering a container', () => {
    it('initialize_selectsTheFirstCheckoutAndClaimsTheRoot', () => {
      session.initialize('/container', descriptor(checkout('a'), checkout('b')));

      expect(session.isContainer()).toBe(true);
      expect(session.activeId()).toBe('a');
      expect(session.isClaimed('/container')).toBe(true);
    });

    it('initialize_again_keepsTheSelection', () => {
      session.initialize('/container', descriptor(checkout('a'), checkout('b')));
      session.activate('b');

      session.initialize('/container', descriptor(checkout('a'), checkout('b')));

      expect(session.activeId()).toBe('b');
    });

    it('initialize_withNoCheckouts_selectsNothing', () => {
      session.initialize('/container', descriptor());

      expect(session.activeId()).toBeNull();
      expect(session.activeLabel()).toBeNull();
    });

    it('initialize_readsTheStatuses', async () => {
      client.statuses = [status('a', 'main')];

      session.initialize('/container', descriptor(checkout('a')));
      await settle();

      expect(session.statuses().get('a')?.branch).toBe('main');
    });

    it('claimed_listsEveryRootOnce', () => {
      session.initialize('/container', descriptor(checkout('a')));
      session.claimRoot('/container/a');
      session.claimRoot('/container/a');

      expect(session.claimed()).toEqual(['/container', '/container/a']);
    });
  });

  describe('labels', () => {
    it('labelFor_prefersTheAlias', async () => {
      client.statuses = [status('a', 'live')];
      session.initialize('/container', descriptor(checkout('a', 'stale', 'Mine')));
      await settle();

      expect(session.labelFor('a')).toBe('Mine');
    });

    it('labelFor_withoutAlias_prefersTheLiveBranch', async () => {
      client.statuses = [status('a', 'live')];
      session.initialize('/container', descriptor(checkout('a', 'stale')));
      await settle();

      expect(session.labelFor('a')).toBe('live');
    });

    it('labelFor_liveBranchUnknown_fallsBackToTheRecordedOne', async () => {
      client.statuses = [status('a', null)];
      session.initialize('/container', descriptor(checkout('a', 'recorded')));
      await settle();

      expect(session.labelFor('a')).toBe('recorded');
    });

    it('labelFor_nothingKnown_neverSurfacesTheId', () => {
      session.initialize('/container', descriptor(checkout('guid-1', null)));

      expect(session.labelFor('guid-1')).toBe('checkout');
      expect(session.labelFor('gone')).toBe('checkout');
    });
  });

  describe('branches', () => {
    beforeEach(async (): Promise<void> => {
      client.statuses = [status('a', 'dev'), status('b', 'dev'), status('c', null)];
      session.initialize('/container', descriptor(checkout('a'), checkout('b'), checkout('c')));
      await settle();
    });

    it('duplicateBranches_reportsABranchTwoCheckoutsShare', () => {
      expect([...session.duplicateBranches()]).toEqual(['dev']);
    });

    it('takenBranches_ignoresADetachedCheckout', () => {
      expect([...session.takenBranches()]).toEqual(['dev']);
    });

    it('add_aBranchAlreadyCheckedOut_isRefusedBeforeCloning', async () => {
      const outcome: WorktreeOutcome<WorktreeCheckoutInfo> = await session.add({ branch: 'dev' });

      expect(outcome.ok).toBe(false);
      expect(client.calls).toEqual([]);
      expect(session.busy()).toBeNull();
    });

    it('loadBranches_unreadable_isAnEmptyList', async () => {
      client.branchNames = null;

      expect(await session.loadBranches()).toEqual([]);
    });

    it('loadBranches_readsThem', async () => {
      expect(await session.loadBranches()).toEqual(['main', 'origin/dev']);
    });

    it('createBranch_success_rereadsTheStatuses', async () => {
      client.statuses = [status('a', 'feature')];

      await session.createBranch('a', 'feature', true);

      expect(client.calls).toEqual(['createBranch:a:feature:true']);
      expect(session.statuses().get('a')?.branch).toBe('feature');
    });

    it('createBranch_failure_keepsTheStatuses', async () => {
      client.outcome = { ok: false, error: 'exists' };
      const reads: number = client.statusReads;

      const outcome: WorktreeOutcome<null> = await session.createBranch('a', 'x', false);

      expect(outcome.ok).toBe(false);
      expect(client.statusReads).toBe(reads);
    });

    it('deleteBranch_success_rereadsTheStatuses', async () => {
      client.statuses = [];

      await session.deleteBranch('a', 'dev', true);

      expect(client.calls).toEqual(['deleteBranch:a:dev:true']);
      expect(session.statuses().size).toBe(0);
    });

    it('deleteBranch_failure_keepsTheStatuses', async () => {
      client.outcome = { ok: false, error: 'unmerged' };
      const reads: number = client.statusReads;

      await session.deleteBranch('a', 'dev', false);

      expect(client.statusReads).toBe(reads);
    });
  });

  describe('refreshing', () => {
    beforeEach(async (): Promise<void> => {
      client.statuses = [status('a', 'main')];
      session.initialize('/container', descriptor(checkout('a')));
      await settle();
    });

    it('refresh_takesTheNewDescriptor', async () => {
      client.description = descriptor(checkout('a'), checkout('b'));

      await session.refresh();

      expect(session.descriptor()?.checkouts).toHaveLength(2);
    });

    it('refresh_unreadableContainer_keepsWhatItHad', async () => {
      client.description = null;

      await session.refresh();

      expect(session.descriptor()?.checkouts).toHaveLength(1);
    });

    it('refreshStatus_unreadable_keepsWhatItHad', async () => {
      client.statuses = null;

      await session.refreshStatus();

      expect(session.statuses().get('a')?.branch).toBe('main');
    });
  });

  describe('mutating', () => {
    beforeEach(async (): Promise<void> => {
      session.initialize('/container', descriptor(checkout('a')));
      await settle();
    });

    it('add_success_refreshesTheDescriptor', async () => {
      client.description = descriptor(checkout('a'), checkout('c'));

      const outcome: WorktreeOutcome<WorktreeCheckoutInfo> = await session.add({ branch: 'c' });

      expect(outcome.ok).toBe(true);
      expect(session.descriptor()?.checkouts).toHaveLength(2);
    });

    it('add_isBusyOnlyWhileTheCloneRuns', async () => {
      let finish: () => void = (): void => undefined;
      client.pending = new Promise<void>((resolve: () => void): void => {
        finish = resolve;
      });

      const adding: Promise<unknown> = session.add({});
      expect(session.busy()).toBe('add');
      finish();
      await adding;

      expect(session.busy()).toBeNull();
    });

    it('add_failure_keepsTheDescriptorAndClearsBusy', async () => {
      client.added = { ok: false, error: 'clone failed' };
      const describes: number = client.describes;

      const outcome: WorktreeOutcome<WorktreeCheckoutInfo> = await session.add({});

      expect(outcome).toEqual({ ok: false, error: 'clone failed' });
      expect(client.describes).toBe(describes);
      expect(session.busy()).toBeNull();
    });

    it('add_bridgeRejects_stillClearsBusy', async () => {
      client.pending = Promise.reject(new Error('ipc closed'));

      await expect(session.add({})).rejects.toThrow('ipc closed');

      expect(session.busy()).toBeNull();
    });

    it('remove_success_refreshes', async () => {
      client.description = descriptor();

      await session.remove('a');

      expect(client.calls).toEqual(['remove:/container:a']);
      expect(session.descriptor()?.checkouts).toEqual([]);
    });

    it('remove_failure_keepsTheCheckoutAndClearsBusy', async () => {
      client.outcome = { ok: false, error: 'in use' };
      client.description = descriptor();

      const outcome: WorktreeOutcome<null> = await session.remove('a');

      expect(outcome.ok).toBe(false);
      expect(session.descriptor()?.checkouts).toHaveLength(1);
      expect(session.busy()).toBeNull();
    });

    it('remove_bridgeRejects_stillClearsBusy', async () => {
      client.pending = Promise.reject(new Error('ipc closed'));

      await expect(session.remove('a')).rejects.toThrow('ipc closed');

      expect(session.busy()).toBeNull();
    });

    it('rename_success_refreshes', async () => {
      client.description = descriptor(checkout('a', 'a', 'Renamed'));

      await session.rename('a', 'Renamed');

      expect(session.labelFor('a')).toBe('Renamed');
    });

    it('rename_failure_keepsTheLabel', async () => {
      client.outcome = { ok: false, error: 'bad alias' };
      client.description = descriptor(checkout('a', 'a', 'Renamed'));

      await session.rename('a', 'Renamed');

      expect(session.labelFor('a')).toBe('a');
    });
  });
});
