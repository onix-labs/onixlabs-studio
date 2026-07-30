import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  InputSignal,
  model,
  ModelSignal,
  output,
  OutputEmitterRef,
  Signal,
  viewChild,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

/**
 * Names how a text field presents itself. `search` adds the leading glyph a filter box wants; `text`
 * is the plain field.
 */
export type TextFieldKind = 'text' | 'search';

/**
 * Represents a single-line text input field.
 *
 * It owns every measurement and state of a text box — padding, radius, border, hover, the accent it
 * takes on focus, disabled — so no call site draws its own. The keys a field is expected to answer
 * are offered as outputs rather than left to the caller to bind on a raw element: {@link enter}
 * commits what has been typed, {@link escape} abandons it.
 */
@Component({
  selector: 'app-text-field',
  imports: [AppIcon],
  templateUrl: './text-field.html',
  styleUrl: './text-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.text-field--search]': "kind() === 'search'",
  },
})
export class TextField {
  /**
   * Gets or sets the text value.
   */
  public readonly value: ModelSignal<string> = model<string>('');

  /**
   * Gets the placeholder shown when the field is empty.
   */
  public readonly placeholder: InputSignal<string> = input<string>('');

  /**
   * Gets the accessible name of the field, for a field with no visible label beside it.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets how the field presents itself: a plain box, or a search box with its leading glyph.
   */
  public readonly kind: InputSignal<TextFieldKind> = input<TextFieldKind>('text');

  /**
   * Gets a value indicating whether the field is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emitted when Enter is pressed in the field — the key that commits what has been typed.
   */
  public readonly enter: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when Escape is pressed in the field — the key that abandons what has been typed.
   */
  public readonly escape: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when the field loses focus, for a caller that commits on blur.
   */
  public readonly blurred: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the search glyph, exposed for the template.
   */
  protected readonly searchIcon: Icon = Icon.SEARCH;

  /**
   * Holds the underlying control, so the field can be focused by its caller.
   */
  private readonly control: Signal<ElementRef<HTMLInputElement> | undefined> =
    viewChild<ElementRef<HTMLInputElement>>('control');

  /**
   * Moves focus to the field and selects what it holds, for a caller that opens straight into it.
   */
  public focus(): void {
    const element: HTMLInputElement | undefined = this.control()?.nativeElement;
    element?.focus();
    element?.select();
  }

  /**
   * Handles input on the underlying control, updating the {@link value} model on each keystroke.
   * @param event The DOM input event raised by the input.
   */
  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
