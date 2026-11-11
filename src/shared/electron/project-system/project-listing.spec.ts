import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectItemNode } from '@shared/api/project-system';
import { listProjectFiles, sourceFilter } from './project-listing';

/**
 * Writes files under a root, creating their folders.
 * @param root The root.
 * @param files The relative paths to create.
 */
function write(root: string, files: readonly string[]): void {
  for (const file of files) {
    const full: string = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
  }
}

/**
 * Renders a listing as relative paths, folders marked with a trailing slash, in listing order.
 * @param nodes The listing.
 * @param root The root the paths are relative to.
 * @returns Returns the paths.
 */
function paths(nodes: readonly ProjectItemNode[] | null, root: string): readonly string[] {
  return (nodes ?? []).flatMap((node: ProjectItemNode): readonly string[] =>
    node.type === 'file'
      ? [path.relative(root, node.path)]
      : [`${path.relative(root, node.path ?? '')}/`, ...paths(node.children, root)],
  );
}

describe('listProjectFiles', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-listing-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists folders before files, each by name, and drops folders left empty', async () => {
    write(root, ['b.go', 'a.go', 'pkg/z.go', 'pkg/y.go', 'empty/notes.txt']);

    const listed: readonly ProjectItemNode[] | null = await listProjectFiles(
      root,
      { remaining: 100 },
      { skipDirectory: (): boolean => false, keepFile: sourceFilter(['.go'], []) },
    );

    // `empty` holds only a file the filter drops, so the folder goes too.
    expect(paths(listed, root)).toEqual(['pkg/', 'pkg/y.go', 'pkg/z.go', 'a.go', 'b.go']);
  });

  it('keepsEveryFile_withNoFilter_asADeclaredSourceFolderDoes', async () => {
    write(root, ['main.go', 'README.md', 'assets/logo.png']);

    const listed: readonly ProjectItemNode[] | null = await listProjectFiles(
      root,
      { remaining: 100 },
      { skipDirectory: (): boolean => false },
    );

    expect(paths(listed, root)).toEqual(['assets/', 'assets/logo.png', 'main.go', 'README.md']);
  });

  it('skipsTheFoldersTheEcosystemNames_andEverythingUnderThem', async () => {
    write(root, ['main.go', 'vendor/dep/dep.go', 'node_modules/x/index.js']);

    const listed: readonly ProjectItemNode[] | null = await listProjectFiles(
      root,
      { remaining: 100 },
      { skipDirectory: (name: string): boolean => name === 'vendor' || name === 'node_modules' },
    );

    expect(paths(listed, root)).toEqual(['main.go']);
  });

  it('stopsAddingFilesOnceTheSharedBudgetIsSpent', async () => {
    // The bug #899 follows from: an output folder sorting first spent the budget before the sources.
    write(root, ['out/1.o', 'out/2.o', 'out/3.o', 'src/main.c']);
    const budget: { remaining: number } = { remaining: 2 };

    const listed: readonly ProjectItemNode[] | null = await listProjectFiles(root, budget, {
      skipDirectory: (): boolean => false,
    });

    expect(paths(listed, root)).toEqual(['out/', 'out/1.o', 'out/2.o']);
    expect(budget.remaining).toBe(0);
  });

  it('keepsTheSourcesWithinBudget_whenTheFilterDropsTheOutputs', async () => {
    write(root, ['out/1.o', 'out/2.o', 'out/3.o', 'src/main.c']);

    const listed: readonly ProjectItemNode[] | null = await listProjectFiles(
      root,
      { remaining: 2 },
      { skipDirectory: (): boolean => false, keepFile: sourceFilter(['.c'], []) },
    );

    expect(paths(listed, root)).toEqual(['src/', 'src/main.c']);
  });

  it('leavesOutASeparateProject_askingWithTheDepthOfTheFolderBeingListed', async () => {
    write(root, [
      'package.json',
      'index.js',
      'lib/a.js',
      'lib/inner/package.json',
      'lib/inner/b.js',
    ]);
    const asked: string[] = [];

    const listed: readonly ProjectItemNode[] | null = await listProjectFiles(
      root,
      { remaining: 100 },
      {
        skipDirectory: (): boolean => false,
        isSeparate: (directory: string, depth: number): Promise<boolean> => {
          asked.push(`${path.relative(root, directory)}@${depth}`);
          return Promise.resolve(fs.existsSync(path.join(directory, 'package.json')));
        },
      },
    );

    expect(paths(listed, root)).toEqual(['lib/', 'lib/a.js', 'index.js', 'package.json']);
    expect(asked).toEqual(['lib@0', 'lib/inner@1']);
  });

  it('answersNull_forADirectoryItCannotRead', async () => {
    expect(
      await listProjectFiles(
        path.join(root, 'missing'),
        { remaining: 100 },
        { skipDirectory: (): boolean => false },
      ),
    ).toBeNull();
  });
});

describe('sourceFilter', () => {
  it('keepsAnExtensionRegardlessOfCase_andAnExactName_andNothingElse', () => {
    const keep: (name: string) => boolean = sourceFilter(['.go', '.s'], ['go.mod']);

    expect(keep('main.go')).toBe(true);
    expect(keep('ASM.S')).toBe(true);
    expect(keep('go.mod')).toBe(true);
    expect(keep('Go.mod')).toBe(false);
    expect(keep('README.md')).toBe(false);
    expect(keep('go')).toBe(false);
  });
});
