import { Signal, Type } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
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
   * Gets the icon of the panel.
   */
  readonly icon: Icon;

  /**
   * Gets the role the panel docks as: a tool window or an editor document.
   */
  readonly role: StackRole;

  /**
   * Gets the component projected into the panel body.
   */
  readonly component: Type<unknown>;

  /**
   * Gets a value indicating whether the panel renders its own tool strip in its body, so the dock
   * chrome omits the default strip for it. Defaults to false (the panel uses the shared strip).
   */
  readonly ownsToolStrip?: boolean;

  /**
   * Gets whether the panel's document has unsaved changes, driving the tab's dirty marker. Present
   * only for panels backed by an editable document; absent for tool panels.
   */
  readonly dirty?: Signal<boolean>;

  /**
   * Resolves unsaved changes before the panel closes: prompts to save / discard / cancel and returns
   * whether the close may proceed. Present only for panels that can hold unsaved work; a panel without
   * it closes unconditionally. A returned `false` keeps the panel open (the user cancelled).
   * @returns Returns a promise resolving true to close, or false to keep the panel open.
   */
  confirmClose?(): Promise<boolean>;
}
