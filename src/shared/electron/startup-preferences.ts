import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GraphicsAcceleration } from '@shared/api/host';
import { LOG_LEVEL_SETTINGS, LogLevelSetting } from '@shared/api/log-channels';
import { logger } from './logger';

/**
 * Defines the preferences that must be known before the app is ready, and so cannot live in the
 * renderer's settings store (which is unreachable from the main process at startup, before any
 * window or its preload exists).
 */
export interface StartupPreferences {
  /**
   * Gets the graphics-acceleration level, or null when none has been persisted. Its `off` rung is
   * applied via {@link Electron.App.disableHardwareAcceleration}, which must be called before the app
   * is ready, which is why the level lives here rather than in the renderer's settings store: the
   * whole ladder is kept in one place, and the rung that must be known first is readable first.
   *
   * Null is reported to the renderer as "not yet persisted", which is its cue to migrate the
   * pre-merge settings (see `display-policy.ts`) and write the result back.
   */
  readonly graphicsAcceleration: GraphicsAcceleration | null;

  /**
   * Gets the log-level choice, or null when none has been persisted. It lives here because the main
   * process's logger has to apply it before any window exists, and records a great deal before one
   * does.
   */
  readonly logLevel: LogLevelSetting | null;
}

/**
 * Describes the shape of the preferences file as written before the graphics-acceleration settings
 * were merged, so an existing installation is read rather than silently reset.
 *
 * MIGRATION SHIM. `hardwareAcceleration: false` carries enough to fix the level at `off`; `true` is
 * ambiguous (it could mean either of the two accelerated rungs) and resolves to null, leaving the
 * renderer to finish the migration from its own store. Delete alongside the rest of the shim.
 */
interface LegacyStartupPreferences {
  /**
   * Gets the pre-merge hardware-acceleration preference.
   */
  readonly hardwareAcceleration?: unknown;
}

/**
 * Holds the startup preferences applied when none have been persisted.
 */
const DEFAULT_STARTUP_PREFERENCES: StartupPreferences = {
  graphicsAcceleration: null,
  logLevel: null,
};

/**
 * Holds the graphics-acceleration levels accepted from the persisted file, so a hand-edited or
 * corrupt value degrades to the default rather than reaching the rest of the app.
 */
const GRAPHICS_ACCELERATION_LEVELS: readonly string[] = ['auto', 'off', 'limited', 'full'];

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
      const parsed: Partial<StartupPreferences> & LegacyStartupPreferences = JSON.parse(
        raw,
      ) as Partial<StartupPreferences> & LegacyStartupPreferences;
      const preferences: StartupPreferences = {
        graphicsAcceleration: StartupPreferencesStore.level(parsed),
        logLevel: StartupPreferencesStore.logLevel(parsed),
      };
      logger.debug(
        'StartupPreferences',
        `Read startup preferences (graphicsAcceleration: ${preferences.graphicsAcceleration ?? 'unset'}, logLevel: ${preferences.logLevel ?? 'unset'})`,
      );
      return preferences;
    } catch (error: unknown) {
      logger.debug('StartupPreferences', 'No readable startup preferences; using defaults', error);
      return DEFAULT_STARTUP_PREFERENCES;
    }
  }

  /**
   * Extracts the graphics-acceleration level from a parsed preferences file, validating the merged
   * key and falling back to the pre-merge one.
   * @param parsed The parsed preferences file.
   * @returns Returns the level, or null when the file names none this process can trust.
   */
  private static level(
    parsed: Partial<StartupPreferences> & LegacyStartupPreferences,
  ): GraphicsAcceleration | null {
    const level: unknown = parsed.graphicsAcceleration;
    if (typeof level === 'string' && GRAPHICS_ACCELERATION_LEVELS.includes(level)) {
      return level as GraphicsAcceleration;
    }
    // MIGRATION SHIM: only the disabled case is unambiguous; see LegacyStartupPreferences.
    return parsed.hardwareAcceleration === false ? 'off' : null;
  }

  /**
   * Extracts the log-level choice from a parsed preferences file.
   * @param parsed The parsed preferences file.
   * @returns Returns the choice, or null when the file names none this process can trust.
   */
  private static logLevel(parsed: Partial<StartupPreferences>): LogLevelSetting | null {
    const level: unknown = parsed.logLevel;
    return typeof level === 'string' && LOG_LEVEL_SETTINGS.includes(level as LogLevelSetting)
      ? (level as LogLevelSetting)
      : null;
  }

  /**
   * Persists changes to the startup preferences, merged over what is already persisted so writing one
   * preference never resets another. Write failures are silently ignored (persistence is best-effort
   * and must never crash the app).
   * @param changes The preferences to change.
   */
  public static write(changes: Partial<StartupPreferences>): void {
    const preferences: StartupPreferences = { ...StartupPreferencesStore.read(), ...changes };
    try {
      fs.writeFileSync(StartupPreferencesStore.filePath(), JSON.stringify(preferences, null, 2));
      logger.debug('StartupPreferences', 'Persisted startup preferences');
    } catch (error: unknown) {
      // The preferences directory is unavailable or read-only; the choice simply will not persist.
      logger.warn('StartupPreferences', 'Failed to persist startup preferences', error);
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
