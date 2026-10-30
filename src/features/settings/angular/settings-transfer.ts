import { inject, Service } from '@angular/core';
import type { FileInfo, FileWriteResult } from '@shared/api/file-channels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import type { SettingsOverrides } from '@shared/angular/services/settings/settings';
import { restoreOverrides } from '@shared/angular/services/settings/settings-migration';
import {
  SETTINGS_BY_KEY,
  SETTINGS_REGISTRY,
} from '@shared/angular/services/settings/settings-registry';
import { isSettingsOwned } from '@shared/angular/services/settings/settings-schema';
import type {
  ForeignSettingDef,
  SectionDef,
  SettingDef,
} from '@shared/angular/services/settings/settings-schema';
import { SettingBindings } from './setting-bindings';

/**
 * Names the file format, so an import can tell a settings export from any other JSON file.
 */
const SETTINGS_FILE_FORMAT: string = 'onixlabs-studio-settings';

/**
 * The version of the file format this build writes and reads.
 */
const SETTINGS_FILE_VERSION: number = 1;

/**
 * The setting recording which format the stored AI connections are in. The migration stamps it on
 * every import, and it travels with the rest so the migration is not re-run, but it is bookkeeping
 * rather than a setting: it is never counted as one the file sets.
 */
const CONNECTIONS_FORMAT_KEY: string = 'ai.connectionsFormat';

/**
 * The name the export's save dialog suggests.
 */
const DEFAULT_EXPORT_NAME: string = 'studio-settings.json';

/**
 * Describes a settings export file: a format marker, its version, when it was written, and the
 * settings it carries keyed by their stable setting keys.
 */
export interface SettingsFile {
  /**
   * Gets the format marker; always {@link SETTINGS_FILE_FORMAT}.
   */
  readonly format: string;

  /**
   * Gets the file format version.
   */
  readonly version: number;

  /**
   * Gets when the file was written, as an ISO 8601 timestamp.
   */
  readonly exportedAt: string;

  /**
   * Gets the settings the file carries, keyed by setting key.
   */
  readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * Describes a settings file that has been read and checked, ready to apply once the user has chosen
 * what happens to the settings it does not mention.
 */
export interface PendingSettingsImport {
  /**
   * Gets the name of the file being imported, for the question put to the user.
   */
  readonly fileName: string;

  /**
   * Gets the Settings-owned values to apply, migrated forward from the file's version.
   */
  readonly owned: SettingsOverrides;

  /**
   * Gets the values of settings other services own (theme, graphics, security), keyed by setting key.
   */
  readonly foreign: Readonly<Record<string, unknown>>;

  /**
   * Gets how many of the file's entries were skipped: unknown keys, or values of the wrong kind.
   */
  readonly skipped: number;
}

/**
 * Describes the outcome of reading a settings file: either an import ready to apply, or the reason
 * the file could not be used.
 */
export type SettingsFileRead =
  | { readonly ok: true; readonly pending: PendingSettingsImport }
  | { readonly ok: false; readonly error: string };

/**
 * Exports the user's settings to a JSON file and imports them back.
 *
 * An export carries only what the user changed from the defaults (so a file shared between machines
 * does not pin every default of the version that wrote it), plus the current value of every setting
 * another service owns — the theme, the accent, graphics acceleration — which have no default here
 * to compare against.
 *
 * ⛔ Sign-in details are not in the file. API keys and code-host tokens live encrypted in the main
 * process, and nothing here can read them; carrying them is a separate, deliberate step.
 *
 * An import checks every entry against the registry: a key Studio does not know, or a value of the
 * wrong kind for its setting, is skipped and counted rather than applied, so a hand-edited or newer
 * file cannot put a setting into a state its control cannot show.
 */
@Service()
export class SettingsTransfer {
  /**
   * Holds the settings store the Settings-owned values are read from and applied to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the binding resolver the values other services own are read and written through.
   */
  private readonly bindings: SettingBindings = inject(SettingBindings);

  /**
   * Holds the file system, for the save and open dialogs and the file itself.
   */
  private readonly files: FileSystem = inject(FileSystem);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Builds the export file for the current settings.
   * @returns Returns the file contents as an object.
   */
  public buildExport(): SettingsFile {
    const settings: Record<string, unknown> = { ...this.settings.changed() };
    for (const def of foreignSettings()) {
      settings[def.key] = this.bindings.resolve(def.key, def.owner).value();
    }
    return {
      format: SETTINGS_FILE_FORMAT,
      version: SETTINGS_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      settings,
    };
  }

  /**
   * Asks where to save, then writes the export there.
   * @returns Returns the path written, or null when the user cancelled or the write failed.
   */
  public async exportToFile(): Promise<string | null> {
    const path: string | null = await this.files.saveDialog(DEFAULT_EXPORT_NAME);
    if (path === null) {
      return null;
    }
    const content: string = `${JSON.stringify(this.buildExport(), null, 2)}\n`;
    const result: FileWriteResult = await this.files.write(path, content);
    if (!result.success) {
      this.log.warn('SettingsTransfer', 'Settings export failed', path);
      return null;
    }
    this.log.info('SettingsTransfer', 'Settings exported', path);
    return path;
  }

  /**
   * Asks for a settings file and reads it, without applying anything.
   * @returns Returns the checked import, an error, or null when the user cancelled.
   */
  public async readFromFile(): Promise<SettingsFileRead | null> {
    const path: string | null = await this.files.pickPath('file');
    if (path === null) {
      return null;
    }
    const file: FileInfo | null = await this.files.read(path);
    if (file === null) {
      return { ok: false, error: `${path} could not be read.` };
    }
    return this.parse(file.name, file.content);
  }

  /**
   * Checks a settings file's text, sorting its entries into those to apply and those to skip.
   * @param fileName The file's name.
   * @param text The file's text.
   * @returns Returns the checked import, or the reason the file cannot be used.
   */
  public parse(fileName: string, text: string): SettingsFileRead {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `${fileName} is not a settings file: it is not valid JSON.` };
    }
    if (!isSettingsFile(parsed)) {
      return { ok: false, error: `${fileName} is not a Studio settings export.` };
    }
    if (parsed.version > SETTINGS_FILE_VERSION) {
      return {
        ok: false,
        error: `${fileName} was written by a newer version of Studio. Update Studio to import it.`,
      };
    }

    // Settings an older version wrote under keys since retired (a print margin under Application)
    // are carried forward exactly as they would be from this machine's own stored settings.
    const migrated: SettingsOverrides = restoreOverrides(parsed.settings);
    const owned: Record<string, unknown> = {};
    const foreign: Record<string, unknown> = {};
    let skipped: number = 0;
    for (const [key, value] of Object.entries(migrated)) {
      const def: SettingDef | undefined = SETTINGS_BY_KEY.get(key);
      if (def === undefined || !acceptsValue(def, value)) {
        skipped += 1;
        continue;
      }
      if (isSettingsOwned(def)) {
        owned[key] = value;
      } else {
        foreign[key] = value;
      }
    }
    return { ok: true, pending: { fileName, owned, foreign, skipped } };
  }

  /**
   * Counts the settings a checked import sets, leaving out the bookkeeping that travels with them.
   * @param pending The checked import.
   * @returns Returns the number of settings the file sets.
   */
  public countOf(pending: PendingSettingsImport): number {
    return (
      Object.keys(pending.owned).filter((key: string): boolean => key !== CONNECTIONS_FORMAT_KEY)
        .length + Object.keys(pending.foreign).length
    );
  }

  /**
   * Applies a checked import.
   * @param pending The checked import.
   * @param replace Whether settings the file does not mention go back to their defaults. Settings other
   * services own have no default here, so those the file does not mention are left as they are.
   */
  public apply(pending: PendingSettingsImport, replace: boolean): void {
    this.settings.applyOverrides(pending.owned, replace);
    for (const [key, value] of Object.entries(pending.foreign)) {
      const def: SettingDef | undefined = SETTINGS_BY_KEY.get(key);
      this.bindings.resolve(key, def?.owner).set(value);
    }
    this.log.info('SettingsTransfer', 'Settings imported', {
      file: pending.fileName,
      owned: Object.keys(pending.owned).length,
      foreign: Object.keys(pending.foreign).length,
      skipped: pending.skipped,
      replace,
    });
  }
}

/**
 * Lists every registry setting another service owns.
 * @returns Returns the foreign-owned setting definitions.
 */
function foreignSettings(): readonly ForeignSettingDef[] {
  return SETTINGS_REGISTRY.flatMap(
    (section: SectionDef): readonly SettingDef[] => section.settings,
  ).filter((def: SettingDef): def is ForeignSettingDef => !isSettingsOwned(def));
}

/**
 * Determines whether a parsed value is a settings export of a known format.
 * @param value The parsed JSON.
 * @returns Returns true when the value is a settings file.
 */
function isSettingsFile(value: unknown): value is SettingsFile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const file: Record<string, unknown> = value as Record<string, unknown>;
  return (
    file['format'] === SETTINGS_FILE_FORMAT &&
    typeof file['version'] === 'number' &&
    typeof file['settings'] === 'object' &&
    file['settings'] !== null &&
    !Array.isArray(file['settings'])
  );
}

/**
 * Determines whether a value is one a setting can hold: one of its options for a choice, otherwise a
 * value of the same kind as its default. A foreign-owned setting with no options has no default to
 * compare against, and its owner validates what it is given.
 * @param def The setting definition.
 * @param value The value from the file.
 * @returns Returns true when the value can be applied.
 */
function acceptsValue(def: SettingDef, value: unknown): boolean {
  if (def.control.kind === 'select' || def.control.kind === 'buttonGroup') {
    const numeric: boolean = def.control.kind === 'select' && def.control.valueType === 'number';
    return (
      (numeric ? typeof value === 'number' : typeof value === 'string') &&
      def.control.options.some(
        (option: { readonly value: string }): boolean => option.value === String(value),
      )
    );
  }
  if (!isSettingsOwned(def)) {
    return value !== undefined;
  }
  const expected: unknown = def.default;
  if (Array.isArray(expected)) {
    return Array.isArray(value);
  }
  if (typeof expected === 'object' && expected !== null) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  return typeof value === typeof expected;
}
