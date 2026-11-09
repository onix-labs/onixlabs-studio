import { Service, signal, Signal, WritableSignal } from '@angular/core';
import type { HierarchySource } from '@shared/angular/services/hierarchy/hierarchy';

/**
 * Holds the hierarchy a workspace tab's Hierarchy panel shows (#1153). Provided per directory view, so
 * each tab's panel shows the hierarchy asked for in that tab.
 */
@Service()
export class HierarchyPanelState {
  /**
   * Holds the hierarchy shown, or null before one is asked for.
   */
  private readonly sourceState: WritableSignal<HierarchySource | null> =
    signal<HierarchySource | null>(null);

  /**
   * Gets the hierarchy shown, or null before one is asked for.
   */
  public readonly source: Signal<HierarchySource | null> = this.sourceState.asReadonly();

  /**
   * Shows a hierarchy, replacing the one shown.
   * @param source The hierarchy.
   */
  public show(source: HierarchySource): void {
    this.sourceState.set(source);
  }
}
