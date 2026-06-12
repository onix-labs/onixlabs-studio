import { Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Describes an entry shown in the welcome screen's recent-items list.
 */
export interface RecentItem {
  /**
   * Gets the stable identifier of the recent item.
   */
  readonly id: string;

  /**
   * Gets the display name of the recent item (typically a file or directory name).
   */
  readonly name: string;

  /**
   * Gets a secondary line shown beneath the name, such as a containing path.
   */
  readonly detail: string;

  /**
   * Gets the Tabler icon class used to represent the item.
   */
  readonly icon: string;
}

/**
 * Represents the registry of recently opened items surfaced on the welcome screen.
 *
 * This is currently a stub: it exposes an empty, observable list and the mutation surface a future
 * file-open flow will call. Real persistence is deferred until opening files lands.
 */
@Service()
export class RecentItems {
  /**
   * Holds the backing state for {@link items}.
   */
  private readonly itemsState: WritableSignal<readonly RecentItem[]> = signal<
    readonly RecentItem[]
  >([]);

  /**
   * Gets the recent items, most recent first.
   */
  public readonly items: Signal<readonly RecentItem[]> = this.itemsState.asReadonly();

  /**
   * Records an item as the most recently used, de-duplicating by identifier.
   * @param item The item to record.
   */
  public add(item: RecentItem): void {
    this.itemsState.update((current: readonly RecentItem[]): readonly RecentItem[] => [
      item,
      ...current.filter((existing: RecentItem): boolean => existing.id !== item.id),
    ]);
  }

  /**
   * Clears all recent items.
   */
  public clear(): void {
    this.itemsState.set([]);
  }
}
