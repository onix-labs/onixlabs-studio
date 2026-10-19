import { Service, signal, Signal, WritableSignal } from '@angular/core';
import type { ReferenceList } from '@shared/angular/services/references/reference-list';

/**
 * Holds the list a workspace's References panel shows (#1014): the latest search's, which replaces the
 * last. Provided per workspace view, beside the panel's other per-view services, so the list outlives
 * the panel — a dock panel is destroyed when another tool in its stack comes forward, and the list is
 * still there when it comes back.
 */
@Service()
export class ReferencesPanelState {
  /**
   * Holds the list, or null before the first search.
   */
  private readonly listState: WritableSignal<ReferenceList | null> = signal<ReferenceList | null>(
    null,
  );

  /**
   * Gets the list, or null before the first search.
   */
  public readonly list: Signal<ReferenceList | null> = this.listState.asReadonly();

  /**
   * Shows a list, replacing the one shown.
   * @param list The list.
   */
  public show(list: ReferenceList): void {
    this.listState.set(list);
  }
}
