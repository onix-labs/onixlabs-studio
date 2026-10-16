import { BrowserWindow, Notification, type IpcMainEvent } from 'electron';
import {
  DesktopNotificationChannel,
  type DesktopNotificationRequest,
} from '@shared/api/desktop-notification-channels';
import { ContributionContext, MainContribution } from '../main-contribution';

/**
 * How many shown notifications are kept referenced. A notification that is garbage-collected stops
 * reporting its click, so the newest are held; the oldest of them has long left the screen.
 */
const MAX_HELD: number = 20;

/**
 * Shows Studio's notifications in the operating system's notification centre while Studio is in the
 * background (#927), and brings Studio forward when one is clicked.
 *
 * The renderer chooses which notifications deserve the OS — errors, finished work, an agent waiting —
 * and respects the user's setting and Mute. This half decides only *when*: never while a Studio window
 * has focus, because the user is already looking at the toast. It asks the operating system nothing
 * else and holds no state beyond the notifications on screen.
 */
export class DesktopNotificationsContribution implements MainContribution {
  /**
   * The stable contribution id.
   */
  public readonly id: string = 'desktop-notifications';

  /**
   * The notifications shown and not yet closed, oldest first, held so their clicks are reported.
   */
  private readonly held: Notification[] = [];

  /**
   * Wires the show channel.
   * @param context The surface the contribution reaches the application through.
   */
  public activate(context: ContributionContext): void {
    context.on(
      DesktopNotificationChannel.Show,
      (_event: IpcMainEvent, ...args: unknown[]): void => {
        const request: DesktopNotificationRequest | null = readRequest(args[0]);
        if (request !== null) {
          this.show(request, context);
        }
      },
    );
    context.log.info(
      Notification.isSupported()
        ? 'Desktop notifications ready'
        : 'Desktop notifications are not supported on this system',
    );
  }

  /**
   * Closes every notification still showing.
   */
  public dispose(): void {
    for (const notification of this.held.splice(0)) {
      notification.close();
    }
  }

  /**
   * Shows one notification, unless Studio is in front or the system has no notification centre.
   * @param request The notification.
   * @param context The contribution context, for the main window and the click report.
   */
  private show(request: DesktopNotificationRequest, context: ContributionContext): void {
    if (!Notification.isSupported() || BrowserWindow.getFocusedWindow() !== null) {
      return;
    }
    const notification: Notification = new Notification({
      title: request.title,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    notification.on('click', (): void => {
      const window: BrowserWindow | null = context.mainWindow();
      if (window !== null) {
        if (window.isMinimized()) {
          window.restore();
        }
        window.show();
        window.focus();
      }
      context.send(DesktopNotificationChannel.Clicked, request.id);
    });
    notification.on('close', (): void => this.release(notification));
    this.held.push(notification);
    if (this.held.length > MAX_HELD) {
      this.held.shift();
    }
    notification.show();
  }

  /**
   * Stops holding a notification once it has closed.
   * @param notification The notification.
   */
  private release(notification: Notification): void {
    const index: number = this.held.indexOf(notification);
    if (index >= 0) {
      this.held.splice(index, 1);
    }
  }
}

/**
 * Reads a notification out of what the renderer sent, keeping it short enough for a notification
 * centre.
 * @param value What was sent.
 * @returns Returns the request, or null when it is not one.
 */
export function readRequest(value: unknown): DesktopNotificationRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const id: unknown = record['id'];
  const title: unknown = record['title'];
  const body: unknown = record['body'];
  if (typeof id !== 'number' || typeof title !== 'string' || title.trim().length === 0) {
    return null;
  }
  return {
    id,
    title: title.trim().slice(0, 120),
    ...(typeof body === 'string' && body.trim().length > 0
      ? { body: body.trim().slice(0, 300) }
      : {}),
  };
}

/**
 * The singleton desktop-notifications contribution appended to the `mainContributions` manifest.
 */
export const desktopNotificationsContribution: MainContribution =
  new DesktopNotificationsContribution();
