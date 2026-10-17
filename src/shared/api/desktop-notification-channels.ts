/**
 * Names the IPC channels that carry Studio's notifications to the operating system's notification
 * centre (#927). The renderer decides what deserves one; the main-process
 * {@link import('../electron/contributions/desktop-notifications/desktop-notifications.contribution').DesktopNotificationsContribution}
 * decides whether to show it — only while no Studio window has focus, since a user looking at Studio
 * already sees the toast.
 */
export enum DesktopNotificationChannel {
  /**
   * Shows a {@link DesktopNotificationRequest} in the system's notification centre, unless a Studio
   * window has focus (send).
   */
  Show = 'desktop-notifications:show',

  /**
   * Reports that the user clicked a desktop notification, by its identifier (push). Studio is already
   * in front by then; the renderer brings what the notification is about into view.
   */
  Clicked = 'desktop-notifications:clicked',
}

/**
 * A notification for the operating system's notification centre.
 */
export interface DesktopNotificationRequest {
  /**
   * Gets the identifier the click is reported by.
   */
  readonly id: number;

  /**
   * Gets the headline.
   */
  readonly title: string;

  /**
   * Gets the line under the headline, or undefined when the headline stands alone.
   */
  readonly body?: string;
}
