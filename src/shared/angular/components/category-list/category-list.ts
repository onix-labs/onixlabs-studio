import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  model,
  ModelSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';
import { Icon } from '@shared/angular/icons/icon';

/**
 * One entry of a {@link CategoryList}.
 */
export interface CategoryItem {
  /**
   * Gets the identifier emitted when the entry is chosen.
   */
  readonly id: string;

  /**
   * Gets the label shown.
   */
  readonly label: string;

  /**
   * Gets the icon shown before the label.
   */
  readonly icon: Icon;

  /**
   * Gets the count shown at the end of the entry, or null for none.
   */
  readonly count?: number | null;

  /**
   * Gets whether the entry sits beneath the one before it, indented one step.
   */
  readonly nested?: boolean;

  /**
   * Gets whether a divider separates the entry from the group before it (#949).
   */
  readonly dividerBefore?: boolean;

  /**
   * Gets whether the entry is listed but cannot be chosen, such as Local Models' Loaded while
   * nothing is in memory (#949).
   */
  readonly disabled?: boolean;

  /**
   * Gets whether the entry is shown dimmed, such as a prompt profile that is switched off.
   */
  readonly muted?: boolean;

  /**
   * Gets an icon shown at the end of the entry in place of a count, such as a warning on a skill
   * that cannot be offered, or null for none.
   */
  readonly badge?: Icon | null;

  /**
   * Gets the badge's tooltip and accessible name.
   */
  readonly badgeLabel?: string;

  /**
   * Gets the icon of a small button at the end of the entry, such as a bin that deletes it, or null
   * for none. It shows while the entry is hovered, focused or selected, and reports through
   * {@link CategoryList.actionClick} without choosing the entry.
   */
  readonly action?: Icon | null;

  /**
   * Gets the action button's tooltip and accessible name.
   */
  readonly actionLabel?: string;
}

/**
 * The list a tool's side panel shows (#949): an optional search field, a small uppercase title, and a
 * column of entries — each an icon, a label and an optional count or badge, one of them selected.
 * Entries can be grouped with dividers, nested, dimmed, or listed but disabled. The entries are the
 * shared {@link ListView}'s rows (#954), so they select, hover and take the keyboard as every other
 * list in Studio does. The Plugin Manager lists its filters in it and the AI Manager its models,
 * profiles and skills (#948).
 */
@Component({
  selector: 'app-category-list',
  imports: [AppIcon, ListView, TextField, TooltipTrigger],
  templateUrl: './category-list.html',
  styleUrl: './category-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryList {
  /**
   * Gets the title shown above the entries, or empty for none.
   */
  public readonly title: InputSignal<string> = input<string>('');

  /**
   * Gets whether a search field is shown above the entries. The list does not filter itself: the
   * owner reads {@link query} and decides what the entries, or the main area, show.
   */
  public readonly searchable: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the search field's placeholder and accessible name.
   */
  public readonly searchPlaceholder: InputSignal<string> = input<string>('Search…');

  /**
   * Gets or sets the search text.
   */
  public readonly query: ModelSignal<string> = model<string>('');

  /**
   * Gets the entries, in the order shown.
   */
  public readonly items: InputSignal<readonly CategoryItem[]> =
    input.required<readonly CategoryItem[]>();

  /**
   * Gets what the list says when it has no entries, or empty to say nothing.
   */
  public readonly emptyText: InputSignal<string> = input<string>('');

  /**
   * Gets the identifier of the selected entry, or null when none is.
   */
  public readonly selectedId: InputSignal<string | null> = input<string | null>(null);

  /**
   * Emits the identifier of the entry chosen.
   */
  public readonly selectedIdChange: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the identifier of the entry whose action button was pressed.
   */
  public readonly actionClick: OutputEmitterRef<string> = output<string>();

  /**
   * Gets the entries as the shared list's rows, carrying whether each is disabled or opens a group.
   */
  protected readonly rows: Signal<readonly ListRow[]> = computed((): readonly ListRow[] =>
    this.items().map((item: CategoryItem): ListRow => ({
      id: item.id,
      data: item,
      disabled: item.disabled === true,
      dividerBefore: item.dividerBefore === true,
    })),
  );

  /**
   * Reads a row's entry.
   * @param row The row.
   * @returns Returns the entry.
   */
  protected itemOf(row: ListRow): CategoryItem {
    return row.data as CategoryItem;
  }
}
