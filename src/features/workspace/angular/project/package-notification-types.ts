import type { NotificationTypeDef } from '@shared/angular/services/notifications/notification-types';

/**
 * Names the notification types the Packages panel raises (#1492).
 */
export enum PackageNotificationType {
  /**
   * A package install, update, removal or restore finished.
   */
  Finished = 'packages.finished',

  /**
   * A package install, update, removal or restore failed.
   */
  Failed = 'packages.failed',
}

/**
 * Lists the notification types the Packages panel raises: a change that failed pops up, one that
 * finished goes to the history, since the panel showing the result is usually in view.
 */
export const PACKAGE_NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  {
    id: PackageNotificationType.Finished,
    label: 'Package Change Finished',
    description: 'A package was installed, updated or removed, or a project restored.',
    area: 'Packages',
    default: 'history',
  },
  {
    id: PackageNotificationType.Failed,
    label: 'Package Change Failed',
    description: 'A package install, update, removal or restore failed.',
    area: 'Packages',
    default: 'popup',
  },
];
