import { Service, signal, Signal, WritableSignal } from '@angular/core';
import type { CategoryItem } from '@shared/angular/components/category-list/category-list';
import type { AiManagerSection } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';

/**
 * What a section puts in the AI Manager's sidebar: its list, which entry is selected, and what
 * selecting or acting on one does.
 */
export interface AiManagerSidebarList {
  /**
   * Gets the entries, already narrowed by the sidebar's search.
   */
  readonly items: Signal<readonly CategoryItem[]>;

  /**
   * Gets the id of the selected entry, or null.
   */
  readonly selectedId: Signal<string | null>;

  /**
   * Selects an entry.
   * @param id The entry's id.
   */
  select(id: string): void;

  /**
   * Acts on an entry's trailing action (a delete bin), or undefined when entries have none.
   * @param id The entry's id.
   */
  action?(id: string): void;

  /**
   * Gets what the list says when it has no entries.
   */
  readonly emptyText: Signal<string>;
}

/**
 * The AI Manager's one sidebar: a search shared by every section, and the list of whichever section
 * is shown. Only the shown section is mounted, and only its accordion is open, so one list at a time
 * is all the sidebar ever holds; the section registers it while mounted.
 */
@Service({ autoProvided: false })
export class AiManagerSidebarState {
  /**
   * Holds the registered list and the section it belongs to, or null.
   */
  private readonly listState: WritableSignal<{
    readonly section: AiManagerSection;
    readonly list: AiManagerSidebarList;
  } | null> = signal<{
    readonly section: AiManagerSection;
    readonly list: AiManagerSidebarList;
  } | null>(null);

  /**
   * Gets or sets the sidebar's search text, which every section narrows its entries by.
   */
  public readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the registered list and its section, or null.
   */
  public readonly list: Signal<{
    readonly section: AiManagerSection;
    readonly list: AiManagerSidebarList;
  } | null> = this.listState.asReadonly();

  /**
   * Puts a section's list in the sidebar.
   * @param section The section.
   * @param list The list.
   */
  public register(section: AiManagerSection, list: AiManagerSidebarList): void {
    this.listState.set({ section, list });
  }

  /**
   * Takes a section's list out of the sidebar, unless another has replaced it since.
   * @param list The list.
   */
  public unregister(list: AiManagerSidebarList): void {
    if (this.listState()?.list === list) {
      this.listState.set(null);
    }
  }
}
