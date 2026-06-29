import { computed, inject, Service, Signal } from '@angular/core';
import { Display } from '@shared/angular/services/display/display';
import { SettingBindings } from '@features/settings/angular/setting-bindings';
import { SETTINGS_BY_KEY, SettingDef } from '@shared/angular/services/settings/settings-registry';

/**
 * Aggregates the restart-pending state across every restart-gated setting (those flagged
 * `requiresRestart` in the registry) into a single signal, so the settings view can show one
 * "restart required" banner rather than a notice per control. Each gated setting's binding reports
 * whether a change is actually pending; this service ORs them together and exposes the relaunch action.
 *
 * Restart-gated settings are owner-owned today (hardware acceleration, via Display, which reports
 * pending against the value the process launched with). A future store-owned restart setting would
 * simply have its Settings binding supply `restartPending` and would be aggregated here unchanged.
 */
@Service()
export class SettingsRestart {
  /**
   * Holds the binding resolver used to read each gated setting's pending state.
   */
  private readonly bindings: SettingBindings = inject(SettingBindings);

  /**
   * Holds the display service, the owner of the relaunch bridge.
   */
  private readonly display: Display = inject(Display);

  /**
   * Holds the pending-restart signals of every restart-gated setting in the registry.
   */
  private readonly pending: readonly Signal<boolean>[] = [...SETTINGS_BY_KEY.values()]
    .filter((definition: SettingDef): boolean => definition.requiresRestart === true)
    .map(
      (definition: SettingDef): Signal<boolean> | undefined =>
        this.bindings.resolve(definition.key, definition.owner).restartPending,
    )
    .filter(
      (candidate: Signal<boolean> | undefined): candidate is Signal<boolean> =>
        candidate !== undefined,
    );

  /**
   * Gets whether any restart-gated setting has a change awaiting an application restart.
   */
  public readonly restartRequired: Signal<boolean> = computed((): boolean =>
    this.pending.some((isPending: Signal<boolean>): boolean => isPending()),
  );

  /**
   * Relaunches the application so pending restart-gated changes can take effect.
   */
  public relaunch(): void {
    this.display.relaunch();
  }
}
