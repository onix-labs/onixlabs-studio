import type { NotificationTypeDef } from '@shared/angular/services/notifications/notification-types';

/**
 * Names the notification types a debug session raises (#1490).
 */
export enum DebugNotificationType {
  /**
   * The program being debugged ended on its own with exit code 0.
   */
  Ended = 'debug.ended',

  /**
   * The program being debugged ended on its own with a non-zero exit code, or the debugger itself
   * stopped unexpectedly.
   */
  Failed = 'debug.failed',

  /**
   * The program stopped at a breakpoint or an exception while no Studio window had focus.
   */
  Stopped = 'debug.stopped',
}

/**
 * Lists the notification types a debug session raises. An ending the user did not ask for pops up when
 * it failed; a pause while Studio is in the background reaches the desktop only, since in Studio the
 * paused frame is already in front of the user.
 */
export const DEBUG_NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  {
    id: DebugNotificationType.Ended,
    label: 'Debug Session Ended',
    description: 'The program being debugged ended on its own with exit code 0.',
    area: 'Debugging',
    default: 'history',
  },
  {
    id: DebugNotificationType.Failed,
    label: 'Debug Session Failed',
    description:
      'The program being debugged ended with a non-zero exit code, or the debugger stopped unexpectedly.',
    area: 'Debugging',
    default: 'popup',
  },
  {
    id: DebugNotificationType.Stopped,
    label: 'Paused While Elsewhere',
    description:
      'The program stopped at a breakpoint or an exception while Studio was in the background. Shown on the desktop only.',
    area: 'Debugging',
    default: 'popup',
  },
];
