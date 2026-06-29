import { Service, signal, Signal, WritableSignal } from '@angular/core';
import { LspApi, LspSettings as LspSettingsData } from '@shared/lsp-types';

/**
 * Holds the settings used before any have been loaded from the main process.
 */
const DEFAULT_SETTINGS: LspSettingsData = {
  disabledServers: [],
  javaPath: null,
  dotnetPath: null,
  clangdPath: null,
  typescriptServerPath: null,
  serverArgs: {},
};

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
   * Sets the .NET runtime override, persisting the change through the main process. An empty value
   * clears the override (auto-detect).
   * @param dotnetPath The .NET executable path, or an empty string to auto-detect.
   * @returns Returns a promise that resolves once the change is stored.
   */
  public async setDotnetPath(dotnetPath: string): Promise<void> {
    const trimmed: string = dotnetPath.trim();
    await this.store({ ...this.current(), dotnetPath: trimmed === '' ? null : trimmed });
  }

  /**
   * Sets the clangd override, persisting the change through the main process. An empty value clears
   * the override (auto-detect).
   * @param clangdPath The clangd executable path, or an empty string to auto-detect.
   * @returns Returns a promise that resolves once the change is stored.
   */
  public async setClangdPath(clangdPath: string): Promise<void> {
    const trimmed: string = clangdPath.trim();
    await this.store({ ...this.current(), clangdPath: trimmed === '' ? null : trimmed });
  }

  /**
   * Sets the custom TypeScript server path, persisting the change through the main process. An empty
   * value clears the override (use the bundled server).
   * @param serverPath The TypeScript server entry point, or an empty string to use the bundled one.
   * @returns Returns a promise that resolves once the change is stored.
   */
  public async setTypescriptServerPath(serverPath: string): Promise<void> {
    const trimmed: string = serverPath.trim();
    await this.store({ ...this.current(), typescriptServerPath: trimmed === '' ? null : trimmed });
  }

  /**
   * Gets a server's extra command-line arguments as the user typed them (space-separated).
   * @param serverId The server identifier whose arguments are read.
   * @returns Returns the arguments joined by spaces, or an empty string when there are none.
   */
  public serverArgsText(serverId: string): string {
    return (this.current().serverArgs[serverId] ?? []).join(' ');
  }

  /**
   * Sets a server's extra command-line arguments, persisting the change through the main process. The
   * text is split on whitespace; an empty value clears the override.
   * @param serverId The server identifier whose arguments are set.
   * @param argsText The arguments as a whitespace-separated string.
   * @returns Returns a promise that resolves once the change is stored.
   */
  public async setServerArgs(serverId: string, argsText: string): Promise<void> {
    const args: string[] = argsText
      .trim()
      .split(/\s+/)
      .filter((arg: string): boolean => arg.length > 0);
    const serverArgs: Record<string, readonly string[]> = { ...this.current().serverArgs };
    if (args.length === 0) {
      delete serverArgs[serverId];
    } else {
      serverArgs[serverId] = args;
    }
    await this.store({ ...this.current(), serverArgs });
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
