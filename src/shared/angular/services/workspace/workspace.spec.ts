import { TestBed } from '@angular/core/testing';
import { DirectoryListing, OpenSelection, WorkspaceApi } from '@shared/studio-api';
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
  entries: [{ name: 'main.ts', path: '/ws/src/main.ts', type: 'file' }],
};

/**
 * Builds a fake workspace bridge backed by the canned listings above.
 */
function fakeBridge(): WorkspaceApi {
  return {
    open: (): Promise<OpenSelection | null> =>
      Promise.resolve({ kind: 'directory', directory: ROOT_LISTING }),
    openFile: (): Promise<OpenSelection | null> => Promise.resolve(null),
    openFolder: (): Promise<DirectoryListing | null> => Promise.resolve(ROOT_LISTING),
    closeFolder: (): Promise<void> => Promise.resolve(),
    readDirectory: (path: string): Promise<DirectoryListing | null> =>
      Promise.resolve(path === '/ws/src' ? SRC_LISTING : null),
    createFile: () => Promise.resolve({ success: true }),
    createFolder: () => Promise.resolve({ success: true }),
    rename: () => Promise.resolve({ success: true }),
    delete: () => Promise.resolve({ success: true }),
  };
}

describe('Workspace', () => {
  let service: Workspace;

  beforeEach(() => {
    (window as unknown as { studio: { workspace: WorkspaceApi } }).studio = {
      workspace: fakeBridge(),
    };
    TestBed.configureTestingModule({});
    service = TestBed.inject(Workspace);
  });

  afterEach(() => {
    delete (window as unknown as { studio?: unknown }).studio;
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
});
