import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
  viewChild,
} from '@angular/core';

/**
 * Defines a selectable option in a {@link Dropdown}.
 */
export interface DropdownOption {
  /**
   * Gets the value applied when the option is selected.
   */
  readonly value: string;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;

  /**
   * Gets an optional CSS colour shown as a small chip before the label (for colour pickers). Options
   * without a colour render label-only, so this is backward-compatible with plain dropdowns.
   */
  readonly color?: string;

  /**
   * Gets a value indicating whether the option is offered but cannot be selected.
   */
  readonly disabled?: boolean;
}

/**
 * Represents a single-select dropdown, backed by a native select for accessibility. Values are
 * exchanged as strings; callers map them to their own union types.
 *
 * The control is controlled: it displays whatever {@link value} supplies and reports picks through
 * {@link valueChange} without adopting them itself. This lets a parent clamp or reject a pick — the
 * native select is re-asserted to {@link value} after each render, so a pick the parent does not
 * adopt cannot leave it stuck (`[selected]` alone cannot correct this once the select is dirty).
 */
@Component({
  selector: 'app-dropdown',
  imports: [],
  templateUrl: './dropdown.html',
  styleUrl: './dropdown.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.dropdown--full]': 'fullWidth()',
  },
})
export class Dropdown {
  /**
   * Gets the options offered by the dropdown.
   */
  public readonly options: InputSignal<readonly DropdownOption[]> =
    input.required<readonly DropdownOption[]>();

  /**
   * Gets the selected value.
   */
  public readonly value: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the dropdown is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the accessible name applied to the underlying select when there is no visible label.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets a value indicating whether the dropdown stretches to fill its container's width rather than
   * sizing to its own content.
   */
  public readonly fullWidth: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits the newly picked value when the selection changes.
   */
  public readonly valueChange: OutputEmitterRef<string> = output<string>();

  /**
   * Holds the underlying native select element.
   */
  private readonly select: Signal<ElementRef<HTMLSelectElement>> =
    viewChild.required<ElementRef<HTMLSelectElement>>('select');

  /**
   * Gets the selected option's label, shown in the control's face. Rendered by the component
   * rather than mirrored by the browser, so the face stays a single ellipsized line.
   */
  protected readonly selectedLabel: Signal<string> = computed((): string => {
    const value: string = this.value();
    return (
      this.options().find((option: DropdownOption): boolean => option.value === value)?.label ?? ''
    );
  });

  /**
   * Gets the selected option's colour chip, shown in the control's face for colour options, or
   * undefined when the selected option carries no colour.
   */
  protected readonly selectedColor: Signal<string | undefined> = computed(
    (): string | undefined => {
      const value: string = this.value();
      return this.options().find((option: DropdownOption): boolean => option.value === value)
        ?.color;
    },
  );

  /**
   * Reflects {@link value} onto the native select after each render so the displayed option stays in
   * sync — both on first render (before any user interaction) and after a pick the parent declines to
   * adopt, which would otherwise leave the dirty select stuck on the rejected option.
   */
  public constructor() {
    afterRenderEffect((): void => {
      const element: HTMLSelectElement = this.select().nativeElement;
      if (element.value !== this.value()) {
        element.value = this.value();
      }
    });
  }

  /**
   * Handles a change on the underlying select, reporting the picked value to the parent and snapping
   * the native select back to {@link value}. A native `change` sets the select's dirty value flag,
   * which no signal tracks, so the re-assert here covers the case the parent declines the pick; if it
   * adopts, the updated {@link value} input re-asserts the new selection on the next render.
   * @param event The DOM change event raised by the select.
   */
  protected onChange(event: Event): void {
    const select: HTMLSelectElement = event.target as HTMLSelectElement;
    this.valueChange.emit(select.value);
    select.value = this.value();
  }
}
