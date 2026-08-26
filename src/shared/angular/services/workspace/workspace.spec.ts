import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import {
  DirectoryEntry,
  DirectoryListing,
  FileOperationResult,
  WorkspaceChannel,
} from '@shared/api/workspace-channels';
import { Workspace } from './workspace';

/**
 * Root listing returned by the fake bridge's open-folder dialog.
 */
const ROOT_LISTING: DirectoryListing = {
  path: '/ws',
  name: 'ws',
  entries: [
    { name: 'src', path: '/ws/src', type: 'directory' },
    { name: 'README.md', path: '/ws/README.md', type: 'file' },
  ],
};

/**
 * Child listing returned when the fake bridge reads `/ws/src`.
 */
const SRC_LISTING: DirectoryListing = {
  path: '/ws/src',
  name: 'src',
  entries: [
    { name: 'app', path: '/ws/src/app', type: 'directory' },
    { name: 'main.ts', path: '/ws/src/main.ts', type: 'file' },
  ],
};

/**
 * Grandchild listing returned when the fake bridge reads `/ws/src/app`.
 */
const APP_LISTING: DirectoryListing = {
  path: '/ws/src/app',
  name: 'app',
  entries: [{ name: 'app.ts', path: '/ws/src/app/app.ts', type: 'file' }],
};

/**
 * Builds a fake transport that routes the workspace channels to the canned listings above.
 */
function fakeBridge(): Bridge {
  return {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      switch (channel) {
        case WorkspaceChannel.Open as string:
          return Promise.resolve({ kind: 'directory', directory: ROOT_LISTING } as T);
        case WorkspaceChannel.OpenFolder as string:
          return Promise.resolve(ROOT_LISTING as T);
        case WorkspaceChannel.ReadDirectory as string:
          return Promise.resolve(
            (args[0] === '/ws/src'
              ? SRC_LISTING
              : args[0] === '/ws/src/app'
                ? APP_LISTING
                : null) as T,
          );
        default:
          return Promise.resolve(null as T);
      }
    },
    send: (): void => undefined,
    on: (): (() => void) => (): void => undefined,
  };
}

describe('Workspace', () => {
  let service: Workspace;

  beforeEach(() => {
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    TestBed.configureTestingModule({});
    service = TestBed.inject(Workspace);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('hasWorkspace_whenNoFolderOpen_returnsFalse', () => {
    expect(service.hasWorkspace()).toBe(false);
    expect(service.rows()).toHaveLength(0);
  });

  it('openFolder_whenFolderChosen_populatesRootAndRows', async () => {
    await service.openFolder();
    expect(service.hasWorkspace()).toBe(true);
    expect(service.rootName()).toBe('ws');
    expect(service.rows().map((row) => row.node.name)).toEqual(['src', 'README.md']);
  });

  it('toggleDirectory_whenFirstExpanded_lazyLoadsChildren', async () => {
    await service.openFolder();
    await service.toggleDirectory('/ws/src');
    expect(service.rows().map((row) => row.node.path)).toEqual([
      '/ws/src',
      '/ws/src/app',
      '/ws/src/main.ts',
      '/ws/README.md',
    ]);
  });

  it('toggleDirectory_whenExpandedAgain_collapsesChildren', async () => {
    await service.openFolder();
    await service.toggleDirectory('/ws/src');
    await service.toggleDirectory('/ws/src');
    expect(service.rows().map((row) => row.node.name)).toEqual(['src', 'README.md']);
  });

  it('select_whenCalled_updatesSelectedPath', () => {
    service.select('/ws/README.md');
    expect(service.selectedPath()).toBe('/ws/README.md');
  });

  it('openListing_whenCalled_seedsTreeWithoutADialog', () => {
    service.openListing(ROOT_LISTING);
    expect(service.hasWorkspace()).toBe(true);
    expect(service.rootName()).toBe('ws');
    expect(service.rows().map((row) => row.node.name)).toEqual(['src', 'README.md']);
  });

  it('closeFolder_whenCalled_clearsState', async () => {
    await service.openFolder();
    await service.closeFolder();
    expect(service.hasWorkspace()).toBe(false);
    expect(service.rows()).toHaveLength(0);
    expect(service.selectedPath()).toBeNull();
  });

  it('revealPath_expandsEveryAncestorAndSelectsTheEntry', async () => {
    await service.openFolder();

    await service.revealPath('/ws/src/app/app.ts');

    // Both ancestor directories were lazily loaded and expanded on the way down.
    expect(service.rows().map((row) => row.node.path)).toEqual([
      '/ws/src',
      '/ws/src/app',
      '/ws/src/app/app.ts',
      '/ws/src/main.ts',
      '/ws/README.md',
    ]);
    expect(service.selectedPath()).toBe('/ws/src/app/app.ts');
  });

  it('revealPath_keepsAlreadyExpandedAncestorsExpanded', async () => {
    await service.openFolder();
    await service.toggleDirectory('/ws/src');

    await service.revealPath('/ws/src/main.ts');

    expect(service.rows().map((row) => row.node.path)).toContain('/ws/src/main.ts');
    expect(service.selectedPath()).toBe('/ws/src/main.ts');
  });

  it('revealPath_outsideTheRoot_doesNothing', async () => {
    await service.openFolder();

    await service.revealPath('/elsewhere/file.ts');

    expect(service.selectedPath()).toBeNull();
  });

  it('revealPath_forARootPrefixThatIsNotAncestor_doesNothing', async () => {
    await service.openFolder();

    // '/ws-other' shares the '/ws' prefix but is not inside the root.
    await service.revealPath('/ws-other/file.ts');

    expect(service.selectedPath()).toBeNull();
  });
});

/**
 * Records a bridge call, so a test can assert what the service asked the main process for.
 */
interface BridgeCall {
  /**
   * Gets the channel invoked.
   */
  readonly channel: string;

  /**
   * Gets the arguments the channel was invoked with.
   */
  readonly args: readonly unknown[];
}

describe('Workspace mutations', () => {
  let service: Workspace;
  let calls: BridgeCall[];
  let result: FileOperationResult;
  let rootEntries: readonly DirectoryEntry[];

  beforeEach(() => {
    calls = [];
    result = { success: true, path: '/ws/added.ts' };
    rootEntries = ROOT_LISTING.entries;
    (window as unknown as { bridge: Bridge }).bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        switch (channel) {
          case WorkspaceChannel.OpenFolder as string:
            return Promise.resolve(ROOT_LISTING as T);
          case WorkspaceChannel.ReadDirectory as string:
            return Promise.resolve(
              (args[0] === '/ws'
                ? { ...ROOT_LISTING, entries: rootEntries }
                : args[0] === '/ws/src'
                  ? SRC_LISTING
                  : null) as T,
            );
          case WorkspaceChannel.CreateFile as string:
          case WorkspaceChannel.CreateFolder as string:
          case WorkspaceChannel.Rename as string:
          case WorkspaceChannel.Delete as string:
            return Promise.resolve(result as T);
          default:
            return Promise.resolve(null as T);
        }
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    TestBed.configureTestingModule({});
    service = TestBed.inject(Workspace);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  /**
   * Gets the calls made to a given channel.
   * @param channel The channel to filter by.
   * @returns Returns the matching calls.
   */
  function callsTo(channel: WorkspaceChannel): readonly BridgeCall[] {
    return calls.filter((call: BridgeCall): boolean => call.channel === (channel as string));
  }

  it('createFile_asksTheMainProcessForTheNameInsideThatDirectory', async () => {
    await service.openFolder();
    await service.createFile('/ws', 'added.ts');

    expect(callsTo(WorkspaceChannel.CreateFile).map((c: BridgeCall) => c.args)).toEqual([
      ['/ws', 'added.ts'],
    ]);
  });

  it('createFolder_asksTheMainProcessForTheNameInsideThatDirectory', async () => {
    await service.openFolder();
    await service.createFolder('/ws', 'tools');

    expect(callsTo(WorkspaceChannel.CreateFolder).map((c: BridgeCall) => c.args)).toEqual([
      ['/ws', 'tools'],
    ]);
  });

  it('rename_derivesTheDirectoryToRefreshFromTheEntrysOwnPath', async () => {
    await service.openFolder();
    await service.rename('/ws/README.md', 'READ.md');

    expect(callsTo(WorkspaceChannel.Rename).map((c: BridgeCall) => c.args)).toEqual([
      ['/ws/README.md', 'READ.md'],
    ]);
    expect(callsTo(WorkspaceChannel.ReadDirectory).map((c: BridgeCall) => c.args[0])).toContain(
      '/ws',
    );
  });

  it('delete_derivesTheDirectoryToRefreshFromTheEntrysOwnPath', async () => {
    await service.openFolder();
    await service.delete('/ws/README.md');

    expect(callsTo(WorkspaceChannel.Delete).map((c: BridgeCall) => c.args)).toEqual([
      ['/ws/README.md'],
    ]);
    expect(callsTo(WorkspaceChannel.ReadDirectory).map((c: BridgeCall) => c.args[0])).toContain(
      '/ws',
    );
  });

  it('createFile_reconcilesTheDirectory_soTheEntryAppearsWithoutAManualRefresh', async () => {
    // The caller awaits the mutation and should find the tree already showing its result; leaving
    // this to the directory watcher would make the postcondition a race against a debounce.
    await service.openFolder();
    rootEntries = [
      ...ROOT_LISTING.entries,
      { name: 'added.ts', path: '/ws/added.ts', type: 'file' },
    ];

    await service.createFile('/ws', 'added.ts');

    expect(service.rows().map((row) => row.node.name)).toEqual(['src', 'README.md', 'added.ts']);
  });

  it('delete_reconcilesTheDirectory_soTheEntryDropsOut', async () => {
    await service.openFolder();
    rootEntries = ROOT_LISTING.entries.filter(
      (entry: DirectoryEntry): boolean => entry.name !== 'README.md',
    );

    await service.delete('/ws/README.md');

    expect(service.rows().map((row) => row.node.name)).toEqual(['src']);
  });

  it('mutation_whenItFails_returnsTheErrorAndLeavesTheTreeAlone', async () => {
    // Nothing changed on disk, so there is nothing to reconcile and re-reading would only cost a
    // round trip to prove it.
    await service.openFolder();
    result = { success: false, error: 'Invalid name' };
    const before: number = callsTo(WorkspaceChannel.ReadDirectory).length;

    const outcome: FileOperationResult = await service.rename('/ws/README.md', '');

    expect(outcome).toEqual({ success: false, error: 'Invalid name' });
    expect(callsTo(WorkspaceChannel.ReadDirectory)).toHaveLength(before);
    expect(service.rows().map((row) => row.node.name)).toEqual(['src', 'README.md']);
  });

  it('mutation_whenTheDirectoryIsNotLoaded_doesNotReadIt', async () => {
    // Reconciling a directory the tree has never expanded would load a subtree the user never asked
    // for, and there is no node there to reconcile against.
    await service.openFolder();
    const before: number = callsTo(WorkspaceChannel.ReadDirectory).length;

    await service.createFile('/ws/src/app', 'new.ts');

    expect(callsTo(WorkspaceChannel.ReadDirectory)).toHaveLength(before);
  });

  it('delete_onAWindowsPath_derivesTheParentFromTheBackslash', async () => {
    // A Windows workspace's paths arrive back-slashed, while much of the app normalises to forward
    // slashes; splitting on whichever separator comes last handles both without a platform check.
    await service.openFolder();

    await service.delete('C:\\work\\ws\\README.md');

    expect(callsTo(WorkspaceChannel.Delete).map((c: BridgeCall) => c.args)).toEqual([
      ['C:\\work\\ws\\README.md'],
    ]);
  });

  it('mutation_outsideElectron_failsRatherThanThrowing', async () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const detached: Workspace = TestBed.inject(Workspace);

    const outcome: FileOperationResult = await detached.createFile('/ws', 'added.ts');

    expect(outcome.success).toBe(false);
    expect(outcome.error).toBe('Unavailable outside Electron');
  });
});
