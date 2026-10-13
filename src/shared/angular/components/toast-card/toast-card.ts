import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button, ButtonTone } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { severityIcon } from '@shared/angular/icons/severity-icon';
import type {
  Notification,
  NotificationAction,
  NotificationSeverity,
} from '@shared/angular/services/notifications/notifications';

/**
 * One notification drawn as a card: its severity icon, title, close button, detail and actions, in
 * the severity's colour. THE notification card, used by the toast stack and the notification tray
 * alike, so a notification looks the same wherever it is seen.
 *
 * It only reports what the user did; the surface decides what dismissing or acting means there.
 */
@Component({
  selector: 'app-toast-card',
  imports: [AppIcon, Button],
  templateUrl: './toast-card.html',
  styleUrl: './toast-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'toast',
    '[class.toast--info]': "notification().severity === 'info'",
    '[class.toast--success]': "notification().severity === 'success'",
    '[class.toast--warning]': "notification().severity === 'warning'",
    '[class.toast--error]': "notification().severity === 'error'",
    '[class.toast--plain]': 'plain()',
    '[attr.role]': "notification().severity === 'error' ? 'alert' : 'status'",
  },
})
export class ToastCard {
  /**
   * Gets the notification to draw.
   */
  public readonly notification: InputSignal<Notification> = input.required<Notification>();

  /**
   * Gets whether the card is drawn in the app's greys rather than its severity's colour, for a
   * notification that is not the newest when only the newest is coloured. Its role is unchanged.
   */
  public readonly plain: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the close button's accessible verb, which differs by surface ("Dismiss" in the stack,
   * "Remove" in the tray).
   */
  public readonly closeVerb: InputSignal<string> = input<string>('Dismiss');

  /**
   * Emits when the close button is pressed.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the action whose button was pressed.
   */
  public readonly acted: OutputEmitterRef<NotificationAction> = output<NotificationAction>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the icon for a severity.
   * @param severity The severity.
   * @returns Returns the icon.
   */
  protected iconFor(severity: NotificationSeverity): Icon {
    return severityIcon(severity);
  }

  /**
   * Gets the button tone for a severity.
   * @param severity The severity.
   * @returns Returns the tone.
   */
  protected toneFor(severity: NotificationSeverity): ButtonTone {
    if (this.plain()) {
      return 'neutral';
    }
    return severity === 'error' ? 'danger' : severity;
  }
}
