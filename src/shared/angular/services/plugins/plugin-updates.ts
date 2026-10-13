import { computed, effect, inject, Service, Signal, untracked } from '@angular/core';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { canUpdate } from '@shared/angular/components/plugin-action/plugin-action-rules';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Plugins } from './plugins';

/**
 * The coalescing key of the updates notification, so a newer list replaces the one showing.
 */
const NOTIFICATION_KEY: string = 'plugin-updates';

/**
 * Tells the user when installed plugins have newer versions waiting.
 *
 * ⛔ Tells, never applies. An update is new code, and each one is accepted in the Plugin Manager the
 * way an install is, so the notification's action opens the manager rather than updating anything.
 *
 * The plugin list arrives once the main window loads, and again whenever it changes, so the check
 * runs then. The same set of updates is announced once a session; a different set (a new release, or
 * one plugin updated out of several) is announced afresh. Once nothing is waiting, a notification
 * still showing is withdrawn.
 */
@Service()
export class PluginUpdates {
  /**
   * Holds the plugin client, whose list says what is installed and what the catalogue offers.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the notification store.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the tab registry, for opening the Plugin Manager.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the sets announced this session, as `id@version` lists, so a re-check does not raise the
   * same notification again.
   */
  private readonly announced: Set<string> = new Set<string>();

  /**
   * Gets the installed plugins with a newer version waiting, in catalogue order.
   */
  public readonly available: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] => this.plugins.plugins().filter(canUpdate),
  );

  /**
   * Announces the waiting updates whenever the set changes.
   */
  private readonly watch: ReturnType<typeof effect> = effect((): void => {
    const waiting: readonly PluginSummary[] = this.available();
    untracked((): void => this.announce(waiting));
  });

  /**
   * Announces a set of waiting updates, once a session, or withdraws the notice when none are waiting.
   * @param waiting The plugins with updates.
   */
  private announce(waiting: readonly PluginSummary[]): void {
    if (waiting.length === 0) {
      this.notifications.dismissByKey(NOTIFICATION_KEY);
      return;
    }
    const set: string = waiting
      .map((plugin: PluginSummary): string => `${plugin.id}@${plugin.version}`)
      .join(',');
    if (this.announced.has(set)) {
      return;
    }
    this.announced.add(set);
    this.log.info('PluginUpdates', `Announcing plugin updates`, set);
    this.notifications.notify({
      severity: 'info',
      title:
        waiting.length === 1
          ? 'A plugin update is available'
          : `${waiting.length} plugin updates are available`,
      detail: waiting
        .map(
          (plugin: PluginSummary): string =>
            `${plugin.name} ${plugin.installedVersion ?? ''} → ${plugin.version}`,
        )
        .join(', '),
      sticky: true,
      key: NOTIFICATION_KEY,
      actions: [
        {
          label: 'Review',
          run: (): void => {
            this.tabs.open('plugin-manager');
          },
        },
      ],
    });
  }
}
