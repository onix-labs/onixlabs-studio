import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LspChannel, LspSettings } from '@shared/api/lsp-channels';
import { logger } from '../logger';

/**
 * Holds the default settings used before any have been stored.
 */
const DEFAULT_SETTINGS: LspSettings = {
  disabledServers: [],
  javaPath: null,
  dotnetPath: null,
  clangdPath: null,
  typescriptServerPath: null,
  serverArgs: {},
  languageServers: {},
};

/**
 * Renames server identifiers that have changed meaning, applied to every persisted id as it is read.
 * The Python server used to be identified by its *language* (`python`), which stopped working once a
 * language could be served by more than one implementation: the id now names the implementation
 * (`pyright`), so a settings file written before the change would otherwise silently disable, or pass
 * arguments to, a server that no longer exists.
 */
const LEGACY_SERVER_IDS: Readonly<Record<string, string>> = { python: 'pyright' };

/**
 * Applies {@link LEGACY_SERVER_IDS} to a persisted server identifier.
 * @param serverId The identifier as persisted.
 * @returns Returns the current identifier for that server.
 */
function migrateServerId(serverId: string): string {
  return LEGACY_SERVER_IDS[serverId] ?? serverId;
}

/**
 * Owns the user's language-server settings in the main process: which servers are disabled and the
 * optional Java runtime override. The settings are persisted in the user-data directory so the server
 * registry can honour them when it resolves a server, and exposed to the renderer (which reads them to
 * avoid starting a disabled server). Changes take effect for servers started afterwards.
 */
export class LspSettingsManager {
  /**
   * Holds the active settings, loaded on registration and updated on change.
   */
  private settings: LspSettings = DEFAULT_SETTINGS;

  /**
   * Restores the persisted settings and registers the settings IPC handlers.
   */
  public register(): void {
    this.settings = this.load();
    ipcMain.handle(LspChannel.GetSettings, (): LspSettings => {
      logger.trace('LspSettingsManager', 'GetSettings requested');
      return this.settings;
    });
    ipcMain.handle(
      LspChannel.SetSettings,
      (_event: IpcMainInvokeEvent, value: unknown): LspSettings => this.set(value),
    );
    logger.info('LspSettingsManager', 'Registered language-server settings IPC handlers');
  }

  /**
   * Gets the active settings, for the registry and provisioner to consult.
   * @returns Returns the current settings.
   */
  public get(): LspSettings {
    return this.settings;
  }

  /**
   * Validates and stores new settings, persisting them for subsequent launches.
   * @param value The candidate settings from the renderer.
   * @returns Returns the stored settings (unchanged when the candidate is invalid).
   */
  private set(value: unknown): LspSettings {
    const parsed: LspSettings | null = this.parse(value);
    if (parsed !== null) {
      logger.info('LspSettingsManager', 'Updated language-server settings');
      this.settings = parsed;
      this.save();
    } else {
      logger.warn('LspSettingsManager', 'Rejected malformed language-server settings');
    }
    return this.settings;
  }

  /**
   * Restores the persisted settings from the user-data directory, defaulting when absent or corrupt.
   * @returns Returns the restored settings.
   */
  private load(): LspSettings {
    try {
      const file: string = this.storeFile();
      if (existsSync(file)) {
        const parsed: LspSettings | null = this.parse(JSON.parse(readFileSync(file, 'utf8')));
        if (parsed !== null) {
          return parsed;
        }
      }
    } catch (error: unknown) {
      // Fall through to defaults when the store is missing or corrupt.
      logger.error('LspSettingsManager', 'Failed to load language-server settings', error);
    }
    return DEFAULT_SETTINGS;
  }

  /**
   * Persists the active settings to the user-data directory (best-effort).
   */
  private save(): void {
    try {
      writeFileSync(this.storeFile(), JSON.stringify(this.settings), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (error: unknown) {
      // Persistence is best-effort; a failure simply means the choice is not remembered.
      logger.error('LspSettingsManager', 'Failed to persist language-server settings', error);
    }
  }

  /**
   * Validates and normalises an untrusted value into settings.
   * @param value The value to validate.
   * @returns Returns the settings, or null when the value is malformed.
   */
  private parse(value: unknown): LspSettings | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const candidate: {
      disabledServers?: unknown;
      javaPath?: unknown;
      dotnetPath?: unknown;
      clangdPath?: unknown;
      typescriptServerPath?: unknown;
      serverArgs?: unknown;
      languageServers?: unknown;
    } = value;
    const disabledServers: unknown = candidate.disabledServers;
    if (
      !Array.isArray(disabledServers) ||
      !disabledServers.every((entry: unknown): boolean => typeof entry === 'string')
    ) {
      return null;
    }
    const javaPath: string | null | undefined = this.parsePath(candidate.javaPath);
    if (javaPath === undefined) {
      return null;
    }
    const dotnetPath: string | null | undefined = this.parsePath(candidate.dotnetPath);
    if (dotnetPath === undefined) {
      return null;
    }
    const clangdPath: string | null | undefined = this.parsePath(candidate.clangdPath);
    if (clangdPath === undefined) {
      return null;
    }
    const typescriptServerPath: string | null | undefined = this.parsePath(
      candidate.typescriptServerPath,
    );
    if (typescriptServerPath === undefined) {
      return null;
    }
    const serverArgs: Record<string, readonly string[]> | null = this.parseServerArgs(
      candidate.serverArgs,
    );
    if (serverArgs === null) {
      return null;
    }
    const languageServers: Record<string, string> | null = this.parseLanguageServers(
      candidate.languageServers,
    );
    if (languageServers === null) {
      return null;
    }
    return {
      disabledServers: (disabledServers as readonly string[]).map(migrateServerId),
      javaPath,
      dotnetPath,
      clangdPath,
      typescriptServerPath,
      serverArgs,
      languageServers,
    };
  }

  /**
   * Validates and normalises the user's per-language server choices, dropping empty entries.
   * @param value The candidate map of language identifier to server identifier.
   * @returns Returns the normalised map, or null when the value is malformed.
   */
  private parseLanguageServers(value: unknown): Record<string, string> | null {
    if (value === undefined) {
      return {};
    }
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const result: Record<string, string> = {};
    for (const [language, serverId] of Object.entries(value)) {
      if (typeof serverId !== 'string') {
        return null;
      }
      if (serverId.length > 0) {
        result[language] = migrateServerId(serverId);
      }
    }
    return result;
  }

  /**
   * Validates and normalises an optional path override, treating absent and empty values as cleared.
   * @param value The candidate path.
   * @returns Returns the path, null when cleared, or undefined when the value is malformed.
   */
  private parsePath(value: unknown): string | null | undefined {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (typeof value !== 'string') {
      return undefined;
    }
    return value;
  }

  /**
   * Validates and normalises the per-server argument overrides, dropping empty entries.
   * @param value The candidate map of server identifier to arguments.
   * @returns Returns the normalised map, or null when the value is malformed.
   */
  private parseServerArgs(value: unknown): Record<string, readonly string[]> | null {
    if (value === undefined) {
      return {};
    }
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const result: Record<string, readonly string[]> = {};
    for (const [serverId, args] of Object.entries(value)) {
      if (!Array.isArray(args) || !args.every((arg: unknown): boolean => typeof arg === 'string')) {
        return null;
      }
      if (args.length > 0) {
        result[migrateServerId(serverId)] = args as readonly string[];
      }
    }
    return result;
  }

  /**
   * Gets the absolute path of the settings store file.
   * @returns Returns the store path.
   */
  private storeFile(): string {
    return join(app.getPath('userData'), 'lsp-settings.json');
  }
}
