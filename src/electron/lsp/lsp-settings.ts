import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IpcChannel } from '../../shared/ipc-channels';
import { LspSettings } from '../../shared/lsp-types';

/**
 * Holds the default settings used before any have been stored.
 */
const DEFAULT_SETTINGS: LspSettings = {
  disabledServers: [],
  javaPath: null,
  typescriptServerPath: null,
  serverArgs: {},
};

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
    ipcMain.handle(IpcChannel.LspGetSettings, (): LspSettings => this.settings);
    ipcMain.handle(
      IpcChannel.LspSetSettings,
      (_event: IpcMainInvokeEvent, value: unknown): LspSettings => this.set(value),
    );
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
      this.settings = parsed;
      this.save();
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
    } catch {
      // Fall through to defaults when the store is missing or corrupt.
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
    } catch {
      // Persistence is best-effort; a failure simply means the choice is not remembered.
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
      typescriptServerPath?: unknown;
      serverArgs?: unknown;
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
    return {
      disabledServers: disabledServers as readonly string[],
      javaPath,
      typescriptServerPath,
      serverArgs,
    };
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
        result[serverId] = args as readonly string[];
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
