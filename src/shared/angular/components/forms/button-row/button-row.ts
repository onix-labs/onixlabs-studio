import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Names where a {@link ButtonRow} sits in its container: at the trailing edge (a dialog's or form's
 * actions), at the leading edge (a card's answer), or across the whole width.
 */
export type ButtonRowAlign = 'end' | 'start' | 'fill';

/**
 * Lays out a row of action buttons the one way Studio does it (#894): every button as wide as the
 * widest, with the primary action first and Cancel (or whatever dismisses) last.
 *
 * The width is the row's job, so it holds for any labels, in any language, and for buttons that come
 * and go behind an `@if`. The order is the template's: the row cannot know which button is primary,
 * so the buttons are written in the order they should read. Two kinds of row read in a direction
 * instead, and keep it: a wizard's Back before Next, and a composer's Edit before its Send.
 */
@Component({
  selector: 'app-button-row',
  template: '<ng-content />',
  styleUrl: './button-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    '[class.button-row--start]': "align() === 'start'",
    '[class.button-row--fill]': "align() === 'fill'",
    '[class.button-row--small]': "size() === 'small'",
  },
})
export class ButtonRow {
  /**
   * Gets where the row sits in its container: the trailing edge by default.
   */
  public readonly align: InputSignal<ButtonRowAlign> = input<ButtonRowAlign>('end');

  /**
   * Gets the size of the buttons the row holds: `small` for a toolbar's or a banner's, which drops the
   * minimum width a dialog's buttons are given.
   */
  public readonly size: InputSignal<'medium' | 'small'> = input<'medium' | 'small'>('medium');
}
