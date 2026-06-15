import { Service, signal, Signal, WritableSignal } from '@angular/core';
import { LspApi, LspSettings as LspSettingsData } from '../../../shared/lsp-types';

/**
 * Holds the settings used before any have been loaded from the main process.
 */
const DEFAULT_SETTINGS: LspSettingsData = { disabledServers: [], javaPath: null };

/**
 * Renderer-side wrapper around the language-server settings owned by the main process. It exposes the
 * settings as a signal, lets the user toggle servers and override the Java runtime, and answers
 * whether a server is disabled so the client does not start one the user has turned off. Outside
 * Electron the bridge is absent and every operation degrades to a safe no-op.
 */
@Service()
export class LspSettings {
  /**
   * Holds the language-server bridge, or undefined when running outside Electron.
   */
  private readonly api: LspApi | undefined = window.studio?.lsp;

  /**
   * Holds the latest known settings.
   */
  private readonly current: WritableSignal<LspSettingsData> =
    signal<LspSettingsData>(DEFAULT_SETTINGS);

  /**
   * Gets the active settings.
   */
  public readonly settings: Signal<LspSettingsData> = this.current.asReadonly();

  /**
   * Gets whether a real bridge is available (i.e. running in Electron).
   */
  public readonly isAvailable: boolean = this.api !== undefined;

  /**
   * Initializes the service, loading the settings from the main process.
   */
  public constructor() {
    void this.refresh();
  }

  /**
   * Refreshes and returns the settings from the main process.
   * @returns Returns the loaded settings.
   */
  public async refresh(): Promise<LspSettingsData> {
    const settings: LspSettingsData = (await this.api?.getSettings()) ?? this.current();
    this.current.set(settings);
    return settings;
  }

  /**
   * Determines whether a server has been disabled by the user.
   * @param serverId The server identifier to test.
   * @returns Returns true when the server is disabled.
   */
  public isDisabled(serverId: string): boolean {
    return this.current().disabledServers.includes(serverId);
  }

  /**
   * Enables or disables a server, persisting the change through the main process.
   * @param serverId The server identifier to toggle.
   * @param enabled Whether the server should be enabled.
   * @returns Returns a promise that resolves once the change is stored.
   */
  public async setServerEnabled(serverId: string, enabled: boolean): Promise<void> {
    const disabled: Set<string> = new Set<string>(this.current().disabledServers);
    if (enabled) {
      disabled.delete(serverId);
    } else {
      disabled.add(serverId);
    }
    await this.store({ ...this.current(), disabledServers: [...disabled] });
  }

  /**
   * Sets the Java runtime override, persisting the change through the main process. An empty value
   * clears the override (auto-detect).
   * @param javaPath The Java executable path, or an empty string to auto-detect.
   * @returns Returns a promise that resolves once the change is stored.
   */
  public async setJavaPath(javaPath: string): Promise<void> {
    const trimmed: string = javaPath.trim();
    await this.store({ ...this.current(), javaPath: trimmed === '' ? null : trimmed });
  }

  /**
   * Stores settings through the main process and reflects the stored result.
   * @param next The settings to store.
   * @returns Returns a promise that resolves once the settings are stored.
   */
  private async store(next: LspSettingsData): Promise<void> {
    const stored: LspSettingsData = (await this.api?.setSettings(next)) ?? next;
    this.current.set(stored);
  }
}
