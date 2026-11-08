import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileChangeType, FileEvent } from './lsp-file-watcher';

/**
 * The servers that read a compilation database, and must be restarted to read one that first appears
 * after they started (#1213). clangd looks for `compile_commands.json` beside each file it opens and in
 * a `build/` folder above it, and remembers for about half a minute that there was none. A file it
 * opened before CMake wrote one keeps its fallback flags, so its includes go unresolved: neither a
 * `didChangeWatchedFiles` nor an edit nor reopening the file changes that, until the memory lapses.
 */
const COMPILATION_DATABASE_SERVERS: ReadonlySet<string> = new Set<string>(['clangd']);

/**
 * The file a compilation database is read from.
 */
const COMPILATION_DATABASE: string = 'compile_commands.json';

/**
 * Determines whether a server reads a compilation database, and so whether one appearing restarts it.
 * @param serverId The server.
 * @returns Returns true when it does.
 */
export function readsCompilationDatabase(serverId: string): boolean {
  return COMPILATION_DATABASE_SERVERS.has(serverId);
}

/**
 * Determines whether a workspace has a compilation database where clangd finds one by itself: at its
 * root, or in its `build/` folder, which is where a CMake build writes it (#1330).
 * @param rootPath The workspace root.
 * @param exists Tells whether a path exists; overridable for tests.
 * @returns Returns true when it has one.
 */
export function hasCompilationDatabase(
  rootPath: string,
  exists: (candidate: string) => boolean = existsSync,
): boolean {
  return (
    exists(path.join(rootPath, COMPILATION_DATABASE)) ||
    exists(path.join(rootPath, 'build', COMPILATION_DATABASE))
  );
}

/**
 * Determines whether a batch of file events creates a compilation database anywhere under the root.
 * Only a creation counts: clangd reloads one it already read when it changes.
 * @param events The events, as the watcher reports them.
 * @returns Returns true when one was created.
 */
export function createsCompilationDatabase(events: readonly FileEvent[]): boolean {
  return events.some((event: FileEvent): boolean => {
    if (event.type !== FileChangeType.Created) {
      return false;
    }
    try {
      return path.basename(fileURLToPath(event.uri)) === COMPILATION_DATABASE;
    } catch {
      return false;
    }
  });
}
