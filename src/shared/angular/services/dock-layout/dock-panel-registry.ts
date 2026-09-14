import { inject, Service, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { DockPanel } from './dock-panel';

/**
 * The parts of a registered panel that can change after registration: what its tab shows. A well
 * document's file can be renamed while it is open, and its tab must follow the file.
 */
export type DockPanelPatch = Partial<Pick<DockPanel, 'title' | 'icon' | 'ownsToolStrip'>>;

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
   * Tracks changes to {@link panels}. The map is not reactive, yet the dock chrome resolves panels
   * inside computeds keyed on the layout — which does not change when a registration does. Reading
   * this from {@link get} lets those computeds re-run when a panel is registered, replaced or
   * patched, so a retitled document tab repaints without a layout change to prompt it.
   */
  private readonly version: WritableSignal<number> = signal<number>(0);

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
    this.version.update((current: number): number => current + 1);
  }

  /**
   * Changes what a registered panel's tab shows — its title, icon or tool-strip ownership — leaving
   * the component and close handling as registered. Unknown identifiers are a no-op, so a caller
   * that follows a file (a document model retitling its well tab) need not know whether the file
   * is hosted here.
   * @param id The identifier of the panel to patch.
   * @param patch The fields to change.
   */
  public update(id: string, patch: DockPanelPatch): void {
    const existing: DockPanel | undefined = this.panels.get(id);
    if (existing === undefined) {
      return;
    }
    this.log.debug('DockPanelRegistry', `Updated panel '${id}'`, patch);
    this.panels.set(id, { ...existing, ...patch });
    this.version.update((current: number): number => current + 1);
  }

  /**
   * Gets every registered panel, in registration order — the blueprint's catalogue first, then
   * whatever registered dynamically after it (a document as it opens, a panel a view adds on demand).
   * A snapshot array, but one whose read tracks the registry, so a computed enumerating it re-runs
   * when a registration changes.
   * @returns Returns the registered panels.
   */
  public list(): readonly DockPanel[] {
    this.version();
    return [...this.panels.values()];
  }

  /**
   * Gets the panel with the given identifier. Reactive: a computed that resolves a panel by id
   * re-runs when that registration is replaced or patched.
   * @param id The identifier of the panel to resolve.
   * @returns Returns the registered panel, or undefined when none is registered.
   */
  public get(id: string): DockPanel | undefined {
    this.version();
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
