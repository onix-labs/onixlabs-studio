import { Type } from '@angular/core';
import { StackRole } from './dock-node';

/**
 * Describes a dockable panel: the metadata the dock chrome renders (title, icon, role) and the
 * component projected into the panel body. Every panel component receives the {@link DockPanel} as
 * its `panel` input, so the {@link import('./dock-panel-registry').DockPanelRegistry} outlet can
 * project any registered component uniformly.
 */
export interface DockPanel {
  /**
   * Gets the unique identifier of the panel, referenced by stacks in the layout tree.
   */
  readonly id: string;

  /**
   * Gets the display title shown in the panel's tab and tool-group title bar.
   */
  readonly title: string;

  /**
   * Gets the icon CSS class of the panel (a Tabler webfont class such as `ti ti-folder`).
   */
  readonly icon: string;

  /**
   * Gets the role the panel docks as: a tool window or an editor document.
   */
  readonly role: StackRole;

  /**
   * Gets the component projected into the panel body.
   */
  readonly component: Type<unknown>;
}
