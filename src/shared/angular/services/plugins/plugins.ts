import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { PluginActionResult, PluginChannel, PluginSummary } from '@shared/api/plugin-channels';
import { Log } from '@shared/angular/services/log/log';
import { PluginConsent } from './plugin-consent';

/**
 * Renderer-side view of the plugins the main process knows about, and the actions that change what is
 * installed. Outside Electron the bridge is absent and the list is empty, so the view degrades to an
 * honest "nothing to show" rather than pretending.
 */
@Service()
export class Plugins {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the latest known plugin list.
   */
  private readonly known: WritableSignal<readonly PluginSummary[]> = signal<
    readonly PluginSummary[]
  >([]);

  /**
   * Holds whether a refresh or an action is in flight, for the view to disable its controls.
   */
  private readonly working: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the last action's error, cleared when the next action starts.
   */
  private readonly lastError: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the known plugins with their current state.
   */
  public readonly plugins: Signal<readonly PluginSummary[]> = this.known.asReadonly();

  /**
   * Gets whether an operation is in flight.
   */
  public readonly busy: Signal<boolean> = this.working.asReadonly();

  /**
   * Gets the last action's error, or null when the last action succeeded.
   */
  public readonly error: Signal<string | null> = this.lastError.asReadonly();

  /**
   * Initializes the service, loading the plugin list and following changes the main process pushes.
   */
  public constructor() {
    void this.refresh();
    this.bridge?.on(PluginChannel.Changed, (...args: unknown[]): void => {
      this.known.set((args[0] as readonly PluginSummary[] | undefined) ?? []);
    });
  }

  /**
   * Gets the revision of the curated catalogue in force this launch, or null before it has been read
   * (and outside Electron, where there is no catalogue to report).
   * @returns Returns the revision, or null when it is unknown.
   */
  public async catalogueRevision(): Promise<number | null> {
    const revision: number | undefined = await this.bridge?.invoke<number>(
      PluginChannel.CatalogueRevision,
    );
    return typeof revision === 'number' ? revision : null;
  }

  /**
   * Reloads the plugin list from the main process.
   * @returns Returns a promise that resolves once the list has been reloaded.
   */
  public async refresh(): Promise<void> {
    this.working.set(true);
    try {
      const plugins: readonly PluginSummary[] =
        (await this.bridge?.invoke<readonly PluginSummary[]>(PluginChannel.List)) ?? [];
      this.known.set(plugins);
      this.log.debug('Plugins', `Loaded ${plugins.length} plugin(s)`);
    } finally {
      this.working.set(false);
    }
  }

  /**
   * Holds the consent seam every install is asked through.
   */
  private readonly consent: PluginConsent = inject(PluginConsent);

  /**
   * Installs a plugin **after** its terms have been accepted. This is the path every user-facing
   * entry point takes: verification proves a payload was not tampered with, it has never claimed the
   * code is good, and that residual risk is the user's to accept — from whichever surface they
   * happen to be on. Declining (or dismissing the window) installs nothing.
   * @param id The plugin identifier.
   * @returns Returns a promise that resolves once the install has finished, or immediately when the
   * plugin is unknown or the terms were not accepted.
   */
  public async installWithConsent(id: string): Promise<void> {
    const plugin: PluginSummary | undefined = this.known().find(
      (candidate: PluginSummary): boolean => candidate.id === id,
    );
    if (plugin === undefined) {
      this.log.warn('Plugins', `Cannot ask consent for unknown plugin '${id}'`);
      return;
    }
    if (!(await this.consent.request(plugin))) {
      this.log.info('Plugins', `Install of '${id}' declined`);
      return;
    }
    await this.install(id);
  }

  /**
   * Installs a plugin without asking. For callers that have already obtained consent through
   * {@link installWithConsent}; a user-facing surface must not call this directly.
   * @param id The plugin identifier.
   * @returns Returns a promise that resolves once the install has finished.
   */
  public install(id: string): Promise<void> {
    return this.act(PluginChannel.Install, id);
  }

  /**
   * Uninstalls a plugin.
   * @param id The plugin identifier.
   * @returns Returns a promise that resolves once the uninstall has finished.
   */
  public uninstall(id: string): Promise<void> {
    return this.act(PluginChannel.Uninstall, id);
  }

  /**
   * Runs an install or uninstall and records its outcome. The refreshed list arrives on the change
   * channel, so this does not reload it itself.
   * @param channel The channel to invoke.
   * @param id The plugin identifier.
   * @returns Returns a promise that resolves once the action has finished.
   */
  private async act(channel: PluginChannel, id: string): Promise<void> {
    this.lastError.set(null);
    this.working.set(true);
    try {
      const result: PluginActionResult | undefined = await this.bridge?.invoke<PluginActionResult>(
        channel,
        id,
      );
      if (result !== undefined && !result.success) {
        this.lastError.set(result.error);
        this.log.warn('Plugins', `Action on '${id}' failed: ${result.error ?? 'unknown'}`);
      }
    } finally {
      this.working.set(false);
    }
  }
}
