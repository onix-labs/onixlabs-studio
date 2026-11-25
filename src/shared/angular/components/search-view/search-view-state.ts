import { signal, WritableSignal } from '@angular/core';
import type { FindRequest } from '@shared/angular/components/find-panel/find-request';

/**
 * Identifies which form the search view shows.
 */
export type SearchViewMode = 'find' | 'replace';

/**
 * What a search view holds of a search: what was typed, what was searched for and which form is showing.
 * A view has its own, unless its host keeps one for it so the search outlives the view — a panel of a
 * dock is drawn afresh whenever it moves or comes back from behind another tab.
 */
export class SearchViewState {
  /**
   * Holds the form asked for; forced to find where nothing can be replaced.
   */
  public readonly mode: WritableSignal<SearchViewMode> = signal<SearchViewMode>('find');

  /**
   * Holds the text in the find field.
   */
  public readonly draft: WritableSignal<string> = signal<string>('');

  /**
   * Holds the replacement text in the replace form's field.
   */
  public readonly replacement: WritableSignal<string> = signal<string>('');

  /**
   * Holds the text last searched for, or null before any search.
   */
  public readonly searched: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the find request last answered, or null before the first.
   */
  public answered: FindRequest | null = null;

  /**
   * Holds the host's revision last searched at, or null before the first.
   */
  public revision: number | null = null;

  /**
   * Forgets the search.
   */
  public reset(): void {
    this.mode.set('find');
    this.draft.set('');
    this.replacement.set('');
    this.searched.set(null);
    this.answered = null;
    this.revision = null;
  }
}
