import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Documents } from '@shared/angular/services/documents/documents';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { WorkspaceTerminalPathLinks } from './workspace-terminal-path-links';

/**
 * The directories the fake workspace can list; any other is outside it.
 */
const LISTINGS: Readonly<Record<string, DirectoryListing>> = {
  '/ws': {
    path: '/ws',
    name: 'ws',
    entries: [
      { name: 'src', path: '/ws/src', type: 'directory' },
      { name: 'README.md', path: '/ws/README.md', type: 'file' },
    ],
  },
  '/ws/src': {
    path: '/ws/src',
    name: 'src',
    entries: [{ name: 'main.ts', path: '/ws/src/main.ts', type: 'file' }],
  },
};

describe('WorkspaceTerminalPathLinks', () => {
  let links: WorkspaceTerminalPathLinks;
  let readDirectoryListing: ReturnType<typeof vi.fn>;
  let openPath: ReturnType<typeof vi.fn>;
  let requestReveal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    readDirectoryListing = vi.fn((path: string): Promise<DirectoryListing | null> =>
      Promise.resolve(LISTINGS[path] ?? null),
    );
    openPath = vi.fn((): Promise<boolean> => Promise.resolve(true));
    requestReveal = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        WorkspaceTerminalPathLinks,
        {
          provide: Workspace,
          useValue: {
            root: signal<DirectoryListing | null>(LISTINGS['/ws']),
            readDirectoryListing,
          },
        },
        { provide: FileOpener, useValue: { openPath } },
        {
          provide: Documents,
          useValue: {
            findIdByPath: (path: string): string | undefined =>
              path === '/ws/src/main.ts' ? 'doc-1' : undefined,
          },
        },
        { provide: Editors, useValue: { requestReveal } },
      ],
    });
    links = TestBed.inject(WorkspaceTerminalPathLinks);
  });

  it('resolve_withAFileInTheWorkingDirectory_returnsItsPath', async () => {
    expect(await links.resolve('src/main.ts', '/ws')).toBe('/ws/src/main.ts');
    expect(await links.resolve('./main.ts', '/ws/src')).toBe('/ws/src/main.ts');
  });

  it('resolve_withoutAWorkingDirectory_resolvesAgainstTheRoot', async () => {
    expect(await links.resolve('README.md', null)).toBe('/ws/README.md');
  });

  it('resolve_withAMissingFileOrADirectory_returnsNull', async () => {
    expect(await links.resolve('src/gone.ts', '/ws')).toBeNull();
    expect(await links.resolve('/ws/src', null)).toBeNull();
  });

  it('resolve_outsideTheWorkspace_returnsNull', async () => {
    expect(await links.resolve('/etc/hosts.txt', '/ws')).toBeNull();
  });

  it('resolve_inTheSameDirectoryTwice_readsItOnce', async () => {
    await links.resolve('src/main.ts', '/ws');
    await links.resolve('src/other.ts', '/ws');
    expect(readDirectoryListing).toHaveBeenCalledTimes(1);
  });

  it('open_withALine_opensTheFileAndRevealsTheLine', async () => {
    await links.open('/ws/src/main.ts', 42, 7);
    expect(openPath).toHaveBeenCalledWith('/ws/src/main.ts');
    expect(requestReveal).toHaveBeenCalledWith('doc-1', 42, 7);
  });

  it('open_withALineAndNoColumn_revealsTheStartOfTheLine', async () => {
    await links.open('/ws/src/main.ts', 42, null);
    expect(requestReveal).toHaveBeenCalledWith('doc-1', 42, 1);
  });

  it('open_withoutALine_onlyOpensTheFile', async () => {
    await links.open('/ws/src/main.ts', null, null);
    expect(openPath).toHaveBeenCalled();
    expect(requestReveal).not.toHaveBeenCalled();
  });
});
