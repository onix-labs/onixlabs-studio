import type { NotificationTypeDef } from '@shared/angular/services/notifications/notification-types';

/**
 * Names the notification types the AI Manager raises about local models (#1491).
 */
export enum ModelNotificationType {
  /**
   * A model finished downloading.
   */
  PullFinished = 'models.pullFinished',

  /**
   * A model could not be downloaded.
   */
  PullFailed = 'models.pullFailed',

  /**
   * The local model runtime finished installing.
   */
  InstallFinished = 'models.installFinished',

  /**
   * The local model runtime could not be installed.
   */
  InstallFailed = 'models.installFailed',
}

/**
 * Lists the notification types the AI Manager raises. Each pops up, success included: a model or a
 * runtime is gigabytes, and the user is usually waiting on it to use it.
 */
export const MODEL_NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  {
    id: ModelNotificationType.PullFinished,
    label: 'Model Downloaded',
    description: 'A local model finished downloading.',
    area: 'Local Models',
    default: 'popup',
  },
  {
    id: ModelNotificationType.PullFailed,
    label: 'Model Download Failed',
    description: 'A local model could not be downloaded.',
    area: 'Local Models',
    default: 'popup',
  },
  {
    id: ModelNotificationType.InstallFinished,
    label: 'Model Runtime Installed',
    description: 'The local model runtime finished installing.',
    area: 'Local Models',
    default: 'popup',
  },
  {
    id: ModelNotificationType.InstallFailed,
    label: 'Model Runtime Install Failed',
    description: 'The local model runtime could not be installed.',
    area: 'Local Models',
    default: 'popup',
  },
];
