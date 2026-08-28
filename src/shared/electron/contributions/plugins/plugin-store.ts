import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { logger } from '../../logger';

/**
 * Records one plugin Studio installed: what it is and where its installation landed, so an uninstall
 * can remove exactly what an install put there rather than guessing at a path.
 */
export interface PluginInstallRecord {
  /**
   * Gets the plugin identifier.
   */
  readonly id: string;

  /**
   * Gets the version that was installed.
   */
  readonly version: string;

  /**
   * Gets the absolute path the installation produced (the provisioned executable or entry point).
   */
  readonly installedPath: string;
}

/**
 * Persists which plugins Studio has installed, in the user-data directory.
 *
 * This is the *installed set* — the middle layer of the plugin model, and the thing the slot registries
 * are populated from. It records only what Studio installed itself: a built-in needs no record (it
 * ships with the application) and an external tool needs none either (it is detected on the machine,
 * not installed by us), so the store answers for managed plugins alone.
 */
export class PluginStore {
  /**
   * Holds the directory the store file lives in.
   */
  private readonly directory: string;

  /**
   * Holds the records by plugin identifier, loaded on construction.
   */
  private records: Map<string, PluginInstallRecord>;

  /**
   * Initializes a new instance of the {@link PluginStore} class.
   * @param directory The directory the store file lives in (the user-data directory).
   */
  public constructor(directory: string) {
    this.directory = directory;
    this.records = this.load();
  }

  /**
   * Gets the record for an installed plugin, or null when Studio has not installed it.
   * @param id The plugin identifier.
   * @returns Returns the record, or null.
   */
  public get(id: string): PluginInstallRecord | null {
    return this.records.get(id) ?? null;
  }

  /**
   * Records a completed installation.
   * @param record The installation to record.
   */
  public add(record: PluginInstallRecord): void {
    this.records.set(record.id, record);
    this.save();
  }

  /**
   * Forgets an installation.
   * @param id The plugin identifier.
   */
  public remove(id: string): void {
    this.records.delete(id);
    this.save();
  }

  /**
   * Restores the records, defaulting to empty when the store is absent or corrupt.
   * @returns Returns the records by plugin identifier.
   */
  private load(): Map<string, PluginInstallRecord> {
    const records: Map<string, PluginInstallRecord> = new Map<string, PluginInstallRecord>();
    try {
      const file: string = this.storeFile();
      if (!existsSync(file)) {
        return records;
      }
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) {
        return records;
      }
      for (const entry of parsed) {
        const record: PluginInstallRecord | null = this.parse(entry);
        if (record !== null) {
          records.set(record.id, record);
        }
      }
    } catch (error: unknown) {
      // A missing or corrupt store means nothing is known to be installed, which is safe: the worst
      // outcome is that a provisioned plugin is offered for install again and re-uses its cache.
      logger.error('PluginStore', 'Failed to load the plugin store', error);
    }
    return records;
  }

  /**
   * Validates an untrusted entry into a record.
   * @param value The value to validate.
   * @returns Returns the record, or null when the value is malformed.
   */
  private parse(value: unknown): PluginInstallRecord | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const candidate: { id?: unknown; version?: unknown; installedPath?: unknown } = value;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.version !== 'string' ||
      typeof candidate.installedPath !== 'string'
    ) {
      return null;
    }
    return { id: candidate.id, version: candidate.version, installedPath: candidate.installedPath };
  }

  /**
   * Persists the records (best-effort).
   */
  private save(): void {
    try {
      writeFileSync(this.storeFile(), JSON.stringify([...this.records.values()]), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (error: unknown) {
      // Persistence is best-effort; a failure means the install is not remembered across launches.
      logger.error('PluginStore', 'Failed to persist the plugin store', error);
    }
  }

  /**
   * Gets the absolute path of the store file.
   * @returns Returns the store path.
   */
  private storeFile(): string {
    return path.join(this.directory, 'plugins.json');
  }
}
