import { Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * The maximum number of toasts held at once. An arrival beyond the cap evicts the oldest transient
 * toast (or the oldest outright when every toast is sticky), so a burst of events can never fill the
 * screen.
 */
const MAX_TOASTS: number = 5;

/**
 * Specifies a notification's severity, which drives its icon and colour and whether it defaults to
 * sticky: an `error` stays until dismissed so a failure never vanishes silently; every other
 * severity auto-dismisses.
 */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

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
   * Gets the live toasts, oldest first.
   */
  public readonly toasts: Signal<readonly Notification[]> = this.toastsSignal.asReadonly();

  /**
   * Raises a notification, coalescing it onto a live toast with the same key or appending it to the
   * stack (evicting the oldest transient toast when the stack is full).
   * @param request The notification to raise.
   */
  public notify(request: NotificationRequest): void {
    const notification: Notification = {
      id: this.nextId++,
      severity: request.severity,
      title: request.title,
      detail: request.detail,
      actions: request.actions ?? [],
      key: request.key,
      sticky: request.sticky ?? request.severity === 'error',
    };
    this.toastsSignal.update((current: readonly Notification[]): readonly Notification[] =>
      this.insert(current, notification),
    );
  }

  /**
   * Dismisses a single toast.
   * @param id The identifier of the toast to dismiss.
   */
  public dismiss(id: number): void {
    this.toastsSignal.update((current: readonly Notification[]): readonly Notification[] =>
      current.filter((toast: Notification): boolean => toast.id !== id),
    );
  }

  /**
   * Dismisses every toast.
   */
  public dismissAll(): void {
    this.toastsSignal.set([]);
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
