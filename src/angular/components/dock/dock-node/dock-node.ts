import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { DockNode as DockTreeNode, isStackNode } from '../../../services/dock/dock-node';
import { DockSplitter } from '../dock-splitter/dock-splitter';
import { DockTabGroup } from '../dock-tab-group/dock-tab-group';

/**
 * Renders a node of the dock layout tree. A stack renders as a tab group; a split renders its
 * children as flex panes interleaved with splitters, recursing into each child through a
 * self-referencing template (so the component need not import itself).
 */
@Component({
  selector: 'app-dock-node',
  imports: [NgTemplateOutlet, DockSplitter, DockTabGroup],
  templateUrl: './dock-node.html',
  styleUrl: './dock-node.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockNode {
  /**
   * Gets the node to render.
   */
  public readonly node: InputSignal<DockTreeNode> = input.required<DockTreeNode>();

  /**
   * Determines whether the given node is a stack.
   * @param node The node to test.
   * @returns Returns true when the node is a stack; otherwise, false.
   */
  protected isStack(node: DockTreeNode): boolean {
    return isStackNode(node);
  }

  /**
   * Builds the flex shorthand that sizes a pane by its flex-grow weight.
   * @param grow The flex-grow weight of the pane.
   * @returns Returns the `flex` shorthand value.
   */
  protected paneFlex(grow: number): string {
    return `${grow} 1 0`;
  }
}
