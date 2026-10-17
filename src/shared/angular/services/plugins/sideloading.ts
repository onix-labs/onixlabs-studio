import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { PluginChannel, SideloadingState } from '@shared/api/plugin-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * Holds the state reported before the main process has answered, and outside Electron: nothing loaded,
 * nothing skipped, and the switch off — the safe reading of a state nobody has reported.
 */
const UNKNOWN: SideloadingState = { enabled: false, inForce: false, locked: false, skipped: 0 };

/**
 * Renderer-side client for the "Load sideloaded plugins" switch (#979): the typed wrapper around the
 * sideloading IPC channels, driven over the generic {@link Bridge} transport (`window.bridge`).
 *
 * The main process owns the choice: it reads it at launch, before any plugin is resolved, and persists
 * changes for the next launch. This service only reflects what main reports and forwards the user's
 * change, so the choice never lives in the renderer's settings store.
 */
@Service()
export class Sideloading {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the latest state the main process reported.
   */
  private readonly current: WritableSignal<SideloadingState> = signal<SideloadingState>(UNKNOWN);

  /**
   * Gets the latest reported state.
   */
  public readonly state: Signal<SideloadingState> = this.current.asReadonly();

  /**
   * Gets whether sideloaded plugins will be loaded from the next launch: what the switch shows.
   */
  public readonly enabled: Signal<boolean> = computed((): boolean => this.current().enabled);

  /**
   * Gets whether the switch's choice differs from what is in force, so a relaunch is pending.
   */
  public readonly restartRequired: Signal<boolean> = computed(
    (): boolean => this.current().enabled !== this.current().inForce,
  );

  /**
   * Gets whether the switch can be changed: not outside Electron, and not in the development app,
   * which always loads sideloaded plugins.
   */
  public readonly locked: Signal<boolean> = computed(
    (): boolean => this.bridge === undefined || this.current().locked,
  );

  /**
   * Initialises the service, loading the state from the main process.
   */
  public constructor() {
    void this.refresh();
  }

  /**
   * Refreshes and returns the state from the main process.
   * @returns Returns the reported {@link SideloadingState}.
   */
  public async refresh(): Promise<SideloadingState> {
    const state: SideloadingState =
      (await this.bridge?.invoke<SideloadingState>(PluginChannel.GetSideloading)) ?? UNKNOWN;
    this.current.set(state);
    return state;
  }

  /**
   * Sets whether sideloaded plugins are loaded, persisting it through the main process. The change
   * takes effect on the next launch.
   * @param enabled Whether to load them.
   * @returns Returns the state after the change.
   */
  public async setEnabled(enabled: boolean): Promise<SideloadingState> {
    const state: SideloadingState =
      (await this.bridge?.invoke<SideloadingState>(PluginChannel.SetSideloading, enabled)) ??
      this.current();
    this.current.set(state);
    this.log.info('Sideloading', `Load sideloaded plugins set to ${state.enabled}`);
    return state;
  }
}
