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
   * Gets the stable key this dock's layout is persisted under (`dock.layout.<key>`), so a rearranged
   * layout is restored on the next session. Distinct per blueprint kind (for example `workspace` and
   * `source-control`), so each kind remembers its own arrangement. Absent for ephemeral docks — a
   * pop-out window's — whose layout is never persisted.
   */
  readonly key?: string;

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

  /**
   * Gets the identifiers of the panels the view declares in its own template (see
   * {@link import('../../components/dock-layout/dock-template-panel/dock-template-panel').DockTemplatePanel}),
   * so a layout may hold them before they are declared. Absent when it declares none.
   */
  readonly templatePanels?: readonly string[];

  /**
   * Gets the identifiers of the tool panels open when the dock opens, for a dock that keeps its closed
   * panels' places (#1568). Its layout holds every panel where it goes, open or not: closing one hides it
   * there, and opening it shows it there again. What is saved is then where panels go and not which are
   * open, and only rearranging saves it, so a dock opens as the one last rearranged was arranged, with
   * these panels open.
   *
   * Absent for a dock whose layout holds only the panels that are open, where closing one removes it.
   */
  readonly startsOpen?: readonly string[];
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
