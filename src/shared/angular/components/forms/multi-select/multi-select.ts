import { CdkMenu, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  InputSignal,
  model,
  ModelSignal,
  Signal,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';
import { Icon } from '@shared/angular/icons/icon';
import { MultiSelectOption } from './multi-select-option';

/**
 * Defines a selectable option in a {@link MultiSelect}.
 */
export interface MultiSelectItem {
  /**
   * Gets the value carried in the selection when the option is ticked.
   */
  readonly value: string;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;

  /**
   * Gets a value indicating whether the option is offered but cannot be toggled.
   */
  readonly disabled?: boolean;

  /**
   * Gets an optional heading the option sits beneath. Consecutive options sharing a group are shown
   * as one run under it, as the {@link Dropdown}'s are; an ungrouped list renders as it always has.
   */
  readonly group?: string;
}

/**
 * A run of consecutive options sharing a heading.
 */
interface MultiSelectGroup {
  /**
   * Gets the heading, or undefined for options without one.
   */
  readonly label: string | undefined;

  /**
   * Gets the options, in display order.
   */
  readonly options: readonly MultiSelectItem[];
}

/**
 * Represents a multi-select dropdown: a control face that names what is ticked, opening a panel of
 * tick-box rows that stays open while several are chosen. The sibling of {@link Dropdown} for a set
 * rather than a single choice, and what a native `<select multiple>` cannot be — a listbox that reads
 * as a dropdown, with no modifier-click to discover.
 *
 * Values are exchanged as strings, in the order the options were supplied. An empty selection is a
 * legitimate state the face labels with {@link placeholder}, since callers commonly read "nothing
 * ticked" as "everything".
 */
@Component({
  selector: 'app-multi-select',
  imports: [AppIcon, CdkMenu, CdkMenuTrigger, MultiSelectOption],
  templateUrl: './multi-select.html',
  styleUrl: './multi-select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.multi-select--full]': 'fullWidth()',
  },
})
export class MultiSelect {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets where the panel opens: below the face, aligned to its start edge.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['down-start'];

  /**
   * Gets the options offered, in display order.
   */
  public readonly options: InputSignal<readonly MultiSelectItem[]> =
    input.required<readonly MultiSelectItem[]>();

  /**
   * Gets or sets the values currently ticked.
   */
  public readonly value: ModelSignal<readonly string[]> = model<readonly string[]>([]);

  /**
   * Gets the label the face shows when nothing is ticked.
   */
  public readonly placeholder: InputSignal<string> = input<string>('None');

  /**
   * Gets a value indicating whether the control is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the accessible name of the control, for a face whose visible text is the selection rather
   * than a name.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets a value indicating whether the face stretches to fill its container.
   */
  public readonly fullWidth: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the panel opens with a search field that narrows the options by
   * label or heading, for a list too long to scan.
   */
  public readonly searchable: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the search field's placeholder.
   */
  public readonly searchPlaceholder: InputSignal<string> = input<string>('Search…');

  /**
   * Holds the panel's search field, while the panel is open and searchable.
   */
  private readonly search: Signal<ElementRef<HTMLInputElement> | undefined> =
    viewChild<ElementRef<HTMLInputElement>>('search');

  /**
   * Holds the search text, cleared each time the panel opens.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the options shown, folded into runs under their headings. A search keeps the options whose
   * label or heading contains it.
   */
  protected readonly groups: Signal<readonly MultiSelectGroup[]> = computed(
    (): readonly MultiSelectGroup[] => {
      const needle: string = this.query().trim().toLowerCase();
      const groups: { label: string | undefined; options: MultiSelectItem[] }[] = [];
      for (const option of this.options()) {
        if (
          needle.length > 0 &&
          !option.label.toLowerCase().includes(needle) &&
          !(option.group ?? '').toLowerCase().includes(needle)
        ) {
          continue;
        }
        const current: { label: string | undefined; options: MultiSelectItem[] } | undefined =
          groups.at(-1);
        if (current === undefined || current.label !== option.group) {
          groups.push({ label: option.group, options: [option] });
        } else {
          current.options.push(option);
        }
      }
      return groups;
    },
  );

  /**
   * Holds the face button, measured when the panel opens so the panel is never narrower than it.
   */
  private readonly face: Signal<ElementRef<HTMLButtonElement>> =
    viewChild.required<ElementRef<HTMLButtonElement>>('face');

  /**
   * Gets whether the panel is open, which turns the caret.
   */
  protected readonly open: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the face's width in pixels as of the last open, the panel's minimum width.
   */
  protected readonly faceWidth: WritableSignal<number> = signal<number>(0);

  /**
   * Gets the text the face shows: the ticked options' labels in option order, or the placeholder.
   */
  protected readonly faceLabel: Signal<string> = computed((): string => {
    const ticked: readonly string[] = this.value();
    const labels: string[] = this.options()
      .filter((option: MultiSelectItem): boolean => ticked.includes(option.value))
      .map((option: MultiSelectItem): string => option.label);
    return labels.length === 0 ? this.placeholder() : labels.join(', ');
  });

  /**
   * Determines whether an option is ticked.
   * @param option The option.
   * @returns Returns true when its value is in the selection.
   */
  protected isTicked(option: MultiSelectItem): boolean {
    return this.value().includes(option.value);
  }

  /**
   * Ticks or unticks an option, keeping the selection in option order.
   * @param option The option toggled.
   */
  protected toggle(option: MultiSelectItem): void {
    const ticked: readonly string[] = this.value();
    const next: readonly string[] = ticked.includes(option.value)
      ? ticked.filter((value: string): boolean => value !== option.value)
      : this.options()
          .map((candidate: MultiSelectItem): string => candidate.value)
          .filter((value: string): boolean => value === option.value || ticked.includes(value));
    this.value.set(next);
  }

  /**
   * Records that the panel opened, measuring the face so the panel can match its width.
   */
  protected onOpened(): void {
    this.faceWidth.set(this.face().nativeElement.offsetWidth);
    this.query.set('');
    this.open.set(true);
    // The menu focuses its first row as it opens; a searchable panel takes focus into its field
    // instead, once that has settled, so typing searches straight away.
    if (this.searchable()) {
      setTimeout((): void => this.search()?.nativeElement.focus());
    }
  }

  /**
   * Updates the search from the field.
   * @param event The input event carrying the current value.
   */
  protected onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Keeps the field's keystrokes from the menu, whose type-ahead would otherwise take a letter typed
   * into the field as a jump to a row. Escape still closes the panel, and Down moves into the rows.
   * @param event The key event.
   */
  protected onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      return;
    }
    event.stopPropagation();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.search()
        ?.nativeElement.closest('.multi-select__panel')
        ?.querySelector<HTMLButtonElement>('.multi-select__option:not([aria-disabled="true"])')
        ?.focus();
    }
  }

  /**
   * Records that the panel closed.
   */
  protected onClosed(): void {
    this.open.set(false);
  }
}
