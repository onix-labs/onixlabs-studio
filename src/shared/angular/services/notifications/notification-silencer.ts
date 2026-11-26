import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { SettingsNavigation } from '@shared/angular/services/settings-navigation/settings-navigation';
import type { NotificationChoice } from '@shared/angular/services/settings/settings-registry';
import { NotificationTypeDef, NotificationTypes } from './notification-types';
import { Notification, Notifications } from './notifications';

/**
 * Switches a kind of notification off from the notification itself (#1487): Don't Show Again on a
 * toast or a history entry, with Undo, and Notification Settings to find the kind again.
 *
 * Don't Show Again sends the kind to the history only, so nothing vanishes without trace; it is
 * offered only for a notification that has a type and still pops up. Feedback on something the user
 * just did has no type and never offers it.
 */
@Service()
export class NotificationSilencer {
  /**
   * Holds the notification store.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the notification types and the user's choice for each.
   */
  private readonly types: NotificationTypes = inject(NotificationTypes);

  /**
   * Holds the Settings deep link.
   */
  private readonly navigation: SettingsNavigation = inject(SettingsNavigation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Determines whether a notification offers Don't Show Again: it has a type, and that type still pops
   * up.
   * @param notification The notification.
   * @returns Returns true when it does.
   */
  public canSilence(notification: Notification): boolean {
    return notification.type !== undefined && this.types.shown(notification.type) === 'popup';
  }

  /**
   * Determines whether a notification offers Notification Settings: it has a type to find there.
   * @param notification The notification.
   * @returns Returns true when it does.
   */
  public canConfigure(notification: Notification): boolean {
    return notification.type !== undefined;
  }

  /**
   * Sends a notification's kind to the history only, and says so with Undo, which puts back the
   * choice it had.
   * @param notification The notification whose kind is switched off.
   */
  public silence(notification: Notification): void {
    const type: string | undefined = notification.type;
    if (type === undefined) {
      return;
    }
    const previous: NotificationChoice = this.types.shown(type);
    this.types.set(type, 'history');
    const label: string =
      this.types.all().find((candidate: NotificationTypeDef): boolean => candidate.id === type)
        ?.label ?? 'These notifications';
    this.log.info('NotificationSilencer', `${type} sent to the history only`);
    this.notifications.notify({
      severity: 'info',
      title: `${label} turned off`,
      detail: 'They go to the notification history only.',
      key: `silenced:${type}`,
      actions: [
        {
          label: 'Undo',
          run: (): void => {
            this.types.set(type, previous);
            this.log.info('NotificationSilencer', `${type} restored to ${previous}`);
          },
        },
        { label: 'Notification Settings', run: (): void => this.configure(notification) },
      ],
    });
  }

  /**
   * Opens Settings at a notification's kind, where it can be switched back on.
   * @param notification The notification.
   */
  public configure(notification: Notification): void {
    this.navigation.open('notifications', notification.type);
  }
}
