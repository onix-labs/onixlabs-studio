import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { DOCK_BLUEPRINT } from './dock-blueprint';
import { DockPanel } from './dock-panel';
import { DockPanelAvailability } from './dock-panel-availability';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockNode as DockTreeNode, isStackNode, SplitNode, StackNode } from './dock-node';

/**
 * The narrowest a panel works at, in rem, when it declares nothing narrower or wider (#1064).
 */
export const DEFAULT_PANEL_MIN_INLINE_REM: number = 16;

/**
 * The least content height a panel keeps, in rem, below its group's title bar and tab strip, when it
 * declares nothing of its own.
 */
export const DEFAULT_PANEL_MIN_BLOCK_REM: number = 6;

/**
 * The room one divider takes along its split, in rem: the 0.25rem handle and the 2px margin either
 * side of it (see `split-divider.scss`).
 */
const DIVIDER_REM: number = 0.5;

/**
 * The fixed thickness, in rem, of a collapsed (auto-hidden) group's strip along its split (see
 * `COLLAPSED_SIZE` in `dock-node.ts`).
 */
const COLLAPSED_REM: number = 1.875;

/**
 * What a tab group measured of its own chrome, in pixels: the room its content needs that no panel
 * declares (#1064).
 */
export interface DockGroupMeasure {
  /**
   * Gets how wide the group's tabs are at their natural size, icon and full label: a tool group can
   * never be narrower. Zero for a document well, whose tabs scroll.
   */
  readonly tabs: number;

  /**
   * Gets how wide the group's title bar is at its natural size, title and buttons. Zero without one.
   */
  readonly title: number;

  /**
   * Gets the height of the group's chrome — title bar, tab strip, status strip — above and below the
   * panel's own content.
   */
  readonly chrome: number;
}

/**
 * A minimum size, in pixels.
 */
export interface DockMinimum {
  /**
   * Gets the least width.
   */
  readonly inline: number;

  /**
   * Gets the least height.
   */
  readonly block: number;
}

/**
 * Determines whether a group is collapsed to its strip.
 * @param stack The group.
 * @returns Returns true when it is.
 */
export type IsCollapsed = (stack: StackNode) => boolean;

/**
 * Determines whether a group's layout has it collapsed.
 */
const collapsedInLayout: IsCollapsed = (stack: StackNode): boolean => stack.collapsed === true;

/**
 * The size that takes no room at all.
 */
const NOTHING: DockMinimum = { inline: 0, block: 0 };

/**
 * Works out how small any part of a dock layout may be made before its content breaks (#1064).
 *
 * A **group**'s minimum is the largest of its tabs at their natural width, its title bar, and the
 * minimum each of its panels declares (16rem wide and 6rem of content when it declares none) — every
 * panel's, not the active one's, so switching tabs never makes a group jump in size. A **split**
 * needs, along its axis, the sum of its children's minimums and the dividers between them; across
 * it, the largest child's. So a column's minimum includes every group stacked in it, and widening the
 * group beside it stops when the column is as narrow as its contents allow.
 *
 * The divider clamps a drag to these, the panes carry them as CSS so a window resize cannot crush
 * them either, and the window's own minimum size follows the root's.
 *
 * In a dock whose main group keeps a share of the space (#1575) the **main group**'s minimum is that share,
 * a group's counts only its open panels and not their names, which shorten, and the window is left alone:
 * what doesn't fit collapses instead (see {@link import('./dock-room').DockRoom}).
 *
 * Exempt, taking only their fixed or zero size: auto-hidden groups (their strip), groups whose every
 * panel is unavailable here (they take no room), and an empty document well.
 *
 * Scoped per dock, beside the {@link DockState} it measures.
 */
@Service()
export class DockMinimums {
  /**
   * Holds the panel descriptors, whose declared minimums a group's minimum includes.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds which panels can be shown here, the same rule the layout uses to give a slot no room.
   */
  private readonly availability: DockPanelAvailability = inject(DockPanelAvailability);

  /**
   * Holds the least part of the dock's space its main group has, or null for a dock that gives it none.
   */
  private readonly mainShare: number | null =
    inject(DOCK_BLUEPRINT, { optional: true })?.mainShare ?? null;

  /**
   * Holds the dock's space, or null before it has any.
   */
  private readonly measuredSpace: WritableSignal<DockMinimum | null> = signal<DockMinimum | null>(
    null,
    {
      equal: (before: DockMinimum | null, after: DockMinimum | null): boolean =>
        before?.inline === after?.inline && before?.block === after?.block,
    },
  );

  /**
   * Gets the dock's space, or null before it has any.
   */
  public readonly space: Signal<DockMinimum | null> = this.measuredSpace.asReadonly();

  /**
   * Holds each tab group's measured chrome, keyed by its stack's id.
   */
  private readonly measures: WritableSignal<ReadonlyMap<string, DockGroupMeasure>> = signal<
    ReadonlyMap<string, DockGroupMeasure>
  >(new Map<string, DockGroupMeasure>());

  /**
   * Holds one rem in pixels — read once, and again with each measurement, rather than per minimum:
   * the root font size moves only with the interface's zoom, and a measurement follows any such move.
   */
  private rem: number = remPx();

  /**
   * Records the dock's space. A dock behind another tab has none, and keeps what it had.
   * @param inline The width, in pixels.
   * @param block The height, in pixels.
   */
  public measureSpace(inline: number, block: number): void {
    if (inline > 0 && block > 0) {
      this.measuredSpace.set({ inline, block });
    }
  }

  /**
   * Records what a tab group measured of its own chrome. Unchanged measurements are not written, so a
   * group re-measuring on every resize does not ripple through every minimum.
   * @param stackId The group's stack id.
   * @param measure The measurement, in pixels.
   */
  public report(stackId: string, measure: DockGroupMeasure): void {
    this.rem = remPx();
    const current: DockGroupMeasure | undefined = this.measures().get(stackId);
    if (
      current?.tabs === measure.tabs &&
      current.title === measure.title &&
      current.chrome === measure.chrome
    ) {
      return;
    }
    this.measures.update(
      (measures: ReadonlyMap<string, DockGroupMeasure>): ReadonlyMap<string, DockGroupMeasure> =>
        new Map<string, DockGroupMeasure>(measures).set(stackId, measure),
    );
  }

  /**
   * Forgets a tab group's measurement, when it is destroyed. A dock that fits itself to the window keeps it:
   * the group collapsed because of what it measured, and would come back for want of it.
   * @param stackId The group's stack id.
   */
  public forget(stackId: string): void {
    if (this.mainShare !== null || !this.measures().has(stackId)) {
      return;
    }
    this.measures.update(
      (measures: ReadonlyMap<string, DockGroupMeasure>): ReadonlyMap<string, DockGroupMeasure> => {
        const next: Map<string, DockGroupMeasure> = new Map<string, DockGroupMeasure>(measures);
        next.delete(stackId);
        return next;
      },
    );
  }

  /**
   * Gets the least size a node of the layout may be given — a group, or a split and everything in it.
   * Reads signals, so a computed or a template using it follows every change.
   * @param node The node.
   * @param isCollapsed Determines which groups are collapsed; the ones the layout has so when absent.
   * @returns Returns the minimum, in pixels.
   */
  public minimumOf(
    node: DockTreeNode | undefined,
    isCollapsed: IsCollapsed = collapsedInLayout,
  ): DockMinimum {
    if (node === undefined || this.isEmpty(node)) {
      return NOTHING;
    }
    if (!isStackNode(node)) {
      return this.splitMinimum(node, isCollapsed);
    }
    const space: DockMinimum | null = this.measuredSpace();
    if (this.mainShare !== null && node.role === 'main' && space !== null) {
      return { inline: space.inline * this.mainShare, block: space.block * this.mainShare };
    }
    return isCollapsed(node) ? this.collapsedMinimum() : this.groupMinimum(node);
  }

  /**
   * Gets whether a node takes no room at all: a tool group whose every panel is unavailable here, or a
   * split of nothing but such groups. An empty document well takes no minimum either; it renders
   * nothing until a document opens in it.
   * @param node The node.
   * @returns Returns true when it takes no room.
   */
  public isEmpty(node: DockTreeNode): boolean {
    if (isStackNode(node)) {
      if (node.panels.length === 0) {
        return true;
      }
      if (node.role === 'document' || node.primary === true) {
        return false;
      }
      return !node.panels.some((id: string): boolean => this.availability.isAvailable(id));
    }
    return node.children.every((child: DockTreeNode): boolean => this.isEmpty(child));
  }

  /**
   * Gets a group's minimum: the largest of its tabs, its title bar and its panels' own minimums, and
   * its chrome above the tallest of its panels' content minimums.
   * @param stack The group.
   * @returns Returns the minimum, in pixels.
   */
  private groupMinimum(stack: StackNode): DockMinimum {
    const measure: DockGroupMeasure | undefined = this.measures().get(stack.id);
    const rem: number = this.rem;
    let panelInline: number = 0;
    let panelBlock: number = 0;
    for (const id of stack.panels) {
      if (this.mainShare !== null && !this.availability.isAvailable(id)) {
        continue;
      }
      const panel: DockPanel | undefined = this.registry.get(id);
      panelInline = Math.max(
        panelInline,
        (panel?.minInlineSize ?? DEFAULT_PANEL_MIN_INLINE_REM) * rem,
      );
      panelBlock = Math.max(panelBlock, (panel?.minBlockSize ?? DEFAULT_PANEL_MIN_BLOCK_REM) * rem);
    }
    const named: number = Math.max(measure?.tabs ?? 0, measure?.title ?? 0);
    return {
      inline: Math.ceil(this.mainShare === null ? Math.max(panelInline, named) : panelInline),
      block: Math.ceil(panelBlock + (measure?.chrome ?? 0)),
    };
  }

  /**
   * Gets an auto-hidden group's minimum: its strip's fixed thickness each way.
   * @returns Returns the minimum, in pixels.
   */
  private collapsedMinimum(): DockMinimum {
    const strip: number = COLLAPSED_REM * this.rem;
    return { inline: strip, block: strip };
  }

  /**
   * Gets a split's minimum: along its axis, its children's minimums and the dividers between the ones
   * that take room; across it, the largest child's.
   * @param split The split.
   * @param isCollapsed Determines which groups are collapsed.
   * @returns Returns the minimum, in pixels.
   */
  private splitMinimum(split: SplitNode, isCollapsed: IsCollapsed): DockMinimum {
    const shown: readonly DockTreeNode[] = split.children.filter(
      (child: DockTreeNode): boolean => !this.isEmpty(child),
    );
    const minimums: readonly DockMinimum[] = shown.map((child: DockTreeNode): DockMinimum =>
      this.minimumOf(child, isCollapsed),
    );
    const dividers: number = Math.max(0, shown.length - 1) * DIVIDER_REM * this.rem;
    const along: (minimum: DockMinimum) => number = (minimum: DockMinimum): number =>
      split.dir === 'row' ? minimum.inline : minimum.block;
    const across: (minimum: DockMinimum) => number = (minimum: DockMinimum): number =>
      split.dir === 'row' ? minimum.block : minimum.inline;
    const sum: number =
      minimums.reduce((total: number, minimum: DockMinimum): number => total + along(minimum), 0) +
      dividers;
    const widest: number = minimums.reduce(
      (most: number, minimum: DockMinimum): number => Math.max(most, across(minimum)),
      0,
    );
    return split.dir === 'row' ? { inline: sum, block: widest } : { inline: widest, block: sum };
  }
}

/**
 * Gets the size of one rem in pixels, from the document's root font size.
 * @returns Returns the pixels per rem.
 */
function remPx(): number {
  const size: number =
    typeof document === 'undefined'
      ? Number.NaN
      : Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}
