import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The main process's source folder.
 */
// From the repository root, as Studio's other source scans are: under coverage the spec runs from a
// bundle, where `__dirname` is not the source folder.
const ELECTRON: string = path.join(process.cwd(), 'src', 'shared', 'electron');

/**
 * The one file allowed to start a program.
 */
const LAUNCHER: string = path.join(ELECTRON, 'process', 'launch.ts');

/**
 * Matches an import, or a require, of a module that starts programs. An import's clause cannot hold a
 * semicolon, which keeps a match from running back into the import before it.
 */
const STARTS_PROGRAMS: RegExp =
  /import\s+([^;]*?)\s+from\s+['"](?:node:)?(?:child_process|node-pty)['"]|require\(\s*['"](?:node:)?(?:child_process|node-pty)['"]\s*\)/g;

/**
 * Lists every main-process source file, specs aside.
 * @param directory The folder to walk.
 * @returns Returns the files' absolute paths.
 */
function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sources(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Determines whether an import brings in only types, which cannot start anything.
 * @param clause What the import brings in: `type { X }`, `{ type X, type Y }`, `* as name`, `{ spawn }`.
 * @returns Returns true when it is types alone.
 */
function typesOnly(clause: string): boolean {
  const trimmed: string = clause.trim();
  if (trimmed.startsWith('type ')) {
    return true;
  }
  const named: RegExpExecArray | null = /^\{([\s\S]*)\}$/.exec(trimmed);
  if (named === null) {
    return false;
  }
  return named[1]
    .split(',')
    .map((part: string): string => part.trim())
    .filter((part: string): boolean => part.length > 0)
    .every((part: string): boolean => part.startsWith('type '));
}

describe('the run token is the only way to start a program (#1504)', () => {
  it('noFileButTheLauncher_startsAProgram', () => {
    // Matthew's railway token: every stretch of line goes through the one signal box. A new feature
    // that starts a program must take a run token for a folder, or name why it is Studio's own.
    const offenders: string[] = [];
    for (const file of sources(ELECTRON)) {
      if (file === LAUNCHER) {
        continue;
      }
      const text: string = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(STARTS_PROGRAMS)) {
        if (match[1] === undefined || !typesOnly(match[1])) {
          offenders.push(path.relative(ELECTRON, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('theLauncherItself_isFound', () => {
    // A patrol that walks no line catches nothing: make sure it is looking where the launcher is.
    expect(sources(ELECTRON)).toContain(LAUNCHER);
    expect(fs.readFileSync(LAUNCHER, 'utf8')).toMatch(STARTS_PROGRAMS);
  });
});
