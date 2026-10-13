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
import {
  NotificationColour,
  NotificationStacking,
  Settings,
} from '@shared/angular/services/settings/settings';

/**
 * The shortest time, in milliseconds, a paused toast runs for after the pointer leaves it, so a
 * toast whose timer was nearly spent still gives the user a beat to re-enter it.
 */
const MINIMUM_RESUME_MS: number = 500;

/**
 * How many toasts the receding stack draws: the front one and up to two behind it. Any more wait,
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
 * One toast as drawn, with how far behind the front it sits and whether it is coloured.
 */
interface StackedToast {
  /**
   * Gets the toast.
   */
  readonly toast: Notification;

  /**
   * Gets its depth when stacking backwards: 0 for the front toast, 1 and 2 for those behind it.
   * Always 0 when stacking upwards, where every toast is in front.
   */
  readonly depth: number;

  /**
   * Gets whether it is drawn in grey: only the newest is coloured, and this is not the newest.
   */
  readonly plain: boolean;
}

/**
 * Represents the toast stack, in the content's bottom-right corner above the status strip.
 *
 * The "Stacking" setting decides its shape. **Upwards**, toasts form a column growing up the screen,
 * newest at the top, every one readable and pressable. **Backwards**, the newest is in front and
 * up to two older ones sit behind it, each a little higher, smaller, blurrier and fainter; only the
 * front toast can be read and pressed, and dismissing it brings the next forward.
 *
 * The "Colour" setting can grey every toast but the newest; the colour moves to the next newest as
 * the newest goes.
 *
 * Presentation policy lives here: a transient toast counts down while it can be seen in full (every
 * toast stacking upwards; only the front one stacking backwards, so a toast pushed back keeps its
 * remaining time until it returns), and pauses while hovered; sticky toasts (errors) stay until
 * dismissed; an action button runs its action and dismisses its toast.
 */
@Component({
  selector: 'app-toast-host',
  imports: [ToastCard],
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
   * Holds the settings store the toast duration, stacking and colour are read from.
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
   * Holds the identifier of the toast under the pointer, so a change in the stack does not restart a
   * countdown the user is holding.
   */
  private hoveredId: number | null = null;

  /**
   * Gets how the toasts stack.
   */
  protected readonly stacking: Signal<NotificationStacking> =
    this.settings.value('notifications.stacking');

  /**
   * Gets which toasts are coloured.
   */
  private readonly colour: Signal<NotificationColour> = this.settings.value('notifications.colour');

  /**
   * Gets the toasts drawn, newest first. Upwards: every toast, so the newest heads the column.
   * Backwards: the newest few, each placed by its depth alone.
   */
  protected readonly stack: Signal<readonly StackedToast[]> = computed(
    (): readonly StackedToast[] => {
      const toasts: readonly Notification[] = this.notifications.toasts();
      const newest: Notification | undefined = toasts.at(-1);
      const newestOnly: boolean = this.colour() === 'newest';
      const backwards: boolean = this.stacking() === 'backwards';
      const newestFirst: readonly Notification[] = [...toasts].reverse();
      const drawn: readonly Notification[] = backwards
        ? newestFirst.slice(0, SHOWN_DEPTH)
        : newestFirst;
      return drawn.map((toast: Notification, index: number): StackedToast => ({
        toast,
        depth: backwards ? index : 0,
        plain: newestOnly && toast !== newest,
      }));
    },
  );

  /**
   * Keeps the countdowns in step with the stack: drops those of departed toasts, runs those that can
   * be seen in full and are not hovered, and holds every other.
   */
  private readonly timerSync: ReturnType<typeof effect> = effect((): void => {
    const toasts: readonly Notification[] = this.notifications.toasts();
    const upwards: boolean = this.stacking() === 'upwards';
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
      const visible: boolean = upwards || toast === front;
      if (visible && toast.id !== this.hoveredId) {
        this.resume(toast);
      } else if (!visible) {
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
   * Pauses a toast's countdown while the pointer is over it.
   * @param toast The hovered toast.
   */
  protected onEnter(toast: Notification): void {
    this.hoveredId = toast.id;
    this.hold(toast);
  }

  /**
   * Resumes a toast's countdown when the pointer leaves it.
   * @param toast The toast the pointer left.
   */
  protected onLeave(toast: Notification): void {
    this.hoveredId = null;
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
    if (this.hoveredId === toast.id) {
      this.hoveredId = null;
    }
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
