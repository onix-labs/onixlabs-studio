import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { SplitDirection } from '@shared/angular/components/split-panel/split-direction';
import { SplitDivider } from '@shared/angular/components/split-panel/split-divider/split-divider';
import { SplitPane } from '@shared/angular/components/split-panel/split-pane/split-pane';
import { SplitPanel } from '@shared/angular/components/split-panel/split-panel/split-panel';
import { DockAutoHide } from '../../../services/dock-layout/dock-auto-hide';
import {
  axisOf,
  DockNode as DockTreeNode,
  DockSide,
  isStackNode,
  SplitNode,
  StackNode,
} from '../../../services/dock-layout/dock-node';
import { DockGroupSize, DockGroupSizes } from '../../../services/dock-layout/dock-group-sizes';
import { DockGeometry } from '../../../services/dock-layout/dock-geometry';
import { DockPanelAvailability } from '../../../services/dock-layout/dock-panel-availability';
import { DockMinimum, DockMinimums } from '../../../services/dock-layout/dock-minimums';
import { DockRoom } from '../../../services/dock-layout/dock-room';
import { findNode, sideOfMain } from '../../../services/dock-layout/dock-tree';
import { DockState } from '../../../services/dock-layout/dock-state';
import { DockCollapsedStrip } from '../dock-collapsed-strip/dock-collapsed-strip';
import { DockMain } from '../dock-main/dock-main';
import { DockTabGroup } from '../dock-tab-group/dock-tab-group';

/**
 * The thickness of the strip a collapsed pane keeps, regardless of its stored weight.
 */
const COLLAPSED_SIZE: string = '1.875rem';

/**
 * Renders a node of the dock layout tree. A stack renders as a tab group, or as the slot of the main
 * group; a split renders its
 * children as the panes of a {@link SplitPanel} interleaved with dividers, recursing into each child
 * through a self-referencing template (so the component need not import itself). A collapsed stack
 * renders as a thin {@link DockCollapsedStrip} in its slot instead of a full tab group, and the dividers
 * beside it are locked so its fixed size holds.
 */
@Component({
  selector: 'app-dock-node',
  imports: [
    NgTemplateOutlet,
    SplitPanel,
    SplitPane,
    SplitDivider,
    DockTabGroup,
    DockCollapsedStrip,
    DockMain,
  ],
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
   * Holds the availability of the panels this view can show, so a slot holding only panels whose
   * backing is absent is known to render nothing.
   */
  private readonly availability: DockPanelAvailability = inject(DockPanelAvailability);

  /**
   * Holds the dock's minimum sizes, which each pane carries (#1064).
   */
  private readonly minimums: DockMinimums = inject(DockMinimums);

  /**
   * Holds which groups are collapsed, by the user or for want of room.
   */
  private readonly room: DockRoom = inject(DockRoom);

  /**
   * Holds the layout state a resize commits to.
   */
  protected readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock geometry, told when a drag starts and ends so measurement-driven consumers (the
   * tab strips' fill measurement) can defer their forced layouts until the gesture settles.
   */
  protected readonly geometry: DockGeometry = inject(DockGeometry);

  /**
   * Holds the sizes groups beside a main group keep.
   */
  private readonly groupSizes: DockGroupSizes = inject(DockGroupSizes);

  /**
   * Exposes infinity to the template, for a pane nothing limits.
   */
  protected readonly Infinity: number = Number.POSITIVE_INFINITY;

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
   * Determines whether the given node is the main group.
   * @param node The node to test.
   * @returns Returns true when the node is the main group; otherwise, false.
   */
  protected isMain(node: DockTreeNode): boolean {
    return isStackNode(node) && node.role === 'main';
  }

  /**
   * Determines whether the given node is a collapsed stack.
   * @param node The node to test.
   * @returns Returns true when the node is a collapsed stack; otherwise, false.
   */
  protected isCollapsed(node: DockTreeNode | undefined): boolean {
    return node !== undefined && isStackNode(node) && this.room.isCollapsed(node);
  }

  /**
   * Determines whether all a pane holds is collapsed, which leaves it a strip: a collapsed stack, or a split
   * of nothing else.
   * @param node The pane's node.
   * @returns Returns true when it is.
   */
  protected isStrip(node: DockTreeNode): boolean {
    return this.room.isStrip(node);
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
   *
   * In a dock that fits itself to the window a strip is on its own side of the main group, whatever lies
   * between it and the edge. One stacked beside it hugs the end it is at, counting only the groups drawn:
   * such a dock keeps its closed panels' places.
   * @param child The child whose edge is being resolved.
   * @param split The parent split.
   * @param index The index of the child within the split.
   * @returns Returns the edge the child hugs.
   */
  protected sideOf(child: DockTreeNode, split: SplitNode, index: number): DockSide {
    const dir: SplitDirection = split.dir;
    if (this.room.enabled) {
      const side: DockSide | null = sideOfMain(this.dockState.layout(), child.id)?.side ?? null;
      if (side !== null && axisOf(side) === dir) {
        return side;
      }
      const first: boolean = split.children
        .slice(0, index)
        .every((other: DockTreeNode): boolean => this.isEmptyPane(other));
      return dir === 'row' ? (first ? 'left' : 'right') : first ? 'top' : 'bottom';
    }
    if (isStackNode(child) && child.side !== undefined && axisOf(child.side) === dir) {
      return child.side;
    }
    return dir === 'row' ? (index === 0 ? 'left' : 'right') : index === 0 ? 'top' : 'bottom';
  }

  /**
   * Resolves the edge a child of a split hugs. The strips of a split that is all strips hug the edge the
   * split does, laid along it: ones stacked in a column at the right are at the right, not its top and
   * bottom.
   * @param child The child whose edge is being resolved.
   * @param split The split.
   * @param index The index of the child within the split.
   * @param side The edge the split hugs.
   * @returns Returns the edge the child hugs.
   */
  protected edgeOf(child: DockTreeNode, split: SplitNode, index: number, side: DockSide): DockSide {
    return this.isStrip(split) ? side : this.sideOf(child, split, index);
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
      (child: DockTreeNode, at: number): boolean => this.sideOf(child, split, at) === endSide,
    );
    return first === index;
  }

  /**
   * Determines whether a node is the stack whose peek is currently flown out.
   * @param node The node to test.
   * @returns Returns true when the node is the peeking stack; otherwise, false.
   */
  protected isPeeking(node: DockTreeNode): boolean {
    const flyout: string | null = this.autoHide.flyoutStackId();
    return flyout !== null && findNode(node, flyout) !== null && this.isStrip(node);
  }

  /**
   * Determines whether a slot is one this workspace cannot fill: a stack that holds panels but can
   * show none of them, or a split whose every child is itself unfillable. Such a slot is hidden
   * rather than dropped from the split, so it keeps its weight and fills out again the moment its panels
   * can be shown, and the slots either side of it share one divider meanwhile.
   *
   * Deliberately availability alone, not registration. An unregistered id is a stale layout rather
   * than a workspace without the thing behind a panel — {@link import('../../../services/dock-layout/dock-persistence').restoreLayout}
   * sanitizes those out when a layout is applied — and an empty stack is a slot the user can drop
   * into. Document wells never count either: the centre stands open as the home a document lands in,
   * and as a target the compass can hover.
   * @param node The node to test.
   * @returns Returns true when the slot cannot be filled; otherwise, false.
   */
  protected isEmptyPane(node: DockTreeNode | undefined): boolean {
    if (node === undefined) {
      return true;
    }
    if (isStackNode(node)) {
      if (node.role === 'document' || node.primary === true || node.panels.length === 0) {
        return false;
      }
      return !node.panels.some((id: string): boolean => this.availability.isAvailable(id));
    }
    return node.children.every((child: DockTreeNode): boolean => this.isEmptyPane(child));
  }

  /**
   * Gets the size a pane keeps whatever its weight: its strip's, for a collapsed one.
   * @param node The node the pane holds.
   * @param split The split the pane is in, whose strips share its length when it is all strips.
   * @returns Returns the CSS length, or null when the pane's weight sizes it.
   */
  protected lockedSize(node: DockTreeNode, split: SplitNode): string | null {
    return this.isStrip(node) && !this.isStrip(split) ? COLLAPSED_SIZE : null;
  }

  /**
   * Gets the size a child keeps along its split, whatever its weight: none for one that renders nothing.
   * @param child The child.
   * @param split The split.
   * @returns Returns the size and its limit, or null when the child's weight sizes it.
   */
  protected sizeOf(child: DockTreeNode, split: SplitNode): DockGroupSize | null {
    return this.isEmptyPane(child) ? null : this.groupSizes.sizeOf(child, split);
  }

  /**
   * Gets the least size a pane may be given (#1064): its node's minimum — a group's tabs, title and
   * panels, or a nested split's sum of them — so neither a divider nor the window can crush it. None
   * for a collapsed or empty pane, whose own rules size it.
   * @param node The pane's node.
   * @returns Returns the minimum in pixels, or null to leave it to the pane's rules.
   */
  protected paneMinimum(node: DockTreeNode): DockMinimum | null {
    if (this.isStrip(node) || this.isEmptyPane(node)) {
      return null;
    }
    return this.minimums.minimumOf(node, (stack: StackNode): boolean =>
      this.room.isCollapsed(stack),
    );
  }

  /**
   * Gets the least size, along its split's axis, a divider may drag a pane down to (#1064).
   * @param node The pane's node.
   * @param dir The orientation of the split the pane is in.
   * @returns Returns the minimum in pixels.
   */
  protected minimumAlong(node: DockTreeNode, dir: SplitDirection): number {
    const minimum: DockMinimum | null = this.paneMinimum(node);
    if (minimum === null) {
      return 0;
    }
    return dir === 'row' ? minimum.inline : minimum.block;
  }
}
