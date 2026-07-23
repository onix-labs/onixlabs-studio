import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseStoredWindowState, StoredWindowState } from './window-state';
import { WindowKind } from './window-registry';

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
    return parseStoredWindowState(WindowStateStore.readAll()[kind]);
  }

  /**
   * Persists the state for a window kind, preserving the other kinds' entries and silently ignoring
   * write failures (persistence is best-effort and must never crash the app).
   * @param kind The window kind to write.
   * @param state The state to persist.
   */
  public static write(kind: WindowKind, state: StoredWindowState): void {
    try {
      const all: Record<string, unknown> = WindowStateStore.readAll();
      all[kind] = state;
      fs.writeFileSync(WindowStateStore.filePath(), JSON.stringify(all, null, 2));
    } catch {
      // The user-data directory is unavailable or read-only; the bounds simply will not persist.
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
      return {};
    } catch {
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
