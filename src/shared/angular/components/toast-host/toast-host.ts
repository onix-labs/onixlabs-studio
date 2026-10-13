import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  Signal,
} from '@angular/core';
import { ToastCard } from '@shared/angular/components/toast-card/toast-card';
import { Log } from '@shared/angular/services/log/log';
import {
  Notification,
  NotificationAction,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { NotificationPosition, Settings } from '@shared/angular/services/settings/settings';

/**
 * The shortest time, in milliseconds, a paused toast runs for after the pointer leaves it, so a
 * toast whose timer was nearly spent still gives the user a beat to re-enter it.
 */
const MINIMUM_RESUME_MS: number = 500;

/**
 * How many toasts the stack draws: the front one and up to two receding behind it. Any more wait,
 * out of sight, for the ones in front to go.
 */
const SHOWN_DEPTH: number = 3;

/**
 * Tracks a transient toast's auto-dismiss countdown so it can be paused and resumed.
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
 * One toast in the stack, with how far behind the front it sits.
 */
interface StackedToast {
  /**
   * Gets the toast.
   */
  readonly toast: Notification;

  /**
   * Gets its depth: 0 for the front toast, 1 and 2 for those receding behind it.
   */
  readonly depth: number;
}

/**
 * Represents the toast stack, in the content's bottom-right corner above the status strip or over the
 * ribbon's right-hand end, as the "Position" setting says.
 *
 * The stack recedes rather than growing up the screen: the newest toast is in front, and up to two
 * older ones sit behind it, each a little higher, smaller and blurrier. Only the front toast can be
 * read and pressed; dismissing it brings the next forward.
 *
 * Presentation policy lives here: a transient toast counts down only while it is in front (a toast
 * pushed back keeps its remaining time until it returns), and pauses while hovered; sticky toasts
 * (errors) stay until dismissed; an action button runs its action and dismisses its toast.
 */
@Component({
  selector: 'app-toast-host',
  imports: [ToastCard],
  templateUrl: './toast-host.html',
  styleUrl: './toast-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.toast-host--ribbon]': "position() === 'ribbon'",
  },
})
export class ToastHost implements OnDestroy {
  /**
   * Holds the application-wide notification store the stack renders.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the settings store the toast duration and position are read from.
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
   * Holds whether the pointer is over the front toast, so a change in the stack does not restart a
   * countdown the user is holding.
   */
  private hovering: boolean = false;

  /**
   * Gets where the stack sits.
   */
  protected readonly position: Signal<NotificationPosition> =
    this.settings.value('notifications.position');

  /**
   * Gets the toasts drawn, newest first, each with its depth. Rendered back to front, so the template
   * reverses nothing: depth alone places each card.
   */
  protected readonly stack: Signal<readonly StackedToast[]> = computed(
    (): readonly StackedToast[] =>
      [...this.notifications.toasts()]
        .reverse()
        .slice(0, SHOWN_DEPTH)
        .map((toast: Notification, depth: number): StackedToast => ({ toast, depth })),
  );

  /**
   * Keeps the countdowns in step with the stack: drops those of departed toasts, runs the front
   * toast's, and holds every other.
   */
  private readonly timerSync: ReturnType<typeof effect> = effect((): void => {
    const toasts: readonly Notification[] = this.notifications.toasts();
    const live: ReadonlySet<number> = new Set<number>(
      toasts.map((toast: Notification): number => toast.id),
    );
    for (const [id, timer] of this.timers) {
      if (!live.has(id)) {
        if (timer.handle !== null) {
          clearTimeout(timer.handle);
        }
        this.timers.delete(id);
      }
    }
    const front: Notification | undefined = toasts.at(-1);
    for (const toast of toasts) {
      if (toast.sticky) {
        continue;
      }
      if (!this.timers.has(toast.id)) {
        this.create(toast);
      }
      if (toast === front && !this.hovering) {
        this.resume(toast);
      } else if (toast !== front) {
        this.hold(toast);
      }
    }
  });

  /**
   * Clears every pending countdown so none fires after the host is gone.
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
   * Pauses the front toast's countdown while the pointer is over it.
   * @param toast The hovered toast.
   */
  protected onEnter(toast: Notification): void {
    this.hovering = true;
    this.hold(toast);
  }

  /**
   * Resumes the front toast's countdown when the pointer leaves it.
   * @param toast The toast the pointer left.
   */
  protected onLeave(toast: Notification): void {
    this.hovering = false;
    this.resume(toast);
  }

  /**
   * Runs a toast's action and dismisses the toast.
   * @param toast The toast.
   * @param action The action pressed.
   */
  protected onAction(toast: Notification, action: NotificationAction): void {
    this.log.info('ToastHost', `Toast action '${action.label}' invoked`, toast.id);
    action.run();
    this.dismiss(toast);
  }

  /**
   * Dismisses a toast; its tray entry stays.
   * @param toast The toast.
   */
  protected dismiss(toast: Notification): void {
    this.hovering = false;
    this.notifications.dismiss(toast.id);
  }

  /**
   * Records a transient toast's countdown at the configured duration, not yet running.
   * @param toast The arriving toast.
   */
  private create(toast: Notification): void {
    this.timers.set(toast.id, {
      handle: null,
      remaining: this.settings.get('notifications.toastDuration') * 1000,
      startedAt: Date.now(),
    });
  }

  /**
   * Holds a countdown, keeping what is left of it.
   * @param toast The toast.
   */
  private hold(toast: Notification): void {
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
   * Runs a held countdown, with at least {@link MINIMUM_RESUME_MS} left.
   * @param toast The toast.
   */
  private resume(toast: Notification): void {
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
}
