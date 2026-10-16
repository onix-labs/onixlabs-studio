import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import type { Bridge } from '@shared/api/bridge';
import {
  DesktopNotificationChannel,
  type DesktopNotificationRequest,
} from '@shared/api/desktop-notification-channels';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * How many click handlers are remembered. A notification older than this has long left the
 * notification centre, so a click on it only brings Studio forward.
 */
const MAX_HANDLERS: number = 50;

/**
 * Hands notifications to the operating system's notification centre (#927), so an agent finishing, a
 * build failing or an agent waiting on a decision is seen while Studio is in the background.
 *
 * The main process shows one only while no Studio window has focus; this side honours the
 * `notifications.desktop` setting and remembers what a click should bring into view.
 */
@Service()
export class DesktopNotifications {
  /**
   * Holds the settings, read for whether desktop notifications are on.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the IPC bridge, absent outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds what each recent notification's click brings into view, by its identifier.
   */
  private readonly handlers: Map<number, () => void> = new Map<number, () => void>();

  /**
   * Holds the identifier the next notification is given.
   */
  private nextId: number = 1;

  /**
   * Holds whether this window has focus.
   */
  private readonly focusedSignal: WritableSignal<boolean> = signal<boolean>(document.hasFocus());

  /**
   * Gets whether this window has focus — false while the user is in another application.
   */
  public readonly focused: Signal<boolean> = this.focusedSignal.asReadonly();

  /**
   * Follows the window's focus, and runs a notification's handler when it is clicked.
   */
  public constructor() {
    window.addEventListener('focus', (): void => this.focusedSignal.set(true));
    window.addEventListener('blur', (): void => this.focusedSignal.set(false));
    this.bridge?.on(DesktopNotificationChannel.Clicked, (id: unknown): void => {
      const handler: (() => void) | undefined =
        typeof id === 'number' ? this.handlers.get(id) : undefined;
      this.log.debug('DesktopNotifications', 'Desktop notification clicked', id);
      handler?.();
    });
  }

  /**
   * Shows a notification in the system's notification centre, if the user has them on. The main
   * process leaves it out while a Studio window has focus.
   * @param title The headline.
   * @param body The line under it, if any.
   * @param reveal What clicking it brings into view, if anything beyond Studio itself.
   */
  public show(title: string, body?: string, reveal?: () => void): void {
    if (this.bridge === undefined || !this.settings.get('notifications.desktop')) {
      return;
    }
    const id: number = this.nextId++;
    if (reveal !== undefined) {
      this.handlers.set(id, reveal);
      if (this.handlers.size > MAX_HANDLERS) {
        this.handlers.delete(this.handlers.keys().next().value!);
      }
    }
    const request: DesktopNotificationRequest = {
      id,
      title,
      ...(body === undefined ? {} : { body }),
    };
    this.bridge.send(DesktopNotificationChannel.Show, request);
  }
}
