import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Defines the preferences that must be known before the app is ready, and so cannot live in the
 * renderer's settings store (which is unreachable from the main process at startup, before any
 * window or its preload exists).
 */
export interface StartupPreferences {
  /**
   * Gets a value indicating whether GPU hardware acceleration is enabled. Applied via
   * {@link Electron.App.disableHardwareAcceleration}, which must be called before the app is ready,
   * so the choice can only take effect after a relaunch.
   */
  readonly hardwareAcceleration: boolean;
}

/**
 * Holds the startup preferences applied when none have been persisted.
 */
const DEFAULT_STARTUP_PREFERENCES: StartupPreferences = {
  hardwareAcceleration: true,
};

/**
 * Holds the file name the startup preferences are persisted under, within the app's user-data
 * directory.
 */
const FILE_NAME: string = 'startup-preferences.json';

/**
 * Represents a small synchronous JSON store for {@link StartupPreferences}, persisted in the app's
 * user-data directory.
 *
 * The main process reads these before the app is ready (so the file is read synchronously, never
 * blocking on a window that does not yet exist), and the renderer writes them through IPC. Every
 * failure path (absent file, malformed JSON, write error) degrades to the defaults rather than
 * throwing, so a corrupt preferences file can never prevent the app from launching.
 */
export class StartupPreferencesStore {
  /**
   * Reads the persisted startup preferences, merging them over the defaults.
   * @returns Returns the fully populated startup preferences.
   */
  public static read(): StartupPreferences {
    try {
      const raw: string = fs.readFileSync(StartupPreferencesStore.filePath(), 'utf-8');
      const parsed: Partial<StartupPreferences> = JSON.parse(raw) as Partial<StartupPreferences>;
      return { ...DEFAULT_STARTUP_PREFERENCES, ...parsed };
    } catch {
      return DEFAULT_STARTUP_PREFERENCES;
    }
  }

  /**
   * Persists the given startup preferences, silently ignoring write failures (persistence is
   * best-effort and must never crash the app).
   * @param preferences The startup preferences to persist.
   */
  public static write(preferences: StartupPreferences): void {
    try {
      fs.writeFileSync(StartupPreferencesStore.filePath(), JSON.stringify(preferences, null, 2));
    } catch {
      // The preferences directory is unavailable or read-only; the choice simply will not persist.
    }
  }

  /**
   * Gets the absolute path to the startup preferences file.
   * @returns Returns the absolute file path.
   */
  private static filePath(): string {
    return path.join(app.getPath('userData'), FILE_NAME);
  }
}
