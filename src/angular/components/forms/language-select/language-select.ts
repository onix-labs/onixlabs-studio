import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';

/**
 * Represents a multi-select of Monaco language identifiers, backed by a native multiple-select.
 */
@Component({
  selector: 'app-language-select',
  imports: [],
  templateUrl: './language-select.html',
  styleUrl: './language-select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSelect {
  /**
   * Gets the language identifiers offered by the select.
   */
  public readonly languages: InputSignal<readonly string[]> = input.required<readonly string[]>();

  /**
   * Gets or sets the selected language identifiers.
   */
  public readonly value: ModelSignal<readonly string[]> = model<readonly string[]>([]);

  /**
   * Gets a value indicating whether the select is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Handles a change on the underlying select, collecting the selected options into the model.
   * @param event The DOM change event raised by the select.
   */
  protected onChange(event: Event): void {
    const select: HTMLSelectElement = event.target as HTMLSelectElement;
    this.value.set(
      Array.from(select.selectedOptions).map((option: HTMLOptionElement): string => option.value),
    );
  }
}
