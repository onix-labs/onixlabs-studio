import { CdkMenu, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { severityIcon } from '@shared/angular/icons/severity-icon';
import {
  Notification,
  Notifications,
  NotificationSeverity,
} from '@shared/angular/services/notifications/notifications';

/**
 * The status strip's notification centre: a bell on the strip's trailing side carrying the unseen
 * count, opening a drop-up flyout of the recent notifications — newest first, each with its
 * severity, detail, age, and a remove control, plus a Clear all. Opening the flyout marks
 * everything seen. The flyout complements the toasts: a transient toast that auto-dismissed is
 * still here, so a missed outcome can always be recovered.
 */
@Component({
  selector: 'app-status-strip-notifications-menu',
  imports: [Button, AppIcon, CdkMenuTrigger, CdkMenu],
  templateUrl: './status-strip-notifications-menu.html',
  styleUrl: './status-strip-notifications-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStripNotificationsMenu {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the application-wide notification store the centre renders.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Gets the recent notifications, newest first.
   */
  protected readonly history: Signal<readonly Notification[]> = this.notifications.history;

  /**
   * Gets the number of notifications raised since the centre was last opened.
   */
  protected readonly unseenCount: Signal<number> = this.notifications.unseenCount;

  /**
   * Gets the trigger's tooltip and accessible label, naming the unseen count when there is one.
   */
  protected readonly triggerTitle: Signal<string> = computed((): string => {
    const unseen: number = this.unseenCount();
    if (unseen === 0) {
      return 'Notifications';
    }
    return unseen === 1 ? '1 new notification' : `${unseen} new notifications`;
  });

  /**
   * Gets the position that opens the flyout upward from the trigger, their right edges aligned, lifted
   * a few pixels clear of the button so it does not sit flush against it. The negative offset moves the
   * upward-opening flyout further up; a copy is offset so the shared position definition is untouched.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['up-end'].map(
    (position: ConnectedPosition): ConnectedPosition => ({ ...position, offsetY: -6 }),
  );

  /**
   * Marks every notification seen once the flyout opens, clearing the bell's count.
   */
  protected onOpened(): void {
    this.notifications.markAllSeen();
  }

  /**
   * Removes a notification from the centre (and its toast, when still live).
   * @param entry The notification to remove.
   */
  protected remove(entry: Notification): void {
    this.notifications.removeFromHistory(entry.id);
  }

  /**
   * Clears every notification and live toast.
   */
  protected clearAll(): void {
    this.notifications.clearAll();
  }

  /**
   * Resolves the icon a severity renders with.
   * @param severity The notification's severity.
   * @returns Returns the severity's icon.
   */
  protected iconFor(severity: NotificationSeverity): Icon {
    return severityIcon(severity);
  }

  /**
   * Formats how long ago a notification was raised, coarsely — the flyout is a recency cue, not a
   * timeline.
   * @param timestamp The notification's epoch millisecond timestamp.
   * @returns Returns the formatted age.
   */
  protected relativeTime(timestamp: number): string {
    const minutes: number = Math.floor((Date.now() - timestamp) / 60_000);
    if (minutes < 1) {
      return 'just now';
    }
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours: number = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  }
}
