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

/**
 * Names how a multi-line field is drawn.
 *
 * - `boxed` — the field draws its own background, border and radius, the same chrome the single-line
 *   field wears. The default, and right wherever the field sits on a plain surface.
 * - `seamless` — the field draws no chrome at all, for a composer card that has already drawn the box
 *   and lit its own border on focus. Drawn chrome here would box the field twice.
 */
export type TextareaVariant = 'boxed' | 'seamless';

/**
 * Represents a multi-line text input: the sibling of {@link import('../text-field/text-field').TextField},
 * and the only way a multi-line box is drawn in the application.
 *
 * It owns the same chrome its single-line sibling does, so the two agree. Callers that need to react
 * to typing beyond the value itself — a composer that grows with its content, or one that accepts
 * pasted images — take the underlying element through {@link element} rather than reaching for a raw
 * `<textarea>` of their own.
 *
 * A composer card that draws its own box asks for {@link variant} `seamless` rather than unpicking
 * this chrome from the outside: how the field is drawn is the atom's business, and a call site that
 * overrode it through the cascade would be a second opinion waiting to drift.
 */
@Component({
  selector: 'app-textarea',
  imports: [],
  templateUrl: './textarea.html',
  styleUrl: './textarea.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Textarea {
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
   * Gets the number of visible text lines the field opens at.
   */
  public readonly rows: InputSignal<number> = input<number>(4);

  /**
   * Gets how the field is drawn.
   */
  public readonly variant: InputSignal<TextareaVariant> = input<TextareaVariant>('boxed');

  /**
   * Gets a value indicating whether the field is held to exactly {@link rows} lines, scrolling
   * internally past them, with no resize grip.
   *
   * Off by default, because an ordinary field should give as much room as it is dragged to. On for a
   * composer whose height must not move: a box that grows with what has been typed into it disturbs
   * everything laid out around it, and reads wrong beside a neighbour that has been typed into less.
   */
  public readonly fixedHeight: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the field is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emitted on every key press, for a caller with its own key handling (a composer's submit chord,
   * a suggestion list's navigation). The event is not consumed here.
   */
  public readonly keyDown: OutputEmitterRef<KeyboardEvent> = output<KeyboardEvent>();

  /**
   * Emitted when content is pasted into the field, for a caller that accepts more than text.
   */
  public readonly pasted: OutputEmitterRef<ClipboardEvent> = output<ClipboardEvent>();

  /**
   * Emitted when the field loses focus.
   */
  public readonly blurred: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the underlying control.
   */
  private readonly control: Signal<ElementRef<HTMLTextAreaElement> | undefined> =
    viewChild<ElementRef<HTMLTextAreaElement>>('control');

  /**
   * Gets the underlying element, for a caller that measures or resizes it.
   * @returns Returns the element, or null before the view has rendered.
   */
  public element(): HTMLTextAreaElement | null {
    return this.control()?.nativeElement ?? null;
  }

  /**
   * Moves focus to the field.
   */
  public focus(): void {
    this.control()?.nativeElement.focus();
  }

  /**
   * Handles input on the underlying control, updating the {@link value} model on each keystroke.
   * @param event The DOM input event raised by the control.
   */
  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLTextAreaElement).value);
  }
}
