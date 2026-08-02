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
 * Names how a button is drawn. This is its SHAPE, not its meaning: the meaning a button carries lives
 * on the separate {@link ButtonTone} axis, so any variant can wear any tone without the two disturbing
 * each other.
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
 * Names the MEANING a button carries, the axis {@link ButtonVariant} deliberately leaves out. Tone
 * colours the button — the accent by default, or one of the fixed state colours — without touching its
 * shape, so any {@link ButtonVariant} can wear any tone: a `solid` `danger` is a filled red button, a
 * `none` `danger` a quiet one whose glyph simply reads red.
 *
 * - `accent` — the active accent. The default, and what every button was before tones existed.
 * - `success` / `warning` / `danger` / `info` — the semantic state colours, for an action whose
 *   meaning (a destructive Stop, a confirming Save) should read before it is hovered.
 */
export type ButtonTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Names how large a button is drawn. Size is a separate axis from {@link ButtonVariant}: any variant
 * can be either size.
 *
 * - `medium` — the standard button, sized for a dialog's action row.
 * - `small` — dense chrome: the quiet affordances revealed on a hovered row, and the remove controls
 *   on a chip. Big enough to hit, small enough not to dominate what it acts on.
 */
export type ButtonSize = 'medium' | 'small';

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
    '[class.button--tone-success]': "tone() === 'success'",
    '[class.button--tone-warning]': "tone() === 'warning'",
    '[class.button--tone-danger]': "tone() === 'danger'",
    '[class.button--tone-info]': "tone() === 'info'",
    '[class.button--small]': "size() === 'small'",
    '[class.button--icon-only]': 'isIconOnly()',
    '[class.button--pressed]': 'pressed() === true',
  },
})
export class Button {
  /**
   * Gets how the button is drawn. The standard button is bordered; a caller states otherwise for the
   * affirmative action of a pair, or for a button living in a strip.
   */
  public readonly variant: InputSignal<ButtonVariant> = input<ButtonVariant>('outline');

  /**
   * Gets the meaning the button carries, which colours it. Defaults to the accent, so an ordinary
   * button is unchanged; a caller states a state tone for an action whose meaning should read at a
   * glance (a destructive `danger`, a confirming `success`).
   */
  public readonly tone: InputSignal<ButtonTone> = input<ButtonTone>('accent');

  /**
   * Gets how large the button is drawn. Dense chrome — a row's hover affordances, a chip's remove
   * control — states `small`; everything else is the standard size.
   */
  public readonly size: InputSignal<ButtonSize> = input<ButtonSize>('medium');

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
   * Gets the clockwise rotation of the {@link icon} in degrees, for a glyph whose meaning depends on
   * which way it points (the dock's auto-hide arrow, which faces the edge it collapses towards). The
   * button owns its glyph, so a caller states the rotation here rather than reaching into the icon.
   */
  public readonly iconRotation: InputSignal<number> = input<number>(0);

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
   * Gets whether a TOGGLE button is currently on, or undefined for an ordinary button that does not
   * hold a state. A toggle announces itself with `aria-pressed` and, while on, wears the same accent
   * surface it takes on hover — so a filter or layout switch reads as engaged rather than as merely
   * pointed at.
   */
  public readonly pressed: InputSignal<boolean | undefined> = input<boolean>();

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
