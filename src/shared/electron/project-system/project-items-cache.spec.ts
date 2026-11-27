import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { ProjectItems } from '@shared/api/project-system';
import { PROJECT_ITEMS_CACHE_VERSION, ProjectItemsCache } from './project-items-cache';

describe('ProjectItemsCache (#1601)', () => {
  const root: string = path.resolve('/w/app');
  let directory: string;

  /**
   * Builds a project's contents with one file.
   * @param name The project's name.
   * @param file The file it lists.
   * @returns Returns the contents.
   */
  function itemsOf(name: string, file: string = 'Program.cs'): ProjectItems {
    const projectPath: string = path.join(root, name, `${name}.csproj`);
    return {
      projectPath,
      tree: [
        { type: 'file', name: file, path: path.join(root, name, file) },
        { type: 'folder', name: 'Linked', path: null, children: [] },
      ],
    };
  }

  /**
   * Gets the cache's only file.
   * @returns Returns its path.
   */
  function onlyFile(): string {
    const names: string[] = readdirSync(directory);
    expect(names).toHaveLength(1);
    return path.join(directory, names[0]);
  }

  /**
   * Gets a folder's only `.json` file.
   * @param folder The folder.
   * @returns Returns its path.
   */
  function onlyFileOf(folder: string): string {
    const names: string[] = readdirSync(folder).filter((name: string): boolean =>
      name.endsWith('.json'),
    );
    expect(names).toHaveLength(1);
    return path.join(folder, names[0]);
  }

  beforeEach(() => {
    directory = path.join(mkdtempSync(path.join(tmpdir(), 'studio-items-cache-')), 'cache');
  });

  afterEach(() => {
    rmSync(path.dirname(directory), { recursive: true, force: true });
  });

  it('readsBackWhatWasRemembered_inALaterSession', async () => {
    const earlier: ProjectItemsCache = new ProjectItemsCache(directory);
    earlier.remember(root, itemsOf('A'));
    earlier.remember(root, itemsOf('B'));
    earlier.flushSync();

    const later: ReadonlyMap<string, ProjectItems> = await new ProjectItemsCache(directory).read(
      root,
    );

    expect([...later.values()]).toEqual([itemsOf('A'), itemsOf('B')]);
  });

  it('keepsOnlyTheNewestContents_forAProject', async () => {
    const cache: ProjectItemsCache = new ProjectItemsCache(directory);
    cache.remember(root, itemsOf('A', 'Old.cs'));
    cache.remember(root, itemsOf('A', 'New.cs'));
    cache.flushSync();

    expect([...(await new ProjectItemsCache(directory).read(root)).values()]).toEqual([
      itemsOf('A', 'New.cs'),
    ]);
  });

  it('writesOnce_aShortWhileAfterTheLastChange', async () => {
    vi.useFakeTimers();
    try {
      const cache: ProjectItemsCache = new ProjectItemsCache(directory);
      cache.remember(root, itemsOf('A'));
      await vi.advanceTimersByTimeAsync(1_000);
      cache.remember(root, itemsOf('B'));
      await vi.advanceTimersByTimeAsync(1_000);

      expect(() => readdirSync(directory)).toThrow();

      await vi.advanceTimersByTimeAsync(1_500);
      vi.useRealTimers();
      await vi.waitFor(() => expect(readdirSync(directory)).toHaveLength(1));
    } finally {
      vi.useRealTimers();
    }

    expect((await new ProjectItemsCache(directory).read(root)).size).toBe(2);
  });

  it('namesItsFileWithoutSpellingOutTheRoot', () => {
    const cache: ProjectItemsCache = new ProjectItemsCache(directory);
    cache.remember(root, itemsOf('A'));
    cache.flushSync();

    expect(path.basename(onlyFile())).toMatch(/^[0-9a-f]{32}\.json$/);
  });

  it('dropsProjectsTheRootNoLongerHas', async () => {
    const cache: ProjectItemsCache = new ProjectItemsCache(directory);
    cache.remember(root, itemsOf('A'));
    cache.remember(root, itemsOf('B'));
    cache.retain(root, [itemsOf('B').projectPath]);
    cache.flushSync();

    expect([...(await new ProjectItemsCache(directory).read(root)).keys()]).toEqual([
      itemsOf('B').projectPath,
    ]);
  });

  it('forgetsAProject', async () => {
    const cache: ProjectItemsCache = new ProjectItemsCache(directory);
    cache.remember(root, itemsOf('A'));
    cache.remember(root, itemsOf('B'));
    cache.forget(root, itemsOf('A').projectPath);
    cache.flushSync();

    expect([...(await new ProjectItemsCache(directory).read(root)).keys()]).toEqual([
      itemsOf('B').projectPath,
    ]);
  });

  it.each<[string, (cache: ProjectItemsCache) => void]>([
    ['remembers', (cache: ProjectItemsCache): void => cache.remember(root, itemsOf('B'))],
    ['retains', (cache: ProjectItemsCache): void => cache.retain(root, [itemsOf('A').projectPath])],
  ])(
    'keepsWhatTheFileHeld_whenItFirst_%s_beforeReading',
    async (_name: string, act: (cache: ProjectItemsCache) => void) => {
      const earlier: ProjectItemsCache = new ProjectItemsCache(directory);
      earlier.remember(root, itemsOf('A'));
      earlier.flushSync();

      const later: ProjectItemsCache = new ProjectItemsCache(directory);
      act(later);
      await vi.waitFor(async () =>
        expect((await later.read(root)).has(itemsOf('A').projectPath)).toBe(true),
      );
      later.flushSync();

      expect(
        (await new ProjectItemsCache(directory).read(root)).has(itemsOf('A').projectPath),
      ).toBe(true);
    },
  );

  it('release_writesWhatIsPending_andLetsTheRootGo', async () => {
    const cache: ProjectItemsCache = new ProjectItemsCache(directory);
    cache.remember(root, itemsOf('A'));

    cache.release(root);

    await vi.waitFor(() =>
      expect(readdirSync(directory).filter((n: string) => n.endsWith('.json'))).toHaveLength(1),
    );
    expect([...(await cache.read(root)).values()]).toEqual([itemsOf('A')]);
  });

  describe('a file it cannot trust', () => {
    /**
     * Writes a cache file, then rewrites it through a change.
     * @param change Changes the file's parsed content.
     * @returns Returns what a later session reads.
     */
    async function readAfter(
      change: (content: Record<string, unknown>) => unknown,
    ): Promise<ReadonlyMap<string, ProjectItems>> {
      const cache: ProjectItemsCache = new ProjectItemsCache(directory);
      cache.remember(root, itemsOf('A'));
      cache.flushSync();
      const file: string = onlyFile();
      const content: Record<string, unknown> = JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        unknown
      >;
      writeFileSync(file, JSON.stringify(change(content)));
      return new ProjectItemsCache(directory).read(root);
    }

    it('isIgnored_whenWrittenInAnotherVersion', async () => {
      const read: ReadonlyMap<string, ProjectItems> = await readAfter(
        (content: Record<string, unknown>) => ({
          ...content,
          version: PROJECT_ITEMS_CACHE_VERSION + 1,
        }),
      );

      expect(read.size).toBe(0);
    });

    it('isIgnored_whenItBelongsToAnotherRoot', async () => {
      const read: ReadonlyMap<string, ProjectItems> = await readAfter(
        (content: Record<string, unknown>) => ({ ...content, root: path.resolve('/elsewhere') }),
      );

      expect(read.size).toBe(0);
    });

    it.each<[string, (content: Record<string, unknown>) => unknown]>([
      ['aString', (): string => 'not a cache'],
      ['null', (): null => null],
      [
        'projectsMissing',
        (content: Record<string, unknown>): Record<string, unknown> => ({
          ...content,
          projects: null,
        }),
      ],
    ])('isEmpty_for_%s', async (_name: string, change: (c: Record<string, unknown>) => unknown) => {
      expect((await readAfter(change)).size).toBe(0);
    });

    it('dropsEntriesThatAreMalformed_orForAProjectOutsideTheRoot', async () => {
      const good: ProjectItems = itemsOf('A');
      const outside: string = path.resolve('/elsewhere/X/X.csproj');
      const read: ReadonlyMap<string, ProjectItems> = await readAfter(
        (content: Record<string, unknown>) => ({
          ...content,
          projects: {
            [good.projectPath]: good,
            [outside]: { projectPath: outside, tree: [] },
            [path.join(root, 'B', 'B.csproj')]: { projectPath: 'mismatch', tree: [] },
            [path.join(root, 'C', 'C.csproj')]: {
              projectPath: path.join(root, 'C', 'C.csproj'),
              tree: [{ type: 'file', name: 'a.cs' }],
            },
            [path.join(root, 'D', 'D.csproj')]: {
              projectPath: path.join(root, 'D', 'D.csproj'),
              tree: [{ type: 'folder', name: 'x', path: null, children: [{ type: 'disk' }] }],
            },
          },
        }),
      );

      expect([...read.keys()]).toEqual([good.projectPath]);
    });
  });

  it('isEmpty_whenTheFileIsNotJson', async () => {
    const cache: ProjectItemsCache = new ProjectItemsCache(directory);
    cache.remember(root, itemsOf('A'));
    cache.flushSync();
    writeFileSync(onlyFile(), '{');

    expect((await new ProjectItemsCache(directory).read(root)).size).toBe(0);
  });

  it('removesNothing_andIsEmpty_whenNothingWasEverWritten', async () => {
    const cache: ProjectItemsCache = new ProjectItemsCache(directory);

    await cache.prune();

    expect((await cache.read(root)).size).toBe(0);
  });

  it('prune_removesTemporaryFilesAQuitLeftBehind', async () => {
    const cache: ProjectItemsCache = new ProjectItemsCache(directory);
    cache.remember(root, itemsOf('A'));
    cache.flushSync();
    const stray: string = `${onlyFile()}.123.1.tmp`;
    const fresh: string = `${onlyFile()}.456.1.tmp`;
    writeFileSync(stray, '{');
    writeFileSync(fresh, '{');
    const now: number = Date.now();
    const anHourAgo: Date = new Date(now - 2 * 60 * 60 * 1000);
    utimesSync(stray, anHourAgo, anHourAgo);

    await cache.prune(now);

    expect(readdirSync(directory).sort()).toEqual(
      [path.basename(onlyFileOf(directory)), path.basename(fresh)].sort(),
    );
  });

  it('prune_removesRootsNotWrittenForMonths', async () => {
    const cache: ProjectItemsCache = new ProjectItemsCache(directory);
    cache.remember(root, itemsOf('A'));
    cache.remember(path.resolve('/w/old'), {
      projectPath: path.resolve('/w/old/O/O.csproj'),
      tree: [],
    });
    cache.flushSync();
    const files: string[] = readdirSync(directory).map((name: string): string =>
      path.join(directory, name),
    );
    const now: number = Date.now();
    const old: string = files.find(
      (file: string): boolean => !readFileSync(file, 'utf8').includes('A.csproj'),
    )!;
    const longAgo: Date = new Date(now - 100 * 24 * 60 * 60 * 1000);
    utimesSync(old, longAgo, longAgo);

    await cache.prune(now);

    expect(readdirSync(directory)).toHaveLength(1);
    expect(readFileSync(onlyFile(), 'utf8')).toContain('A.csproj');
  });
});
