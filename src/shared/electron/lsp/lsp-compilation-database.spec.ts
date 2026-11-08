import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createsCompilationDatabase,
  hasCompilationDatabase,
  readsCompilationDatabase,
} from './lsp-compilation-database';
import { FileChangeType, FileEvent } from './lsp-file-watcher';

/**
 * Builds a watcher event for a path.
 * @param file The absolute path.
 * @param type What happened to it.
 * @returns Returns the event.
 */
function event(file: string, type: FileChangeType): FileEvent {
  return { uri: pathToFileURL(file).href, type };
}

describe('lsp-compilation-database', () => {
  const root: string = path.resolve('/work/cpp');

  it('readsCompilationDatabase_isClangdOnly', () => {
    expect(readsCompilationDatabase('clangd')).toBe(true);
    expect(readsCompilationDatabase('rust')).toBe(false);
    expect(readsCompilationDatabase('typescript')).toBe(false);
  });

  it('hasCompilationDatabase_looksAtTheRoot_andItsBuildFolder', () => {
    const at: (present: readonly string[]) => boolean = (present: readonly string[]): boolean =>
      hasCompilationDatabase(root, (candidate: string): boolean => present.includes(candidate));

    expect(at([])).toBe(false);
    expect(at([path.join(root, 'compile_commands.json')])).toBe(true);
    expect(at([path.join(root, 'build', 'compile_commands.json')])).toBe(true);
    // Somewhere clangd does not look by itself is not counted: arguments name such a folder.
    expect(at([path.join(root, 'out', 'compile_commands.json')])).toBe(false);
  });

  it('createsCompilationDatabase_countsOnlyACreation_atAnyDepth', () => {
    const database: string = path.join(root, 'cmake-build-debug', 'compile_commands.json');

    expect(createsCompilationDatabase([event(database, FileChangeType.Created)])).toBe(true);
    expect(createsCompilationDatabase([event(database, FileChangeType.Changed)])).toBe(false);
    expect(createsCompilationDatabase([event(database, FileChangeType.Deleted)])).toBe(false);
    expect(
      createsCompilationDatabase([
        event(path.join(root, 'compile_commands.json.tmp'), FileChangeType.Created),
        event(path.join(root, 'src', 'main.cpp'), FileChangeType.Created),
      ]),
    ).toBe(false);
    expect(createsCompilationDatabase([{ uri: 'not a uri', type: FileChangeType.Created }])).toBe(
      false,
    );
  });
});
