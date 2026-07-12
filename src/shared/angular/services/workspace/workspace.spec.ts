import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { DirectoryListing, WorkspaceChannel } from '@shared/api/workspace-channels';
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
