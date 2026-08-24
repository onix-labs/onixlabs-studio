import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
    this.log.debug('DockPanelRegistry', `Registered panel '${panel.id}'`, panel.role);
    this.panels.set(panel.id, panel);
  }

  /**
   * Gets every registered panel, in registration order — the blueprint's catalogue first, then
   * whatever registered dynamically after it (a document as it opens, a panel a view adds on demand).
   * Deliberately a snapshot rather than a signal: the registry is seeded once per view and the callers
   * that enumerate it (the menu's panel list) recompute from the layout, which is signal-backed.
   * @returns Returns the registered panels.
   */
  public list(): readonly DockPanel[] {
    return [...this.panels.values()];
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
