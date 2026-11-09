import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { InputSignal, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Names what an {@link Alert} is telling the reader, which sets its colour and its icon.
 */
export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * Holds the icon each tone is drawn with, so an alert reads by its shape as well as by its colour.
 */
const TONE_ICONS: Readonly<Record<AlertTone, Icon>> = {
  info: Icon.INFO_FILL,
  success: Icon.SUCCESS_FILL,
  warning: Icon.WARNING_FILL,
  danger: Icon.ERROR_FILL,
};

/**
 * States something the reader should know before going on: a tinted box with an icon, the one way
 * Studio raises a warning, an error or a note inside a dialog or a panel. The message is projected.
 */
@Component({
  selector: 'app-alert',
  imports: [AppIcon],
  template: `
    <app-icon class="alert__icon" [icon]="icon()" aria-hidden="true" />
    <div class="alert__message"><ng-content /></div>
  `,
  styleUrl: './alert.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': "tone() === 'danger' ? 'alert' : 'status'",
    '[class.alert--info]': "tone() === 'info'",
    '[class.alert--success]': "tone() === 'success'",
    '[class.alert--warning]': "tone() === 'warning'",
    '[class.alert--danger]': "tone() === 'danger'",
  },
})
export class Alert {
  /**
   * Gets what the alert is telling the reader.
   */
  public readonly tone: InputSignal<AlertTone> = input<AlertTone>('info');

  /**
   * Gets the icon drawn for the tone.
   */
  protected readonly icon: Signal<Icon> = computed((): Icon => TONE_ICONS[this.tone()]);
}
