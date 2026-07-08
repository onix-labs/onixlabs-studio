import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import {
  DockNode as DockTreeNode,
  DockSide,
  isStackNode,
  SplitDirection,
  SplitNode,
  StackNode,
} from '../../../services/dock-layout/dock-node';
import { DockCollapsedStrip } from '../dock-collapsed-strip/dock-collapsed-strip';
import { DockSplitter } from '../dock-splitter/dock-splitter';
import { DockTabGroup } from '../dock-tab-group/dock-tab-group';

/**
 * The flex shorthand sizing a collapsed pane to a fixed thin strip, regardless of its stored weight.
 */
const COLLAPSED_FLEX: string = '0 0 1.875rem';

/**
 * Renders a node of the dock layout tree. A stack renders as a tab group; a split renders its
 * children as flex panes interleaved with splitters, recursing into each child through a
 * self-referencing template (so the component need not import itself). A collapsed stack renders as
 * a thin {@link DockCollapsedStrip} in its slot instead of a full tab group, and the splitters
 * beside it are inert so its fixed size holds.
 */
@Component({
  selector: 'app-dock-node',
  imports: [NgTemplateOutlet, DockSplitter, DockTabGroup, DockCollapsedStrip],
  templateUrl: './dock-node.html',
  styleUrl: './dock-node.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockNode {
  /**
   * Gets the flex shorthand sizing a collapsed pane to a fixed thin strip.
   */
  protected readonly collapsedFlex: string = COLLAPSED_FLEX;

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
   * Determines whether the given node is a collapsed stack.
   * @param node The node to test.
   * @returns Returns true when the node is a collapsed stack; otherwise, false.
   */
  protected isCollapsed(node: DockTreeNode | undefined): boolean {
    return node !== undefined && isStackNode(node) && node.collapsed === true;
  }

  /**
   * Narrows a node to a stack for binding, used where the template has already guarded the kind.
   * @param node The node to narrow.
   * @returns Returns the node typed as a stack.
   */
  protected asStack(node: DockTreeNode): StackNode {
    return node as StackNode;
  }

  /**
   * Resolves the slot edge a collapsed child hugs within its split, which orients its strip and the
   * direction its peek opens. Row splits hug the left edge for the first child and the right for the
   * rest; column splits hug the top for the first child and the bottom for the rest.
   * @param dir The orientation of the parent split.
   * @param index The index of the child within the split.
   * @returns Returns the edge the collapsed strip hugs.
   */
  protected collapsedSide(dir: SplitDirection, index: number): DockSide {
    if (dir === 'row') {
      return index === 0 ? 'left' : 'right';
    }
    return index === 0 ? 'top' : 'bottom';
  }

  /**
   * Reads a split child at the given index, used to test whether the pane after a splitter is
   * collapsed.
   * @param split The split node.
   * @param index The index of the child to read.
   * @returns Returns the child node, or undefined when out of range.
   */
  protected childAt(split: SplitNode, index: number): DockTreeNode | undefined {
    return split.children[index];
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
