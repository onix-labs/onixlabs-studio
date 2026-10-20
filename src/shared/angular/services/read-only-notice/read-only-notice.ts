import { inject, Service } from '@angular/core';
import { Notifications } from '@shared/angular/services/notifications/notifications';

/**
 * Holds how long, in milliseconds, after the notice another attempt to edit stays quiet: a run of
 * keystrokes in a read-only editor tells the user once.
 */
export const READ_ONLY_NOTICE_QUIET: number = 2_000;

/**
 * Holds the key the notice is raised under, so a newer one replaces a showing one.
 */
export const READ_ONLY_NOTICE_KEY: string = 'editor-read-only';

/**
 * Tells the user that the editor they tried to type into is read-only (#1024), in place of Monaco's
 * overlay message over the caret: a brief notice that goes by itself, raised once for a run of
 * attempts rather than once a keystroke, and kept out of the notification history.
 */
@Service()
export class ReadOnlyNotice {
  /**
   * Holds the notifications the notice is raised through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds when the notice was last raised, in milliseconds since the epoch, or null before it ever
   * was.
   */
  private shownAt: number | null = null;

  /**
   * Raises the notice, unless it was raised a moment ago.
   */
  public show(): void {
    const now: number = Date.now();
    if (this.shownAt !== null && now - this.shownAt < READ_ONLY_NOTICE_QUIET) {
      return;
    }
    this.shownAt = now;
    this.notifications.notify({
      severity: 'info',
      title: 'This editor is read-only',
      key: READ_ONLY_NOTICE_KEY,
      route: 'toast-only',
    });
  }
}
