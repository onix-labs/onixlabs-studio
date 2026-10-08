import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import {
  TECHNOLOGY_CATEGORIES,
  TECHNOLOGY_CATEGORY_LABELS,
  type TechnologyCategory,
} from './technology-category';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';
import { Icon } from '@shared/angular/icons/icon';
import type { Technology } from './technology-catalogue';

/**
 * How the catalogue is ordered.
 */
type TechnologySort = 'category' | 'name';

/**
 * A run of technologies under one heading.
 */
interface TechnologyGroup {
  /**
   * Gets the heading, or null for one unheaded list.
   */
  readonly label: string | null;

  /**
   * Gets the technologies, in order.
   */
  readonly technologies: readonly Technology[];
}

/**
 * Determines whether a technology matches a search: its name, an alias or its description.
 * @param technology The technology.
 * @param needle The lower-cased search.
 * @returns Returns true when it matches, or when there is nothing to search for.
 */
export function matchesTechnology(technology: Technology, needle: string): boolean {
  return (
    needle.length === 0 ||
    technology.name.toLowerCase().includes(needle) ||
    technology.aliases.some((alias: string): boolean => alias.toLowerCase().includes(needle)) ||
    technology.description.toLowerCase().includes(needle)
  );
}

/**
 * The New Project wizard's Technology step (#806): the catalogue, searched, filtered, sorted and
 * toggled. It holds only how the catalogue is being looked at; what is selected belongs to the draft.
 * A technology that is not listed is added by name, under Other, and selected.
 */
@Component({
  selector: 'app-create-technology',
  imports: [AppIcon, Checkbox, Dropdown, TooltipTrigger],
  templateUrl: './create-technology.html',
  styleUrl: './create-technology.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateTechnology {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets every technology: the catalogue and the user's local additions.
   */
  public readonly technologies: InputSignal<readonly Technology[]> =
    input.required<readonly Technology[]>();

  /**
   * Gets the ids selected.
   */
  public readonly selected: InputSignal<ReadonlySet<string>> =
    input.required<ReadonlySet<string>>();

  /**
   * Raised with a technology's id when the user toggles it.
   */
  public readonly toggled: OutputEmitterRef<string> = output<string>();

  /**
   * Raised with what the user typed when they add a technology that is not listed.
   */
  public readonly added: OutputEmitterRef<string> = output<string>();

  /**
   * Holds the search.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Holds the category shown, or empty for every one.
   */
  protected readonly category: WritableSignal<string> = signal<string>('');

  /**
   * Holds how the catalogue is ordered.
   */
  protected readonly sort: WritableSignal<TechnologySort> = signal<TechnologySort>('category');

  /**
   * Holds whether only the selected are shown.
   */
  protected readonly selectedOnly: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds what the user is typing to add.
   */
  protected readonly addition: WritableSignal<string> = signal<string>('');

  /**
   * Gets the category choices.
   */
  protected readonly categoryOptions: readonly DropdownOption[] = [
    { value: '', label: 'All categories' },
    ...TECHNOLOGY_CATEGORIES.map((id: TechnologyCategory): DropdownOption => ({
      value: id,
      label: TECHNOLOGY_CATEGORY_LABELS[id],
    })),
  ];

  /**
   * Gets the sort choices.
   */
  protected readonly sortOptions: readonly DropdownOption[] = [
    { value: 'category', label: 'By category' },
    { value: 'name', label: 'By name' },
  ];

  /**
   * Gets the technologies to show, grouped: by category, or as one list by name.
   */
  protected readonly groups: Signal<readonly TechnologyGroup[]> = computed(
    (): readonly TechnologyGroup[] => {
      const needle: string = this.query().trim().toLowerCase();
      const category: string = this.category();
      const selected: ReadonlySet<string> = this.selected();
      const shown: Technology[] = this.technologies()
        .filter(
          (technology: Technology): boolean =>
            (category === '' || technology.category === category) &&
            (!this.selectedOnly() || selected.has(technology.id)) &&
            matchesTechnology(technology, needle),
        )
        .sort((a: Technology, b: Technology): number => a.name.localeCompare(b.name));
      if (this.sort() === 'name') {
        return shown.length === 0 ? [] : [{ label: null, technologies: shown }];
      }
      return TECHNOLOGY_CATEGORIES.map((id: TechnologyCategory): TechnologyGroup => ({
        label: TECHNOLOGY_CATEGORY_LABELS[id],
        technologies: shown.filter((technology: Technology): boolean => technology.category === id),
      })).filter((group: TechnologyGroup): boolean => group.technologies.length > 0);
    },
  );

  /**
   * Gets how many are selected.
   */
  protected readonly selectedCount: Signal<number> = computed((): number => this.selected().size);

  /**
   * Updates the search from the input event.
   * @param event The input event carrying the current value.
   */
  protected onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Updates the addition from the input event.
   * @param event The input event carrying the current value.
   */
  protected onAdditionInput(event: Event): void {
    this.addition.set((event.target as HTMLInputElement).value);
  }

  /**
   * Records how the catalogue is ordered.
   * @param value The picked value.
   */
  protected setSort(value: string): void {
    this.sort.set(value === 'name' ? 'name' : 'category');
  }

  /**
   * Adds what the user typed, as a technology of their own.
   */
  protected add(): void {
    const text: string = this.addition().trim();
    if (text.length > 0) {
      this.added.emit(text);
      this.addition.set('');
    }
  }
}
