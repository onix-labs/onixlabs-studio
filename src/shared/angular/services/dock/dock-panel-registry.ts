import { inject, Service } from '@angular/core';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { DockPanel } from './dock-panel';

/**
 * Maps panel identifiers to the dockable panels they render, so stacks in the layout tree (which
 * hold only ids) can be projected as titled, iconified panels with real component bodies.
 */
@Service()
export class DockPanelRegistry {
  /**
   * Holds the registered panels, keyed by identifier.
   */
  private readonly panels: Map<string, DockPanel> = new Map<string, DockPanel>();

  /**
   * Initialises the registry from the host-supplied blueprint's panels. Every dock-hosting tab
   * provides a {@link DockBlueprint} (the workspace and source-control tabs each supply their own), so
   * the registry names no panel of its own; document panels are registered dynamically as they open.
   */
  public constructor() {
    const blueprint: DockBlueprint | null = inject(DOCK_BLUEPRINT, { optional: true });
    for (const panel of blueprint?.panels ?? []) {
      this.register(panel);
    }
  }

  /**
   * Registers a panel, replacing any existing registration with the same identifier.
   * @param panel The panel to register.
   */
  public register(panel: DockPanel): void {
    this.panels.set(panel.id, panel);
  }

  /**
   * Gets the panel with the given identifier.
   * @param id The identifier of the panel to resolve.
   * @returns Returns the registered panel, or undefined when none is registered.
   */
  public get(id: string): DockPanel | undefined {
    return this.panels.get(id);
  }

  /**
   * Determines whether a panel with the given identifier is registered.
   * @param id The identifier to test.
   * @returns Returns true when a panel is registered; otherwise, false.
   */
  public has(id: string): boolean {
    return this.panels.has(id);
  }
}
