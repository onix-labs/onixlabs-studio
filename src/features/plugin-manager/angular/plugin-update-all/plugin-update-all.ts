import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { canUpdate } from '@shared/angular/components/plugin-action/plugin-action-rules';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { PluginConsent } from '@shared/angular/services/plugins/plugin-consent';
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
 * The terms are asked once, for the whole batch (Matthew's ruling on #1451): one window lists every
 * plugin with its version before and after, and accepting it is the same consent each plugin's own
 * Update would ask. Cancelling updates nothing. After that the plugins are updated one at a time, in
 * catalogue order, with no further windows. One that fails does not stop the rest, and every failure is
 * reported together in one notification at the end. Success adds nothing beyond what a single update
 * shows: the rows update in place.
 */
@Service()
export class PluginUpdateAll {
  /**
   * Holds the plugin client every update goes through.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the consent seam the batch's terms are asked through.
   */
  private readonly consent: PluginConsent = inject(PluginConsent);

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
   * Asks once whether to update every plugin with an update waiting and, if accepted, updates them one
   * at a time. Pressing it again while it runs does nothing.
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
    const failures: UpdateFailure[] = [];
    try {
      if (!(await this.consent.requestBatch(targets))) {
        this.log.info('PluginUpdateAll', 'Update All declined');
        return;
      }
      this.log.info('PluginUpdateAll', `Updating ${targets.length} plugin(s)`);
      for (const plugin of targets) {
        // Consent was given for the batch, so each install goes ahead without asking again. The
        // install clears the last error as it starts and records one if it fails.
        await this.plugins.install(plugin.id);
        const error: string | null = this.plugins.error();
        if (error !== null) {
          failures.push({ name: plugin.name, reason: error });
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
