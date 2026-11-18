import type { NotificationTypeDef } from '@shared/angular/services/notifications/notification-types';

/**
 * Names the notification types the container engine's events raise (#1488).
 */
export enum ContainerNotificationType {
  /**
   * A container stopped on its own with a non-zero exit code.
   */
  Exited = 'containers.exited',

  /**
   * A container stopped on its own with exit code 0.
   */
  Finished = 'containers.finished',

  /**
   * A container was killed for running out of memory.
   */
  OutOfMemory = 'containers.oom',

  /**
   * A container's health check started failing.
   */
  Unhealthy = 'containers.unhealthy',

  /**
   * A container keeps stopping and being restarted.
   */
  Restarting = 'containers.restarting',

  /**
   * An image download started from Studio finished.
   */
  PullFinished = 'containers.pullFinished',

  /**
   * An image download started from Studio failed.
   */
  PullFailed = 'containers.pullFailed',

  /**
   * The container engine stopped, or came back.
   */
  Engine = 'containers.engine',
}

/**
 * Lists the notification types the container engine's events raise: what went wrong pops up; a clean
 * exit, a finished download and the engine coming and going go to the history.
 */
export const CONTAINER_NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  {
    id: ContainerNotificationType.Exited,
    label: 'Container Exited',
    description: 'A container stopped on its own with a non-zero exit code.',
    area: 'Containers',
    default: 'popup',
  },
  {
    id: ContainerNotificationType.Finished,
    label: 'Container Finished',
    description: 'A container stopped on its own with exit code 0.',
    area: 'Containers',
    default: 'history',
  },
  {
    id: ContainerNotificationType.OutOfMemory,
    label: 'Container Out of Memory',
    description: 'A container was killed for running out of memory.',
    area: 'Containers',
    default: 'popup',
  },
  {
    id: ContainerNotificationType.Unhealthy,
    label: 'Container Unhealthy',
    description: "A container's health check started failing.",
    area: 'Containers',
    default: 'popup',
  },
  {
    id: ContainerNotificationType.Restarting,
    label: 'Container Keeps Restarting',
    description: 'A container stopped and was restarted several times in a short while.',
    area: 'Containers',
    default: 'popup',
  },
  {
    id: ContainerNotificationType.PullFinished,
    label: 'Image Downloaded',
    description: 'An image download started from Studio finished.',
    area: 'Containers',
    default: 'history',
  },
  {
    id: ContainerNotificationType.PullFailed,
    label: 'Image Download Failed',
    description: 'An image download started from Studio failed.',
    area: 'Containers',
    default: 'popup',
  },
  {
    id: ContainerNotificationType.Engine,
    label: 'Container Engine Stopped or Started',
    description: 'The container engine stopped, or came back.',
    area: 'Containers',
    default: 'history',
  },
];
