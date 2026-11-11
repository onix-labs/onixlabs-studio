import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { canUpdate } from '@shared/angular/components/plugin-action/plugin-action-rules';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * The coalescing key of the Update All failure notification, so a later run replaces the one showing.
 */
const FAILURE_KEY: string = 'plugin-update-all-failed';

/**
 * Describes a plugin Update All could not update, and why.
 */
interface UpdateFailure {
  /**
   * Gets the plugin's display name.
   */
  readonly name: string;

  /**
   * Gets why the update failed, as the main process reported it.
   */
  readonly reason: string;
}

/**
 * Updates every installed plugin that has a newer version waiting (#1451).
 *
 * Each update takes the same path as the row's own Update: the plugin's terms are asked through the
 * consent window first, because an update is new code and consent one surface could skip is not
 * consent. The plugins are taken one at a time, in catalogue order. A plugin whose terms are declined is
 * skipped; one that fails does not stop the rest, and every failure is reported together in one
 * notification at the end. Success adds nothing beyond what a single update shows: the rows update in
 * place.
 */
@Service()
export class PluginUpdateAll {
  /**
   * Holds the plugin client every update goes through.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the notification store, for the failures.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds whether an Update All is in progress.
   */
  private readonly runningState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether an Update All is in progress.
   */
  public readonly running: Signal<boolean> = this.runningState.asReadonly();

  /**
   * Gets how many installed plugins have an update waiting.
   */
  public readonly available: Signal<number> = computed(
    (): number => this.plugins.plugins().filter(canUpdate).length,
  );

  /**
   * Gets whether Update All can be pressed: something has an update, and nothing else is in progress.
   */
  public readonly enabled: Signal<boolean> = computed(
    (): boolean => this.available() > 0 && !this.runningState() && !this.plugins.busy(),
  );

  /**
   * Updates every plugin with an update waiting, one at a time, through the same consent the row's
   * Update asks. Pressing it again while it runs does nothing.
   * @returns Returns a promise that resolves once every update has been tried.
   */
  public async updateAll(): Promise<void> {
    if (this.runningState()) {
      return;
    }
    // The list is fixed when the run starts: an update refreshes the list, and a plugin that gained an
    // update mid-run was not part of what the user asked for.
    const targets: readonly PluginSummary[] = this.plugins.plugins().filter(canUpdate);
    if (targets.length === 0) {
      return;
    }
    this.runningState.set(true);
    this.log.info('PluginUpdateAll', `Updating ${targets.length} plugin(s)`);
    const failures: UpdateFailure[] = [];
    try {
      for (const plugin of targets) {
        const outcome: 'installed' | 'declined' | 'failed' = await this.plugins.installWithConsent(
          plugin.id,
        );
        if (outcome === 'failed') {
          failures.push({
            name: plugin.name,
            reason: this.plugins.error() ?? 'the update did not finish',
          });
        }
      }
    } finally {
      this.runningState.set(false);
    }
    this.report(failures);
  }

  /**
   * Reports the plugins that could not be updated, together, or withdraws an earlier report when
   * every update went through.
   * @param failures The plugins that failed, with why.
   */
  private report(failures: readonly UpdateFailure[]): void {
    if (failures.length === 0) {
      this.notifications.dismissByKey(FAILURE_KEY);
      return;
    }
    this.log.warn('PluginUpdateAll', `${failures.length} plugin update(s) failed`);
    this.notifications.notify({
      severity: 'error',
      title:
        failures.length === 1
          ? `${failures[0].name} could not be updated`
          : `${failures.length} plugins could not be updated`,
      detail: failures
        .map((failure: UpdateFailure): string => `${failure.name}: ${failure.reason}`)
        .join('\n'),
      key: FAILURE_KEY,
    });
  }
}
