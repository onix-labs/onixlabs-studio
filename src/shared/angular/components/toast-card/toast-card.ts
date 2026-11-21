import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
  signal,
  WritableSignal,
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
 * How long, in milliseconds, a command's copy button shows its tick after a successful copy.
 */
const COPIED_FEEDBACK_MS: number = 1500;

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
   * Gets whether the card offers Don't Show Again (#1487): for a kind of notification that still pops
   * up. The surface decides, since the card does not know the user's choices.
   */
  public readonly silenceable: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets whether the card offers Notification Settings, to find its kind in Settings.
   */
  public readonly configurable: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when Don't Show Again is pressed.
   */
  public readonly silenced: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when Notification Settings is pressed.
   */
  public readonly configured: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the Copy button's label for a suggested command.
   */
  protected readonly copyLabel: string = $localize`:Button that copies a suggested command from a notification:Copy Command`;

  /**
   * Gets the Copy button's label once the command is on the clipboard.
   */
  protected readonly copiedLabel: string = $localize`:Shown on a notification's copy button once the command has been copied:Copied`;

  /**
   * Gets the label of the button that reveals a tool's own output.
   */
  protected readonly showDetailsLabel: string = $localize`:Button on a notification that reveals the tool's own output:Show Details`;

  /**
   * Gets the label of the button that hides it again.
   */
  protected readonly hideDetailsLabel: string = $localize`:Button on a notification that hides the tool's own output again:Hide Details`;

  /**
   * Holds the command last copied, which shows a tick for a moment, or null.
   */
  private readonly copied: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the command last copied, or null.
   */
  protected readonly copiedCommand: Signal<string | null> = this.copied.asReadonly();

  /**
   * Holds whether the tool's own output is shown.
   */
  private readonly shown: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the tool's own output is shown.
   */
  protected readonly detailsShown: Signal<boolean> = this.shown.asReadonly();

  /**
   * Holds the timer that clears the copied tick, so a second copy restarts it.
   */
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialises a new instance, clearing the copied tick's timer when the card goes.
   */
  public constructor() {
    inject(DestroyRef).onDestroy((): void => {
      if (this.copiedTimer !== null) {
        clearTimeout(this.copiedTimer);
      }
    });
  }

  /**
   * Copies a suggested command to the clipboard, ticking its button when it worked.
   * @param command The command.
   * @returns Returns a promise that resolves once the copy has been tried.
   */
  protected async copy(command: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Nothing copied, so nothing ticks; the command is still there to select by hand.
      return;
    }
    this.copied.set(command);
    if (this.copiedTimer !== null) {
      clearTimeout(this.copiedTimer);
    }
    this.copiedTimer = setTimeout((): void => {
      this.copied.set(null);
      this.copiedTimer = null;
    }, COPIED_FEEDBACK_MS);
  }

  /**
   * Shows or hides the tool's own output.
   */
  protected toggleDetails(): void {
    this.shown.update((shown: boolean): boolean => !shown);
  }

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
