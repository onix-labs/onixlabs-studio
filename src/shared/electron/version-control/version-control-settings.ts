import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  VERSION_CONTROL_EXECUTABLE_MODES,
  VersionControlExecutableChoice,
  VersionControlExecutableMode,
} from '@shared/api/version-control-protocol';
import { logger } from '../logger';

/**
 * Holds which tool each version-control plugin runs, as the user chose in Settings (#817).
 *
 * Kept in the main process, in a small file under the user-data directory, because the host needs it
 * when it starts a plugin — which happens in main, often before the renderer has asked anything. The
 * renderer reads and writes it only through the source-control channels.
 */
export class VersionControlSettings {
  /**
   * Holds the file the choices are persisted to.
   */
  private readonly file: string;

  /**
   * Holds the choices, keyed by plugin id.
   */
  private readonly choices: Map<string, VersionControlExecutableChoice>;

  /**
   * Initializes the store, reading what was saved.
   * @param file The file the choices are persisted to.
   */
  public constructor(file: string) {
    this.file = file;
    this.choices = load(file);
  }

  /**
   * Gets the tool a plugin runs.
   * @param pluginId The plugin.
   * @returns Returns the choice, or null for the plugin's default.
   */
  public executableFor(pluginId: string): VersionControlExecutableChoice | null {
    return this.choices.get(pluginId) ?? null;
  }

  /**
   * Sets the tool a plugin runs, persisting it.
   * @param pluginId The plugin.
   * @param choice The choice, or null to return to the plugin's default.
   */
  public setExecutable(pluginId: string, choice: VersionControlExecutableChoice | null): void {
    if (choice === null) {
      this.choices.delete(pluginId);
    } else {
      this.choices.set(pluginId, choice);
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(
        this.file,
        JSON.stringify(Object.fromEntries(this.choices), null, 2),
        'utf8',
      );
    } catch (error: unknown) {
      logger.warn('VersionControlSettings', 'Could not save the version-control settings', error);
    }
  }
}

/**
 * Narrows an untrusted value to an executable choice: a known mode, and an absolute path when the mode
 * is `custom`.
 * @param value The candidate.
 * @returns Returns the choice, or null when the value is not one.
 */
export function readExecutableChoice(value: unknown): VersionControlExecutableChoice | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const mode: unknown = record['mode'];
  const target: unknown = record['path'];
  if (
    typeof mode !== 'string' ||
    !(VERSION_CONTROL_EXECUTABLE_MODES as readonly string[]).includes(mode)
  ) {
    return null;
  }
  if (mode === 'custom') {
    return typeof target === 'string' && path.isAbsolute(target)
      ? { mode: 'custom', path: target }
      : null;
  }
  return { mode: mode as VersionControlExecutableMode, path: '' };
}

/**
 * Reads the saved choices, ignoring a missing or malformed file and any malformed entry.
 * @param file The file.
 * @returns Returns the choices by plugin id.
 */
function load(file: string): Map<string, VersionControlExecutableChoice> {
  const choices: Map<string, VersionControlExecutableChoice> = new Map<
    string,
    VersionControlExecutableChoice
  >();
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw === 'object' && raw !== null) {
      for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        const choice: VersionControlExecutableChoice | null = readExecutableChoice(value);
        if (choice !== null) {
          choices.set(id, choice);
        }
      }
    }
  } catch {
    // No file yet, or one that cannot be read: every plugin runs its default.
  }
  return choices;
}
