import { InjectionToken } from '@angular/core';
import { DockNode } from './dock-node';
import { DockPanel } from './dock-panel';

/**
 * Describes the host-supplied configuration that specialises a dock instance for a particular kind of
 * tab: the panels it can show and the layout it starts (and resets) with. A workspace tab and a
 * source-control tab provide different blueprints to the same dock framework, so the container,
 * nodes, splitters, drag, floating, and document well are all reused unchanged.
 *
 * The blueprint is optional: when none is provided the dock falls back to the built-in workspace
 * default (the File Explorer / document well / Output / Error List / Agent arrangement), so existing
 * workspace tabs and the dock's own tests need no blueprint.
 */
export interface DockBlueprint {
  /**
   * Builds a fresh layout tree for the dock to start with and reset to. Called once per dock instance
   * and again on every reset, so it must mint a new tree each time.
   * @returns Returns a fresh layout tree.
   */
  createLayout(): DockNode;

  /**
   * Gets the panels the dock can project, seeded into the panel registry. Document panels (such as
   * open files or diffs) are still registered dynamically as they open.
   */
  readonly panels: readonly DockPanel[];
}

/**
 * Injects the {@link DockBlueprint} that specialises a dock instance. Provided by a dock-hosting tab
 * (alongside the dock services) and read by {@link import('./dock-state').DockState} and
 * {@link import('./dock-panel-registry').DockPanelRegistry}. Absent for the workspace tab, which uses
 * the built-in default.
 */
export const DOCK_BLUEPRINT: InjectionToken<DockBlueprint> = new InjectionToken<DockBlueprint>(
  'DOCK_BLUEPRINT',
);
