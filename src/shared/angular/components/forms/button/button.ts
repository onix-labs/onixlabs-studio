import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

/**
 * Names how a button is drawn. This is its SHAPE, not its meaning: every variant is accented, and
 * the tones that carry meaning (danger, warning, success) are a separate axis still to come — adding
 * them must not disturb these.
 *
 * - `solid` — filled with the accent. The affirmative action of a pair, and never more than one in a
 *   group.
 * - `outline` — bordered, transparent until hovered. The standard button, and the counterpart to a
 *   solid one (Cancel beside Clear).
 * - `none` — neither border nor fill until hovered. Tool strips, ribbon strips and panel toolbars,
 *   where a row of buttons would otherwise read as a wall of boxes.
 */
export type ButtonVariant = 'solid' | 'outline' | 'none';

/**
 * Represents the application's button: THE button, used everywhere a button is used.
 *
 * Nothing else may hand-roll one, and no call site may restyle one — a caller chooses a
 * {@link variant} and supplies content, and every measurement (padding, radius, corner shape, gap,
 * hover, disabled) belongs here. The button styling in the application drifted apart precisely
 * because each surface drew its own; this component exists so that cannot happen again.
 *
 * Its shape follows its content rather than a flag: a button given a visible {@link label} is padded
 * for text, and one given only an {@link icon} is square. There is no way for the two to disagree.
 */
@Component({
  selector: 'app-button',
  imports: [AppIcon],
  templateUrl: './button.html',
  styleUrl: './button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.button--solid]': "variant() === 'solid'",
    '[class.button--outline]': "variant() === 'outline'",
    '[class.button--none]': "variant() === 'none'",
    '[class.button--icon-only]': 'isIconOnly()',
  },
})
export class Button {
  /**
   * Gets how the button is drawn. The standard button is bordered; a caller states otherwise for the
   * affirmative action of a pair, or for a button living in a strip.
   */
  public readonly variant: InputSignal<ButtonVariant> = input<ButtonVariant>('outline');

  /**
   * Gets the button's visible text. Omitted for an icon-only button, which must then carry an
   * {@link ariaLabel} instead.
   */
  public readonly label: InputSignal<string> = input<string>('');

  /**
   * Gets the glyph shown before the label, or as the whole button when there is no label.
   */
  public readonly icon: InputSignal<Icon | undefined> = input<Icon>();

  /**
   * Gets the accessible name, for a button whose label is a glyph. When absent the visible label
   * names the button, as it should.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the tooltip shown on hover, which an icon-only button generally wants.
   */
  public readonly tooltip: InputSignal<string | undefined> = input<string>();

  /**
   * Gets a value indicating whether the button is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the native button type. Buttons inside a form default to submitting it, which is almost
   * never what a caller means, so this defaults to a plain button.
   */
  public readonly type: InputSignal<'button' | 'submit' | 'reset'> = input<
    'button' | 'submit' | 'reset'
  >('button');

  /**
   * Gets a value indicating whether the button is drawn as a square glyph rather than padded for
   * text. Derived from the content — a glyph and no label — so the shape can never contradict what
   * the button actually shows.
   */
  protected readonly isIconOnly: Signal<boolean> = computed(
    (): boolean => this.icon() !== undefined && this.label().length === 0,
  );
}
