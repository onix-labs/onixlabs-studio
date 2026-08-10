import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  Signal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button, ButtonTone } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { severityIcon } from '@shared/angular/icons/severity-icon';
import { Log } from '@shared/angular/services/log/log';
import {
  Notification,
  NotificationAction,
  Notifications,
  NotificationSeverity,
} from '@shared/angular/services/notifications/notifications';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * The shortest time, in milliseconds, a paused toast runs for after the pointer leaves it, so a
 * toast whose timer was nearly spent still gives the user a beat to re-enter it.
 */
const MINIMUM_RESUME_MS: number = 500;

/**
 * Tracks a transient toast's auto-dismiss countdown so hovering can pause and resume it.
 */
interface ToastTimer {
  /**
   * Gets or sets the running timeout handle, or null while the countdown is paused.
   */
  handle: ReturnType<typeof setTimeout> | null;

  /**
   * Gets or sets the time remaining on the countdown, in milliseconds, as of {@link startedAt}.
   */
  remaining: number;

  /**
   * Gets or sets when the current countdown leg started, as an epoch millisecond timestamp.
   */
  startedAt: number;
}

/**
 * Represents the toast stack rendered in the main window's bottom-right corner, above the status
 * strip. Presentation policy lives here: transient toasts auto-dismiss after the configured
 * duration and pause while hovered; sticky toasts (errors) stay until dismissed; an action button
 * runs its action and dismisses its toast.
 */
@Component({
  selector: 'app-toast-host',
  imports: [Button, AppIcon],
  templateUrl: './toast-host.html',
  styleUrl: './toast-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHost implements OnDestroy {
  /**
   * Holds the application-wide notification store the stack renders.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the settings store the toast duration is read from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the auto-dismiss countdowns of the live transient toasts, keyed by toast identifier.
   */
  private readonly timers: Map<number, ToastTimer> = new Map<number, ToastTimer>();

  /**
   * Gets the live toasts, oldest first.
   */
  protected readonly toasts: Signal<readonly Notification[]> = this.notifications.toasts;

  /**
   * Gets the icon vocabulary for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Keeps the countdown map in step with the stack: an arriving transient toast starts its
   * countdown, and a departing toast (dismissed from anywhere) releases its timer.
   */
  private readonly timerSync: ReturnType<typeof effect> = effect((): void => {
    const live: ReadonlySet<number> = new Set<number>(
      this.toasts().map((toast: Notification): number => toast.id),
    );
    for (const [id, timer] of this.timers) {
      if (!live.has(id)) {
        if (timer.handle !== null) {
          clearTimeout(timer.handle);
        }
        this.timers.delete(id);
      }
    }
    for (const toast of this.toasts()) {
      if (!toast.sticky && !this.timers.has(toast.id)) {
        this.start(toast);
      }
    }
  });

  /**
   * Releases every running countdown.
   */
  public ngOnDestroy(): void {
    for (const timer of this.timers.values()) {
      if (timer.handle !== null) {
        clearTimeout(timer.handle);
      }
    }
    this.timers.clear();
  }

  /**
   * Pauses a toast's auto-dismiss countdown while the pointer is over it.
   * @param toast The hovered toast.
   */
  protected pause(toast: Notification): void {
    const timer: ToastTimer | undefined = this.timers.get(toast.id);
    if (timer === undefined) {
      return;
    }
    if (timer.handle === null) {
      return;
    }
    clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(timer.remaining - (Date.now() - timer.startedAt), 0);
  }

  /**
   * Resumes a toast's paused countdown once the pointer leaves it.
   * @param toast The departed toast.
   */
  protected resume(toast: Notification): void {
    const timer: ToastTimer | undefined = this.timers.get(toast.id);
    if (timer === undefined) {
      return;
    }
    if (timer.handle !== null) {
      return;
    }
    timer.remaining = Math.max(timer.remaining, MINIMUM_RESUME_MS);
    timer.startedAt = Date.now();
    timer.handle = setTimeout((): void => this.notifications.dismiss(toast.id), timer.remaining);
  }

  /**
   * Runs a toast action and dismisses its toast.
   * @param toast The toast offering the action.
   * @param action The chosen action.
   */
  protected onAction(toast: Notification, action: NotificationAction): void {
    this.log.info('ToastHost', `Toast action '${action.label}' invoked`, toast.id);
    action.run();
    this.notifications.dismiss(toast.id);
  }

  /**
   * Dismisses a toast.
   * @param toast The toast to dismiss.
   */
  protected onDismiss(toast: Notification): void {
    this.notifications.dismiss(toast.id);
  }

  /**
   * Resolves the icon a severity renders with.
   * @param severity The toast's severity.
   * @returns Returns the severity's icon.
   */
  protected iconFor(severity: NotificationSeverity): Icon {
    return severityIcon(severity);
  }

  /**
   * Resolves the button tone a severity carries, so a toast's action and dismiss buttons take the same
   * state colour as the card. `error` maps to the `danger` tone (the same red under a different name);
   * every other severity shares its tone's name.
   * @param severity The toast's severity.
   * @returns Returns the matching button tone.
   */
  protected toneFor(severity: NotificationSeverity): ButtonTone {
    return severity === 'error' ? 'danger' : severity;
  }

  /**
   * Starts a transient toast's auto-dismiss countdown at the configured duration.
   * @param toast The arriving toast.
   */
  private start(toast: Notification): void {
    const duration: number = this.settings.get('notifications.toastDuration') * 1000;
    this.timers.set(toast.id, {
      handle: setTimeout((): void => this.notifications.dismiss(toast.id), duration),
      remaining: duration,
      startedAt: Date.now(),
    });
  }
}
