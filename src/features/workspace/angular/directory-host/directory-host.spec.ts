import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  OnDestroy,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Bridge } from '@shared/api/bridge';
import { DirectoryListing, WorkspaceChannel } from '@shared/api/workspace-channels';
import {
  WorkspaceKind,
  WorktreeCheckoutInfo,
  WorktreeDescriptor,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { WorktreeClient } from '@shared/api/worktree-channels';
import { Log } from '@shared/angular/services/log/log';
import { Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { Worktrees } from '@shared/angular/services/worktree/worktrees';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';
import { DirectoryHost } from './directory-host';

/**
 * Stands in for the real workspace view, which is its own spec's business.
 */
@Component({
  selector: 'app-directory-view',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubDirectoryView implements OnDestroy {
  public static destroyed: number = 0;
  public readonly tabId: InputSignal<string> = input<string>('');
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
  public readonly listing: InputSignal<DirectoryListing | null> = input<DirectoryListing | null>(
    null,
  );
  public readonly checkoutId: InputSignal<string | null> = input<string | null>(null);
  public readonly layoutRoot: InputSignal<string | null> = input<string | null>(null);
  public readonly adoptConversation: InputSignal<string | null> = input<string | null>(null);
  public readonly promoteHandler: InputSignal<((id: string | null) => void) | null> = input<
    ((id: string | null) => void) | null
  >(null);
  public readonly rootChanged: OutputEmitterRef<string | null> = output<string | null>();

  public ngOnDestroy(): void {
    StubDirectoryView.destroyed += 1;
  }
}

/**
 * A promise settled from outside, standing in for a reply still in flight.
 */
class Deferred<T> {
  public resolve: (value: T) => void = (): void => undefined;
  public reject: (reason: Error) => void = (): void => undefined;
  public readonly promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: Error) => void): void => {
      this.resolve = resolve;
      this.reject = reject;
    },
  );
}

/**
 * A checkout of the container.
 */
function checkout(id: string): WorktreeCheckoutInfo {
  return { id, path: `/container/${id}`, exists: true, branch: id };
}

/**
 * A listing of a folder.
 */
function listing(path: string): DirectoryListing {
  return { path, name: path, children: [] } as unknown as DirectoryListing;
}

/**
 * A fake of the worktree client, with each reply replaceable.
 */
class FakeClient implements WorktreeClient {
  public kind: () => Promise<WorkspaceKind | null> = (): Promise<WorkspaceKind | null> =>
    Promise.resolve(null);
  public description: () => Promise<WorktreeDescriptor | null> =
    (): Promise<WorktreeDescriptor | null> =>
      Promise.resolve({
        root: '/container',
        origin: null,
        checkouts: [checkout('a'), checkout('b')],
      });
  public promotion: () => Promise<WorktreeOutcome<WorktreeDescriptor>> = (): Promise<
    WorktreeOutcome<WorktreeDescriptor>
  > =>
    Promise.resolve({
      ok: true,
      value: { root: '/container', origin: null, checkouts: [checkout('a')] },
    });
  public opening: (id: string) => Promise<WorktreeOutcome<string>> = (
    id: string,
  ): Promise<WorktreeOutcome<string>> => Promise.resolve({ ok: true, value: `/container/${id}` });
  public readonly resolved: string[] = [];
  public statusReads: number = 0;

  public resolve(target: string): Promise<WorkspaceKind | null> {
    this.resolved.push(target);
    return this.kind();
  }

  public describe(): Promise<WorktreeDescriptor | null> {
    return this.description();
  }

  public promote(): Promise<WorktreeOutcome<WorktreeDescriptor>> {
    return this.promotion();
  }

  public openCheckout(_root: string, id: string): Promise<WorktreeOutcome<string>> {
    return this.opening(id);
  }

  public status(): Promise<null> {
    this.statusReads += 1;
    return Promise.resolve(null);
  }

  public addCheckout(): Promise<WorktreeOutcome<WorktreeCheckoutInfo>> {
    return Promise.resolve({ ok: false, error: 'unused' });
  }

  public removeCheckout(): Promise<WorktreeOutcome<null>> {
    return Promise.resolve({ ok: false, error: 'unused' });
  }

  public renameCheckout(): Promise<WorktreeOutcome<null>> {
    return Promise.resolve({ ok: false, error: 'unused' });
  }

  public branches(): Promise<null> {
    return Promise.resolve(null);
  }

  public deleteBranch(): Promise<WorktreeOutcome<null>> {
    return Promise.resolve({ ok: false, error: 'unused' });
  }

  public createBranch(): Promise<WorktreeOutcome<null>> {
    return Promise.resolve({ ok: false, error: 'unused' });
  }
}

/**
 * A fake of the transport: reads a listing for any path, and records the roots closed.
 */
class FakeBridge implements Bridge {
  public readonly closed: string[] = [];
  public unreadable: Set<string> = new Set<string>();

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const path: string = String(args[0]);
    if (channel === String(WorkspaceChannel.CloseFolder)) {
      this.closed.push(path);
    }
    if (channel === String(WorkspaceChannel.ReadDirectory)) {
      return Promise.resolve((this.unreadable.has(path) ? null : listing(path)) as T);
    }
    return Promise.resolve(undefined as T);
  }

  public send(): void {
    // The host sends nothing.
  }

  public on(): () => void {
    return (): void => undefined;
  }
}

describe('DirectoryHost', () => {
  let client: FakeClient;
  let bridge: FakeBridge;
  let fixture: ComponentFixture<DirectoryHost> | undefined;

  /**
   * Lets every queued reply land and the view catch up.
   */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    if (fixture !== undefined && !fixture.componentRef.hostView.destroyed) {
      await fixture.whenStable();
    }
  }

  /**
   * Mounts the host, optionally with a folder handed to the tab.
   */
  async function mount(initial?: DirectoryListing): Promise<ComponentFixture<DirectoryHost>> {
    if (initial !== undefined) {
      TestBed.inject(Workspaces).setInitial('tab-1', initial);
    }
    const created: ComponentFixture<DirectoryHost> = TestBed.createComponent(DirectoryHost);
    fixture = created;
    created.componentRef.setInput('tabId', 'tab-1');
    created.componentRef.setInput('isActive', true);
    await created.whenStable();
    await settle();
    await settle();
    return created;
  }

  /**
   * Reads the views the tab renders.
   */
  function views(): readonly StubDirectoryView[] {
    return (fixture?.debugElement.queryAll(By.directive(StubDirectoryView)) ?? []).map(
      (element): StubDirectoryView => element.componentInstance as StubDirectoryView,
    );
  }

  /**
   * Reads the tab's session.
   */
  function session(): WorktreeSession {
    const injected: WorktreeSession | undefined =
      fixture?.debugElement.injector.get(WorktreeSession);
    if (injected === undefined) {
      throw new Error('Nothing is mounted');
    }
    return injected;
  }

  /**
   * Reads the tab's text.
   */
  function text(): string {
    return (fixture?.nativeElement as HTMLElement).textContent;
  }

  beforeEach((): void => {
    StubDirectoryView.destroyed = 0;
    client = new FakeClient();
    bridge = new FakeBridge();
    fixture = undefined;
    Object.defineProperty(window, 'bridge', { value: bridge, configurable: true });
    TestBed.configureTestingModule({
      imports: [DirectoryHost],
      providers: [{ provide: Worktrees, useValue: { client } }],
    });
    TestBed.overrideComponent(DirectoryHost, { set: { imports: [StubDirectoryView] } });
  });

  afterEach((): void => {
    Reflect.deleteProperty(window, 'bridge');
    localStorage.clear();
  });

  describe('deciding what the tab is', () => {
    it('open_blankTab_showsTheSingleViewWithoutAFolder', async () => {
      await mount();

      expect(views()).toHaveLength(1);
      expect(views()[0]?.listing()).toBeNull();
    });

    it('open_ordinaryFolder_showsTheSingleViewOverIt', async () => {
      await mount(listing('/plain'));

      expect(views()).toHaveLength(1);
      expect(views()[0]?.listing()?.path).toBe('/plain');
    });

    it('open_stillResolving_showsNoViewYet', async () => {
      const kind: Deferred<WorkspaceKind | null> = new Deferred<WorkspaceKind | null>();
      client.kind = (): Promise<WorkspaceKind | null> => kind.promise;

      await mount(listing('/container'));

      expect(views()).toEqual([]);
      kind.resolve(null);
      await settle();
      expect(views()).toHaveLength(1);
    });

    it('open_withoutAWorktreeClient_isAnOrdinaryFolder', async () => {
      TestBed.overrideProvider(Worktrees, { useValue: { client: undefined } });

      await mount(listing('/plain'));

      expect(views()[0]?.listing()?.path).toBe('/plain');
    });

    it('open_worktreeContainer_materialisesItsFirstCheckout', async () => {
      client.kind = (): Promise<WorkspaceKind> => Promise.resolve('worktree');

      await mount(listing('/container'));

      expect(views().map((view: StubDirectoryView) => view.checkoutId())).toEqual(['a']);
      expect(session().isClaimed('/container')).toBe(true);
      expect(session().isClaimed('/container/a')).toBe(true);
    });

    it('open_containerThatCannotBeDescribed_fallsBackToTheSingleView', async () => {
      client.kind = (): Promise<WorkspaceKind> => Promise.resolve('worktree');
      client.description = (): Promise<null> => Promise.resolve(null);

      await mount(listing('/container'));

      expect(views()[0]?.checkoutId()).toBeNull();
      expect(views()[0]?.listing()?.path).toBe('/container');
      expect(session().isContainer()).toBe(false);
    });
  });

  describe('switching checkouts', () => {
    beforeEach((): void => {
      client.kind = (): Promise<WorkspaceKind> => Promise.resolve('worktree');
    });

    it('activate_firstVisit_materialisesAndKeepsTheOtherAlive', async () => {
      await mount(listing('/container'));

      session().activate('b');
      await settle();
      await settle();

      expect(views().map((view: StubDirectoryView) => view.checkoutId())).toEqual(['a', 'b']);
      expect(StubDirectoryView.destroyed).toBe(0);
    });

    it('activate_onlyTheActiveViewIsActive', async () => {
      await mount(listing('/container'));

      session().activate('b');
      await settle();
      await settle();

      expect(views().map((view: StubDirectoryView) => view.isActive())).toEqual([false, true]);
    });

    it('activate_backAndForth_opensEachCheckoutOnce', async () => {
      const opened: string[] = [];
      client.opening = (id: string): Promise<WorktreeOutcome<string>> => {
        opened.push(id);
        return Promise.resolve({ ok: true, value: `/container/${id}` });
      };
      await mount(listing('/container'));

      session().activate('b');
      await settle();
      await settle();
      session().activate('a');
      await settle();
      session().activate('b');
      await settle();

      expect(opened).toEqual(['a', 'b']);
    });

    it('activate_whileStillOpening_showsThePlaceholder', async () => {
      await mount(listing('/container'));
      const opening: Deferred<WorktreeOutcome<string>> = new Deferred<WorktreeOutcome<string>>();
      client.opening = (): Promise<WorktreeOutcome<string>> => opening.promise;

      session().activate('b');
      await settle();

      expect(text()).toContain('Opening worktree');
      opening.resolve({ ok: true, value: '/container/b' });
      await settle();
      await settle();
      expect(text()).not.toContain('Opening worktree');
    });

    it('load_refused_logsAndMaterialisesNothing', async () => {
      await mount(listing('/container'));
      const error: ReturnType<typeof vi.spyOn> = vi.spyOn(TestBed.inject(Log), 'error');
      client.opening = (): Promise<WorktreeOutcome<string>> =>
        Promise.resolve({ ok: false, error: 'gone from disk' });

      session().activate('b');
      await settle();

      expect(error).toHaveBeenCalled();
      expect(views()).toHaveLength(1);
      expect(session().isClaimed('/container/b')).toBe(false);
    });

    it('load_unreadableListing_materialisesNothingButStillOwnsTheRoot', async () => {
      await mount(listing('/container'));
      bridge.unreadable.add('/container/b');

      session().activate('b');
      await settle();
      await settle();

      expect(views()).toHaveLength(1);
      expect(session().isClaimed('/container/b')).toBe(true);
    });

    it('load_refusedThenRevisited_triesAgain', async () => {
      await mount(listing('/container'));
      client.opening = (): Promise<WorktreeOutcome<string>> =>
        Promise.resolve({ ok: false, error: 'busy' });
      session().activate('b');
      await settle();
      client.opening = (id: string): Promise<WorktreeOutcome<string>> =>
        Promise.resolve({ ok: true, value: `/container/${id}` });

      session().activate('a');
      await settle();
      session().activate('b');
      await settle();
      await settle();

      expect(views().map((view: StubDirectoryView) => view.checkoutId())).toEqual(['a', 'b']);
    });
  });

  describe('removing a checkout', () => {
    beforeEach((): void => {
      client.kind = (): Promise<WorkspaceKind> => Promise.resolve('worktree');
    });

    /**
     * Mounts a container with both checkouts materialised, then leaves only the given one.
     */
    async function keepOnly(left: string): Promise<void> {
      await mount(listing('/container'));
      session().activate('b');
      await settle();
      await settle();
      client.description = (): Promise<WorktreeDescriptor> =>
        Promise.resolve({ root: '/container', origin: null, checkouts: [checkout(left)] });
      await session().refresh();
      await settle();
      await settle();
    }

    it('remove_active_fallsBackToTheFirstRemaining', async () => {
      await keepOnly('a');

      expect(session().activeId()).toBe('a');
    });

    it('remove_tearsItsViewDownAndClosesItsRoot', async () => {
      await keepOnly('a');

      expect(views().map((view: StubDirectoryView) => view.checkoutId())).toEqual(['a']);
      expect(StubDirectoryView.destroyed).toBe(1);
      expect(bridge.closed).toEqual(['/container/b']);
    });

    it('remove_inactive_leavesTheSelectionAlone', async () => {
      await keepOnly('b');

      expect(session().activeId()).toBe('b');
      expect(bridge.closed).toEqual(['/container/a']);
    });
  });

  describe('a folder opened in the single view', () => {
    it('rootChanged_folderIsAContainer_rebuildsTheTabAroundIt', async () => {
      await mount();
      client.kind = (): Promise<WorkspaceKind> => Promise.resolve('worktree');

      views()[0]?.rootChanged.emit('/container');
      await settle();
      await settle();
      await settle();

      expect(views().map((view: StubDirectoryView) => view.checkoutId())).toEqual(['a']);
      expect(session().isClaimed('/container')).toBe(true);
    });

    it('rootChanged_ordinaryFolder_staysAsItIs', async () => {
      await mount();

      views()[0]?.rootChanged.emit('/plain');
      await settle();

      expect(client.resolved).toEqual(['/plain']);
      expect(views()[0]?.checkoutId()).toBeNull();
      expect(session().isClaimed('/plain')).toBe(false);
    });

    it('rootChanged_null_asksNothing', async () => {
      await mount();

      views()[0]?.rootChanged.emit(null);
      await settle();

      expect(client.resolved).toEqual([]);
    });
  });

  describe('promoting', () => {
    /**
     * Mounts a single view rooted at the given folder and reads its promote action.
     */
    async function promotable(root: string | null): Promise<(id: string | null) => void> {
      await mount();
      const view: StubDirectoryView | undefined = views()[0];
      if (root !== null) {
        view?.rootChanged.emit(root);
        await settle();
      }
      const handler: ((id: string | null) => void) | null | undefined = view?.promoteHandler();
      if (handler === null || handler === undefined) {
        throw new Error('The view was given no promote action');
      }
      return handler;
    }

    it('promote_rebuildsTheTabAsAContainer', async () => {
      const promote: (id: string | null) => void = await promotable('/repo');

      promote(null);
      await settle();
      await settle();
      await settle();

      expect(views().map((view: StubDirectoryView) => view.checkoutId())).toEqual(['a']);
      expect(session().isClaimed('/repo')).toBe(true);
    });

    it('promote_carriesTheConversationIntoTheFirstWorktree', async () => {
      const promote: (id: string | null) => void = await promotable('/repo');

      promote('conversation-1');
      await settle();
      await settle();
      await settle();

      expect(views()[0]?.adoptConversation()).toBe('conversation-1');
    });

    it('promote_withoutAConversation_carriesNothing', async () => {
      const promote: (id: string | null) => void = await promotable('/repo');

      promote(null);
      await settle();
      await settle();
      await settle();

      expect(views()[0]?.adoptConversation()).toBeNull();
    });

    it('promote_refused_logsAndLeavesTheViewAlone', async () => {
      const promote: (id: string | null) => void = await promotable('/repo');
      const error: ReturnType<typeof vi.spyOn> = vi.spyOn(TestBed.inject(Log), 'error');
      client.promotion = (): Promise<WorktreeOutcome<WorktreeDescriptor>> =>
        Promise.resolve({ ok: false, error: 'dirty working copy' });

      promote(null);
      await settle();

      expect(error).toHaveBeenCalled();
      expect(views()[0]?.checkoutId()).toBeNull();
      expect(StubDirectoryView.destroyed).toBe(0);
      expect(session().isClaimed('/repo')).toBe(false);
    });

    it('promote_noFolderOpen_doesNothing', async () => {
      const promote: (id: string | null) => void = await promotable(null);
      let asked: boolean = false;
      client.promotion = (): Promise<WorktreeOutcome<WorktreeDescriptor>> => {
        asked = true;
        return Promise.resolve({ ok: false, error: 'unused' });
      };

      promote(null);
      await settle();

      expect(asked).toBe(false);
    });
  });

  describe('going back to the tab', () => {
    it('isActive_container_refreshesTheStatuses', async () => {
      client.kind = (): Promise<WorkspaceKind> => Promise.resolve('worktree');
      const mounted: ComponentFixture<DirectoryHost> = await mount(listing('/container'));
      mounted.componentRef.setInput('isActive', false);
      await mounted.whenStable();
      const reads: number = client.statusReads;

      mounted.componentRef.setInput('isActive', true);
      await mounted.whenStable();

      expect(client.statusReads).toBe(reads + 1);
    });
  });

  describe('tearing down', () => {
    it('destroy_container_closesEveryRootItClaimed', async () => {
      client.kind = (): Promise<WorkspaceKind> => Promise.resolve('worktree');
      const mounted: ComponentFixture<DirectoryHost> = await mount(listing('/container'));

      mounted.destroy();

      expect(bridge.closed).toEqual(['/container', '/container/a']);
    });

    it('destroy_singleView_leavesItsRootToTheView', async () => {
      const mounted: ComponentFixture<DirectoryHost> = await mount(listing('/plain'));

      mounted.destroy();

      expect(bridge.closed).toEqual([]);
    });
  });
});
