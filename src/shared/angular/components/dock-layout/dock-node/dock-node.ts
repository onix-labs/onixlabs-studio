import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { DockAutoHide } from '../../../services/dock-layout/dock-auto-hide';
import {
  axisOf,
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
   * Holds the auto-hide store, consulted so the pane whose peek is open is lifted above its sibling
   * strips instead of being overpainted by whichever of them renders later.
   */
  private readonly autoHide: DockAutoHide = inject(DockAutoHide);

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
   * Resolves the slot edge a child hugs within its split, which orients a collapsed strip and the
   * direction its peek opens. A collapsed stack that remembers the edge it was collapsed against
   * keeps it, so rearranging the tree around a gutter never re-homes it — but only while that edge
   * still runs along this split's axis, because a remembered `right` means nothing in a column. The
   * fallback is positional: row splits hug the left edge for the first child and the right for the
   * rest; column splits hug the top for the first child and the bottom for the rest.
   * @param child The child whose edge is being resolved.
   * @param dir The orientation of the parent split.
   * @param index The index of the child within the split.
   * @returns Returns the edge the child hugs.
   */
  protected sideOf(child: DockTreeNode, dir: SplitDirection, index: number): DockSide {
    if (isStackNode(child) && child.side !== undefined && axisOf(child.side) === dir) {
      return child.side;
    }
    return dir === 'row' ? (index === 0 ? 'left' : 'right') : index === 0 ? 'top' : 'bottom';
  }

  /**
   * Determines whether a pane should be pushed to the end of its split by an auto margin. Panes
   * normally reach their edge because a growing sibling fills everything before them — but a split
   * whose every child is a collapsed strip has no grower, so without this the strips bunch up at the
   * start and a "bottom" gutter sits at the top of a column of dead space (its peek then opens
   * upward into nothing). The first pane whose edge is the split's end edge, and every pane after it,
   * are pushed down (or across) to where they claim to be.
   * @param split The split being rendered.
   * @param index The index of the child within the split.
   * @returns Returns true when the pane starts the end-hugging run of an all-collapsed split.
   */
  protected isEndAnchored(split: SplitNode, index: number): boolean {
    if (
      index === 0 ||
      split.children.some((child: DockTreeNode): boolean => !this.isCollapsed(child))
    ) {
      return false;
    }
    const endSide: DockSide = split.dir === 'row' ? 'right' : 'bottom';
    const first: number = split.children.findIndex(
      (child: DockTreeNode, at: number): boolean => this.sideOf(child, split.dir, at) === endSide,
    );
    return first === index;
  }

  /**
   * Determines whether a node is the stack whose peek is currently flown out.
   * @param node The node to test.
   * @returns Returns true when the node is the peeking stack; otherwise, false.
   */
  protected isPeeking(node: DockTreeNode): boolean {
    return isStackNode(node) && this.autoHide.flyoutStackId() === node.id;
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
