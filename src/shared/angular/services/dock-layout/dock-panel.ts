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

  /**
   * Saves the panel's document, for a panel whose document the host's own document store does not
   * hold (an image in a workspace's well), so the host's Save and Save All still reach it. Absent for
   * tool panels and for documents the host already saves through its store.
   * @returns Returns a promise resolving true when the document was saved; false when the save failed
   * or was cancelled.
   */
  save?(): Promise<boolean>;

  /**
   * Gets the switch to another view of the same thing — a file's diff, or a diff's file — which the
   * panel offers as a button on its own tool strip. Absent for a panel with no other view (a document
   * outside a workspace's well).
   */
  readonly switch?: Signal<DockPanelSwitch>;
}

/**
 * A document's switch to another view of the same thing, offered as a button on its tool strip.
 */
export interface DockPanelSwitch {
  /**
   * Gets what the button does, used as its label and tooltip.
   */
  readonly label: string;

  /**
   * Gets the button's icon.
   */
  readonly icon: Icon;

  /**
   * Gets why the switch cannot be made now, shown as the disabled button's tooltip, or null when it
   * can.
   */
  readonly unavailable: string | null;

  /**
   * Makes the switch.
   * @returns Returns a promise resolving true once the other view is showing, or false when the
   * switch was refused or cancelled.
   */
  run(): Promise<boolean>;
}
