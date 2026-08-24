import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseStoredWindowState, StoredWindowState } from './window-state';
import { WindowKind } from './window-registry';
import { logger } from './logger';

/**
 * Holds the file name the window states are persisted under, within the app's user-data directory.
 */
const FILE_NAME: string = 'window-state.json';

/**
 * Represents a small synchronous JSON store for per-kind {@link StoredWindowState}, persisted in the
 * app's user-data directory.
 *
 * Window bounds are read during window creation (before any renderer exists) and written from
 * window events, so the store is synchronous like {@link StartupPreferencesStore}. Every failure
 * path (absent file, malformed JSON, write error) degrades to null/no-op rather than throwing, so a
 * corrupt state file can never prevent a window from opening.
 */
export class WindowStateStore {
  /**
   * Reads the persisted state for a window kind.
   * @param kind The window kind to read.
   * @returns Returns the persisted state, or null when none is usable.
   */
  public static read(kind: WindowKind): StoredWindowState | null {
    logger.trace('WindowStateStore.read', `reading state for '${kind}'`);
    const state: StoredWindowState | null = parseStoredWindowState(
      WindowStateStore.readAll()[kind],
    );
    if (state === null) {
      logger.debug('WindowStateStore.read', `no usable persisted state for '${kind}'`);
    } else {
      logger.debug('WindowStateStore.read', `restored state for '${kind}'`, state);
    }
    return state;
  }

  /**
   * Persists the state for a window kind, preserving the other kinds' entries and silently ignoring
   * write failures (persistence is best-effort and must never crash the app).
   * @param kind The window kind to write.
   * @param state The state to persist.
   */
  public static write(kind: WindowKind, state: StoredWindowState): void {
    logger.trace('WindowStateStore.write', `persisting state for '${kind}'`, state);
    try {
      const all: Record<string, unknown> = WindowStateStore.readAll();
      all[kind] = state;
      fs.writeFileSync(WindowStateStore.filePath(), JSON.stringify(all, null, 2));
      logger.debug('WindowStateStore.write', `persisted state for '${kind}'`);
    } catch (error) {
      // The user-data directory is unavailable or read-only; the bounds simply will not persist.
      logger.error('WindowStateStore.write', `failed to persist state for '${kind}'`, error);
    }
  }

  /**
   * Reads the whole persisted record, degrading to an empty record on any failure.
   * @returns Returns the persisted record of states by window kind.
   */
  private static readAll(): Record<string, unknown> {
    try {
      const raw: string = fs.readFileSync(WindowStateStore.filePath(), 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      logger.warn('WindowStateStore.readAll', 'state file is not an object; ignoring');
      return {};
    } catch (error) {
      const nodeError: NodeJS.ErrnoException = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        logger.debug('WindowStateStore.readAll', 'no state file yet; starting empty');
      } else {
        logger.error('WindowStateStore.readAll', 'failed to read state file', error);
      }
      return {};
    }
  }

  /**
   * Gets the absolute path to the window-state file.
   * @returns Returns the absolute file path.
   */
  private static filePath(): string {
    return path.join(app.getPath('userData'), FILE_NAME);
  }
}
