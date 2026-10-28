import {
  computed,
  inject,
  Service,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { DesktopNotifications } from './desktop-notifications';

/**
 * The maximum number of toasts held at once. An arrival beyond the cap evicts the oldest transient
 * toast (or the oldest outright when every toast is sticky), so a burst of events can never fill the
 * screen.
 */
const MAX_TOASTS: number = 5;

/**
 * The maximum number of notifications the history keeps. The history backs the status-strip
 * notification centre; beyond the cap the oldest entries fall away.
 */
const MAX_HISTORY: number = 100;

/**
 * Specifies a notification's severity, which drives its icon and colour and whether it defaults to
 * sticky: an `error` stays until dismissed so a failure never vanishes silently; every other
 * severity auto-dismisses.
 */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * Specifies where a notification surfaces: the toast stack and the history both (`default`), the
 * history alone (`history-only` — a record without an interruption, for an outcome whose surface
 * the user is already watching), or the toast stack alone (`toast-only` — transient state that
 * would be stale as a record, such as an agent ask that retracts once answered).
 */
export type NotificationRoute = 'default' | 'history-only' | 'toast-only';

/**
 * Defines an action offered on a notification, rendered as a button on its toast.
 */
export interface NotificationAction {
  /**
   * Gets the action's button label.
   */
  readonly label: string;

  /**
   * Invokes the action. Runs when the user clicks the button; the toast dismisses itself afterwards.
   */
  readonly run: () => void;
}

/**
 * Defines a request to raise a notification.
 */
export interface NotificationRequest {
  /**
   * Gets the notification's severity.
   */
  readonly severity: NotificationSeverity;

  /**
   * Gets the notification's one-line headline.
   */
  readonly title: string;

  /**
   * Gets the supporting detail shown under the title, or undefined when the title stands alone.
   */
  readonly detail?: string;

  /**
   * Gets the actions offered on the toast, or undefined when it offers none.
   */
  readonly actions?: readonly NotificationAction[];

  /**
   * Gets the coalescing key, or undefined when the notification never coalesces. A new notification
   * whose key matches a live toast replaces that toast in place — a repeated or superseding outcome
   * (a retried push, a fetch overwriting a stale failure) updates one toast instead of stacking.
   */
  readonly key?: string;

  /**
   * Gets whether the toast stays until explicitly dismissed, or undefined to default from the
   * severity (`error` is sticky; everything else is transient).
   */
  readonly sticky?: boolean;

  /**
   * Gets where the notification surfaces, or undefined for the default (toast and history both).
   */
  readonly route?: NotificationRoute;

  /**
   * Gets whether the notification also goes to the operating system's notification centre while
   * Studio is in the background (#927): finished or failed work the user may be waiting on, rather
   * than every passing message. Errors always do; undefined means no for everything else.
   */
  readonly desktop?: boolean;

  /**
   * Brings what the notification is about into view, run when its desktop notification is clicked —
   * the tab whose agent finished, say. Undefined when bringing Studio forward is enough.
   */
  readonly reveal?: () => void;

  /**
   * Runs once the toast leaves the stack — dismissed, coalesced over, evicted, withdrawn by muting, or
   * after one of its actions ran — or at once when it never pops up. Lets a raiser waiting on an
   * answer (a language server's question, #1154) learn it will not come. Undefined when nothing waits.
   */
  readonly onDismiss?: () => void;
}

/**
 * Represents a raised notification held in the toast stack.
 */
export interface Notification {
  /**
   * Gets the notification's unique identifier.
   */
  readonly id: number;

  /**
   * Gets the notification's severity.
   */
  readonly severity: NotificationSeverity;

  /**
   * Gets the notification's one-line headline.
   */
  readonly title: string;

  /**
   * Gets the supporting detail shown under the title, or undefined when the title stands alone.
   */
  readonly detail?: string;

  /**
   * Gets the actions offered on the toast.
   */
  readonly actions: readonly NotificationAction[];

  /**
   * Gets the coalescing key, or undefined when the notification never coalesces.
   */
  readonly key?: string;

  /**
   * Gets a value indicating whether the toast stays until explicitly dismissed.
   */
  readonly sticky: boolean;

  /**
   * Gets when the notification was raised, as an epoch millisecond timestamp.
   */
  readonly timestamp: number;
}

/**
 * Represents the application-wide notification store: significant events (a push outcome, a run
 * failure) are raised here and surface as toasts in the main window. The store is deliberately a
 * root singleton — pop-out windows share the renderer, so an action taken in a pop-out raises
 * through the same instance and its toast renders in the main window.
 *
 * The store owns only the stack; presentation policy (auto-dismiss timing, hover pause) lives with
 * the toast host that renders it.
 */
@Service()
export class Notifications {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the settings, read for what still pops up while muted.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the bridge to the operating system's notification centre.
   */
  private readonly desktop: DesktopNotifications = inject(DesktopNotifications);

  /**
   * Holds whether notifications are muted. Session-only by design: Studio starts unmuted every launch.
   */
  private readonly mutedSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the identifier the next notification is assigned.
   */
  private nextId: number = 1;

  /**
   * Holds the live toasts, oldest first.
   */
  private readonly toastsSignal: WritableSignal<readonly Notification[]> = signal<
    readonly Notification[]
  >([]);

  /**
   * Holds the dismissal callback of each live toast that has one, by notification identifier.
   */
  private readonly dismissals: Map<number, () => void> = new Map<number, () => void>();

  /**
   * Holds the recent notifications, newest first, bounded to {@link MAX_HISTORY}. Independent of the
   * toast stack: a toast's departure (auto-dismiss or manual) leaves its history entry as the record.
   */
  private readonly historySignal: WritableSignal<readonly Notification[]> = signal<
    readonly Notification[]
  >([]);

  /**
   * Holds the identifier of the newest notification the user had seen when the centre was last
   * opened; entries above it count as unseen. Identifiers are monotonic, so a plain watermark
   * suffices.
   */
  private readonly lastSeenId: WritableSignal<number> = signal<number>(0);

  /**
   * Gets the live toasts, oldest first.
   */
  public readonly toasts: Signal<readonly Notification[]> = this.toastsSignal.asReadonly();

  /**
   * Gets the recent notifications, newest first.
   */
  public readonly history: Signal<readonly Notification[]> = this.historySignal.asReadonly();

  /**
   * Gets whether notifications are muted: while they are, a notification goes to the tray without
   * popping up, unless it is an error and the "When muted" setting lets errors through.
   */
  public readonly muted: Signal<boolean> = this.mutedSignal.asReadonly();

  /**
   * Gets the number of notifications raised since the centre was last opened.
   */
  public readonly unseenCount: Signal<number> = computed(
    (): number =>
      this.historySignal().filter(
        (notification: Notification): boolean => notification.id > this.lastSeenId(),
      ).length,
  );

  /**
   * Raises a notification, coalescing it onto a live toast with the same key or appending it to the
   * stack (evicting the oldest transient toast when the stack is full), and recording it in the
   * history — each side skipped when the request routes away from it.
   * @param request The notification to raise.
   */
  public notify(request: NotificationRequest): void {
    const route: NotificationRoute = request.route ?? 'default';
    const notification: Notification = {
      id: this.nextId++,
      severity: request.severity,
      title: request.title,
      detail: request.detail,
      actions: request.actions ?? [],
      key: request.key,
      sticky: request.sticky ?? request.severity === 'error',
      timestamp: Date.now(),
    };
    if (route !== 'history-only' && !this.silenced(notification.severity)) {
      if (request.onDismiss !== undefined) {
        this.dismissals.set(notification.id, request.onDismiss);
      }
      this.setToasts(this.insert(this.toastsSignal(), notification));
    } else {
      request.onDismiss?.();
    }
    // Muted means quiet everywhere: what would not pop up in Studio does not pop up on the desktop.
    if (
      (request.desktop === true || notification.severity === 'error') &&
      !this.silenced(notification.severity)
    ) {
      this.desktop.show(notification.title, notification.detail, request.reveal);
    }
    if (route !== 'toast-only') {
      this.historySignal.update((current: readonly Notification[]): readonly Notification[] =>
        [notification, ...current].slice(0, MAX_HISTORY),
      );
    }
    this.log.info(
      'Notifications',
      `Raised ${notification.severity} notification: ${notification.title}`,
      route,
    );
  }

  /**
   * Mutes or unmutes notifications for the rest of the session. Muting also withdraws the toasts
   * showing that would not have popped up while muted; their tray entries stay.
   * @param muted Whether to mute.
   */
  public setMuted(muted: boolean): void {
    this.mutedSignal.set(muted);
    this.log.info('Notifications', muted ? 'Notifications muted' : 'Notifications unmuted');
    if (muted) {
      this.setToasts(
        this.toastsSignal().filter(
          (toast: Notification): boolean => !this.silenced(toast.severity),
        ),
      );
    }
  }

  /**
   * Gets whether a notification of a severity is kept from popping up: only while muted, and then
   * everything except errors when the "When muted" setting lets errors through.
   * @param severity The notification's severity.
   * @returns Returns true when it should go to the tray only.
   */
  private silenced(severity: NotificationSeverity): boolean {
    // Untracked: notifications are raised from inside effects, which must not come to depend on the
    // mute state through the call.
    return untracked((): boolean => {
      if (!this.mutedSignal()) {
        return false;
      }
      return !(severity === 'error' && this.settings.get('notifications.whenMuted') === 'errors');
    });
  }

  /**
   * Dismisses the live toast carrying a coalescing key, if any. Lets the raiser of a keyed toast
   * retract it once its moment has passed (an agent ask that was answered elsewhere).
   * @param key The coalescing key.
   */
  public dismissByKey(key: string): void {
    this.setToasts(this.toastsSignal().filter((toast: Notification): boolean => toast.key !== key));
  }

  /**
   * Dismisses a single toast. Its history entry stays as the record of the event.
   * @param id The identifier of the toast to dismiss.
   */
  public dismiss(id: number): void {
    this.setToasts(this.toastsSignal().filter((toast: Notification): boolean => toast.id !== id));
  }

  /**
   * Dismisses every toast. The history keeps its entries.
   */
  public dismissAll(): void {
    this.setToasts([]);
  }

  /**
   * Marks every notification as seen, clearing the unseen count. Called when the notification
   * centre opens.
   */
  public markAllSeen(): void {
    const newest: Notification | undefined = this.historySignal()[0];
    this.lastSeenId.set(newest?.id ?? 0);
  }

  /**
   * Removes a notification from the history, also dismissing its toast when it is still live —
   * clearing an entry from the centre clears it everywhere.
   * @param id The identifier of the notification to remove.
   */
  public removeFromHistory(id: number): void {
    this.historySignal.update((current: readonly Notification[]): readonly Notification[] =>
      current.filter((notification: Notification): boolean => notification.id !== id),
    );
    this.dismiss(id);
  }

  /**
   * Clears the notification centre: every history entry and every live toast.
   */
  public clearAll(): void {
    this.historySignal.set([]);
    this.dismissAll();
  }

  /**
   * Replaces the toast stack, running the dismissal callback of every toast that left it.
   * @param next The next stack.
   */
  private setToasts(next: readonly Notification[]): void {
    this.toastsSignal.set(next);
    if (this.dismissals.size === 0) {
      return;
    }
    const live: ReadonlySet<number> = new Set<number>(
      next.map((toast: Notification): number => toast.id),
    );
    for (const [id, onDismiss] of [...this.dismissals]) {
      if (!live.has(id)) {
        this.dismissals.delete(id);
        onDismiss();
      }
    }
  }

  /**
   * Places a notification into the stack: replacing a live toast with the same coalescing key in
   * place, or appending and enforcing the stack cap.
   * @param current The live toasts.
   * @param notification The arriving notification.
   * @returns Returns the next toast stack.
   */
  private insert(
    current: readonly Notification[],
    notification: Notification,
  ): readonly Notification[] {
    if (notification.key !== undefined) {
      const index: number = current.findIndex(
        (toast: Notification): boolean => toast.key === notification.key,
      );
      if (index >= 0) {
        const next: Notification[] = [...current];
        next[index] = notification;
        return next;
      }
    }
    const appended: readonly Notification[] = [...current, notification];
    return appended.length <= MAX_TOASTS ? appended : this.evict(appended);
  }

  /**
   * Drops one toast from an over-full stack: the oldest transient toast, or the oldest outright when
   * every toast is sticky — a screen of undismissed errors still cannot grow without bound.
   * @param toasts The over-full stack, oldest first.
   * @returns Returns the stack with the victim removed.
   */
  private evict(toasts: readonly Notification[]): readonly Notification[] {
    const victim: Notification =
      toasts.find((toast: Notification): boolean => !toast.sticky) ?? toasts[0];
    return toasts.filter((toast: Notification): boolean => toast.id !== victim.id);
  }
}
