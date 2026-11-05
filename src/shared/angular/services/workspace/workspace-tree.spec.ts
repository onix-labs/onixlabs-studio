import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import {
  DirectoryListing,
  FileOperationResult,
  WorkspaceChannel,
} from '@shared/api/workspace-channels';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { Documents } from '@shared/angular/services/documents/documents';
import { Workspace } from './workspace';

/**
 * A directory change, as the watch reports one.
 */
type ChangeListener = Parameters<DirectoryWatch['watch']>[1];

/**
 * A folder tree in memory, whose reads can be made to fail or wait.
 */
class FakeDisk {
  public readonly listings: Map<string, DirectoryListing> = new Map<string, DirectoryListing>([
    [
      '/ws',
      {
        path: '/ws',
        name: 'ws',
        entries: [
          { name: 'src', path: '/ws/src', type: 'directory' },
          { name: 'lib', path: '/ws/lib', type: 'directory' },
          { name: 'a.md', path: '/ws/a.md', type: 'file' },
        ],
      },
    ],
    [
      '/ws/src',
      {
        path: '/ws/src',
        name: 'src',
        entries: [{ name: 'main.ts', path: '/ws/src/main.ts', type: 'file' }],
      },
    ],
    ['/ws/lib', { path: '/ws/lib', name: 'lib', entries: [] }],
  ]);

  public failing: boolean = false;
  public unreadable: boolean = false;
  public reads: string[] = [];
  public operation: FileOperationResult | Error = { success: true, path: '/ws/new.md' };
  public closed: string[] = [];

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    return this.answer(channel, args) as Promise<T>;
  }

  private async answer(channel: string, args: readonly unknown[]): Promise<unknown> {
    switch (channel) {
      case WorkspaceChannel.OpenFolder as string:
        return Promise.resolve(this.listings.get('/ws') ?? null);
      case WorkspaceChannel.ReadDirectory as string:
        this.reads.push(String(args[0]));
        if (this.failing) {
          throw new Error('the bridge has gone');
        }
        return Promise.resolve(
          this.unreadable ? null : (this.listings.get(String(args[0])) ?? null),
        );
      case WorkspaceChannel.CloseFolder as string:
        this.closed.push(String(args[0]));
        return Promise.resolve();
      case WorkspaceChannel.CreateFile as string:
      case WorkspaceChannel.CreateFolder as string:
      case WorkspaceChannel.Rename as string:
      case WorkspaceChannel.Delete as string:
        if (this.operation instanceof Error) {
          throw this.operation;
        }
        return Promise.resolve(this.operation);
      default:
        return Promise.resolve(null);
    }
  }
}

describe('Workspace tree resilience', () => {
  let disk: FakeDisk;
  let service: Workspace;
  let listener: ChangeListener | null;
  let stoppedWatching: number;

  /**
   * Waits past the burst debounce and the refreshes it starts.
   */
  async function afterRefresh(): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 340);
    });
  }

  /**
   * Reads the paths the tree shows.
   */
  function shown(): readonly string[] {
    return service.rows().map((row: { node: { path: string } }): string => row.node.path);
  }

  /**
   * Finds a node's row.
   */
  function row(path: string): { loading: boolean; expanded: boolean } | undefined {
    const found: { node: { path: string; loading?: boolean }; expanded: boolean } | undefined =
      service
        .rows()
        .find((candidate: { node: { path: string } }): boolean => candidate.node.path === path);
    return found === undefined
      ? undefined
      : { loading: found.node.loading === true, expanded: found.expanded };
  }

  beforeEach(async () => {
    disk = new FakeDisk();
    listener = null;
    stoppedWatching = 0;
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> =>
        disk.invoke<T>(channel, ...args),
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DirectoryWatch,
          useValue: {
            watch: (_root: string, onChange: ChangeListener): (() => void) => {
              listener = onChange;
              return (): void => {
                stoppedWatching += 1;
              };
            },
          },
        },
      ],
    });
    service = TestBed.inject(Workspace);
    await service.openFolder();
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  describe('expanding', () => {
    it('expand_whenTheReadRejects_stopsLoadingAndCanBeRetried', async () => {
      disk.failing = true;

      await service.toggleDirectory('/ws/src');

      expect(row('/ws/src')).toEqual({ loading: false, expanded: false });

      disk.failing = false;
      await service.toggleDirectory('/ws/src');

      expect(shown()).toContain('/ws/src/main.ts');
    });

    it('expand_ofAnUnreadableFolder_isRetriedRatherThanShownEmpty', async () => {
      disk.unreadable = true;
      await service.toggleDirectory('/ws/src');

      disk.unreadable = false;
      await service.toggleDirectory('/ws/src');

      expect(shown()).toContain('/ws/src/main.ts');
    });

    it('expand_ofAFile_orSomethingUnknown_doesNothing', async () => {
      await service.toggleDirectory('/ws/a.md');
      await service.toggleDirectory('/ws/nothing');

      expect(disk.reads).toEqual([]);
    });

    it('expand_afterTheFolderClosed_doesNotResurrectTheTree', async () => {
      const expanding: Promise<void> = service.toggleDirectory('/ws/src');
      service.releaseFolder();

      await expanding;

      expect(shown()).toEqual([]);
    });
  });

  describe('revealing', () => {
    it('reveal_opensTheAncestorsAndSelects', async () => {
      await service.revealPath('/ws/src/main.ts');

      expect(shown()).toContain('/ws/src/main.ts');
      expect(service.selectedPath()).toBe('/ws/src/main.ts');
    });

    it('reveal_outsideTheRoot_orOfASiblingWithTheRootsPrefix_doesNothing', async () => {
      await service.revealPath('/ws-other/secret');
      await service.revealPath('/ws');

      expect(service.selectedPath()).toBeNull();
    });

    it('reveal_throughAnUnreadableFolder_stillSelects', async () => {
      disk.unreadable = true;

      await service.revealPath('/ws/src/main.ts');

      expect(service.selectedPath()).toBe('/ws/src/main.ts');
    });
  });

  describe('file operations', () => {
    it('operation_whenTheBridgeRejects_failsWithTheReason', async () => {
      disk.operation = new Error('disk full');

      const result: FileOperationResult = await service.createFile('/ws', 'new.md');

      expect(result).toEqual({ success: false, error: 'disk full' });
    });

    it('operation_whoseRefreshFails_stillReportsItsSuccess', async () => {
      disk.failing = true;

      expect((await service.createFile('/ws', 'new.md')).success).toBe(true);
    });

    it('operation_refused_refreshesNothing', async () => {
      disk.operation = { success: false, error: 'exists' };

      await service.createFolder('/ws', 'new');

      expect(disk.reads).toEqual([]);
    });

    it('operation_inAFolderNotLoaded_readsNothing', async () => {
      await service.createFile('/ws/lib', 'new.md');

      expect(disk.reads).toEqual([]);
    });

    it('rename_movesOpenDocumentsAlong', async () => {
      const relocate: ReturnType<typeof vi.spyOn> = vi.spyOn(TestBed.inject(Documents), 'relocate');

      await service.rename('/ws/a.md', 'new.md');

      expect(relocate).toHaveBeenCalledWith('/ws/a.md', '/ws/new.md');
    });

    it('delete_refreshesTheParent', async () => {
      await service.delete('/ws/a.md', true);

      expect(disk.reads).toEqual(['/ws']);
    });
  });

  describe('watching the folder', () => {
    it('change_inARootFolder_addsTheNewEntry', async () => {
      disk.listings.set('/ws', {
        path: '/ws',
        name: 'ws',
        entries: [{ name: 'b.md', path: '/ws/b.md', type: 'file' }],
      });

      listener?.({ root: '/ws', directories: ['/ws'], overflow: false });
      await afterRefresh();

      expect(shown()).toContain('/ws/b.md');
    });

    it('burst_ofChanges_refreshesEachFolderOnce', async () => {
      await service.toggleDirectory('/ws/src');
      disk.reads = [];

      listener?.({ root: '/ws', directories: ['/ws'], overflow: false });
      listener?.({ root: '/ws', directories: ['/ws/src'], overflow: false });
      listener?.({ root: '/ws', directories: ['/ws'], overflow: false });
      await afterRefresh();

      expect([...disk.reads].sort()).toEqual(['/ws', '/ws/src']);
    });

    it('overflow_refreshesEveryLoadedFolder', async () => {
      await service.toggleDirectory('/ws/src');
      disk.reads = [];

      listener?.({ root: '/ws', directories: [], overflow: true });
      listener?.({ root: '/ws', directories: ['/ws/lib'], overflow: false });
      await afterRefresh();

      expect([...disk.reads].sort()).toEqual(['/ws', '/ws/src']);
    });

    it('change_inAFolderNotLoaded_readsNothing', async () => {
      listener?.({ root: '/ws', directories: ['/ws/lib'], overflow: false });
      await afterRefresh();

      expect(disk.reads).toEqual([]);
    });

    it('change_fromAnotherRoot_isIgnored', async () => {
      listener?.({ root: '/other', directories: ['/other'], overflow: false });
      await afterRefresh();

      expect(disk.reads).toEqual([]);
    });

    it('refresh_whenTheReadRejects_keepsTheTree', async () => {
      disk.failing = true;

      listener?.({ root: '/ws', directories: ['/ws'], overflow: false });
      await afterRefresh();

      expect(shown()).toContain('/ws/a.md');
    });

    it('close_cancelsAPendingRefreshAndStopsWatching', async () => {
      listener?.({ root: '/ws', directories: ['/ws'], overflow: false });

      await service.closeFolder();
      await afterRefresh();

      expect(disk.reads).toEqual([]);
      expect(disk.closed).toEqual(['/ws']);
      expect(stoppedWatching).toBe(1);
      expect(service.hasWorkspace()).toBe(false);
    });

    it('close_withNothingOpen_tellsNobody', async () => {
      service.releaseFolder();

      await service.closeFolder();

      expect(disk.closed).toEqual([]);
    });
  });
});
