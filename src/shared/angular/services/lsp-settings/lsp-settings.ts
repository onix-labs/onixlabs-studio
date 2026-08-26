import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  LspChannel,
  LspServerId,
  LspServerSummary,
  LspSettings as LspSettingsData,
} from '@shared/api/lsp-channels';
import { entriesForLanguage, resolveForLanguage } from '@shared/api/language-slot';
import {
  installedContributions,
  PluginChannel,
  PluginContribution,
  PluginSummary,
} from '@shared/api/plugin-channels';
import { Log } from '@shared/angular/services/log/log';

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
  languageServers: {},
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
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
  public readonly isAvailable: boolean = this.bridge !== undefined;

  /**
   * Holds every server the main process has registered, before narrowing to what is installed. Kept so
   * a plugin becoming installed can be reflected without re-fetching the whole catalogue.
   */
  private registeredServers: readonly LspServerSummary[] = [];

  /**
   * Holds the installed servers — the catalogue narrowed to what installed plugins contribute — empty
   * until both have loaded.
   */
  private readonly registered: WritableSignal<readonly LspServerSummary[]> = signal<
    readonly LspServerSummary[]
  >([]);

  /**
   * Gets the registered language servers, for choosing which one serves a language.
   */
  public readonly catalogue: Signal<readonly LspServerSummary[]> = this.registered.asReadonly();

  /**
   * Gets a promise that resolves once the catalogue has been loaded from the main process. The
   * catalogue arrives asynchronously, so a caller that must resolve a language *now* — a document
   * opened during startup — awaits this rather than concluding the language has no server.
   */
  public readonly ready: Promise<void>;

  /**
   * Initializes the service, loading the settings and the server catalogue from the main process.
   */
  public constructor() {
    void this.refresh();
    this.ready = this.loadCatalogue();
  }

  /**
   * Resolves which server serves a language: the user's choice when they have made one, otherwise the
   * highest-priority registered server. Returns null when the catalogue has not loaded yet or no
   * registered server serves the language.
   * @param language The Monaco language identifier.
   * @returns Returns the server identifier, or null when none serves the language.
   */
  public serverForLanguage(language: string): LspServerId | null {
    return resolveForLanguage(language, this.registered(), this.current().languageServers);
  }

  /**
   * Gets every registered server that can serve a language, for offering the user the choice. A
   * language with more than one is a slot the user picks an implementation for.
   * @param language The Monaco language identifier.
   * @returns Returns the servers serving the language, in catalogue order.
   */
  public serversForLanguage(language: string): readonly LspServerSummary[] {
    return entriesForLanguage(language, this.registered());
  }

  /**
   * Chooses which server serves a language, persisting the change through the main process. Passing
   * null clears the choice, returning the language to its default server.
   * @param language The Monaco language identifier.
   * @param serverId The chosen server, or null to use the default.
   * @returns Returns a promise that resolves once the change is stored.
   */
  public async setServerForLanguage(language: string, serverId: LspServerId | null): Promise<void> {
    const languageServers: Record<string, LspServerId> = { ...this.current().languageServers };
    if (serverId === null) {
      delete languageServers[language];
    } else {
      languageServers[language] = serverId;
    }
    this.log.info('LspSettings', `Language '${language}' served by '${serverId ?? 'default'}'`);
    await this.store({ ...this.current(), languageServers });
  }

  /**
   * Loads the servers that **installed** plugins contribute, and follows changes as plugins are
   * installed or removed. The catalogue is intersected with the installed set rather than taken whole:
   * a server whose plugin is not installed must never be offered as a choice, which is the join
   * between the Plugin Manager and this slot.
   *
   * Outside Electron both channels are absent and the catalogue stays empty, which correctly reports
   * that no language has a server.
   * @returns Returns a promise that resolves once the catalogue has been loaded.
   */
  private async loadCatalogue(): Promise<void> {
    const registered: readonly LspServerSummary[] =
      (await this.bridge?.invoke<readonly LspServerSummary[]>(LspChannel.GetCatalogue)) ?? [];
    this.registeredServers = registered;
    const plugins: readonly PluginSummary[] =
      (await this.bridge?.invoke<readonly PluginSummary[]>(PluginChannel.List)) ?? [];
    this.applyInstalled(plugins);
    this.bridge?.on(PluginChannel.Changed, (...args: unknown[]): void => {
      this.applyInstalled((args[0] as readonly PluginSummary[] | undefined) ?? []);
    });
  }

  /**
   * Narrows the registered servers to those contributed by installed plugins.
   * @param plugins The plugins with their current state.
   */
  private applyInstalled(plugins: readonly PluginSummary[]): void {
    const installed: ReadonlySet<string> = new Set<string>(
      installedContributions(plugins, 'language-server').map(
        (contribution: PluginContribution): string => contribution.id,
      ),
    );
    const available: readonly LspServerSummary[] = this.registeredServers.filter(
      (server: LspServerSummary): boolean => installed.has(server.id),
    );
    this.registered.set(available);
    this.log.debug(
      'LspSettings',
      `${available.length} of ${this.registeredServers.length} servers are installed`,
    );
  }

  /**
   * Refreshes and returns the settings from the main process.
   * @returns Returns the loaded settings.
   */
  public async refresh(): Promise<LspSettingsData> {
    const settings: LspSettingsData =
      (await this.bridge?.invoke<LspSettingsData>(LspChannel.GetSettings)) ?? this.current();
    this.current.set(settings);
    this.log.debug(
      'LspSettings',
      `Loaded settings; ${settings.disabledServers.length} disabled server(s)`,
    );
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
    this.log.info('LspSettings', `Server '${serverId}' ${enabled ? 'enabled' : 'disabled'}`);
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
    const stored: LspSettingsData =
      (await this.bridge?.invoke<LspSettingsData>(LspChannel.SetSettings, next)) ?? next;
    this.current.set(stored);
  }
}
