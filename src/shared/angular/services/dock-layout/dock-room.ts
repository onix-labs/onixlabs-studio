import { effect, inject, linkedSignal, Service, untracked, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { DOCK_BLUEPRINT } from './dock-blueprint';
import { DockFocus } from './dock-focus';
import { DockMinimum, DockMinimums, IsCollapsed } from './dock-minimums';
import { DockNode, DockSide, isStackNode, StackNode } from './dock-node';
import { DockPanelAvailability } from './dock-panel-availability';
import { DockPanelRegistry } from './dock-panel-registry';
import { allowsSide, DockSides } from './dock-sides';
import { DockState } from './dock-state';
import { countStacks, sideOfMain } from './dock-tree';

/**
 * Which groups are collapsed for want of room.
 */
interface Squeeze {
  /**
   * Gets the identifiers of the groups collapsed, in the order they were.
   */
  readonly stacks: readonly string[];

  /**
   * Gets each group's open panels, by the group's identifier.
   */
  readonly open: ReadonlyMap<string, readonly string[]>;
}

/**
 * What a layout is fitted from.
 */
interface Fitting {
  /**
   * Gets the layout.
   */
  readonly layout: DockNode;

  /**
   * Gets the dock's space, or null before it has any.
   */
  readonly space: DockMinimum | null;
}

/**
 * How far over its space a layout may be, in pixels, for fractions lost in measuring it.
 */
const TOLERANCE: number = 0.5;

/**
 * Keeps a dock's main group its share of the space (#1575): the panels share the rest, and what doesn't fit
 * collapses to a strip on its own side, the group least recently used first. A group collapsed here comes
 * back when there is room again, the last to collapse first. None of that is in the layout, which is the
 * user's: what they collapse themselves is theirs to dock.
 *
 * A group that was opened, or grew by a panel opened in it, makes way itself rather than pushing others
 * aside.
 *
 * It also says where there is room: whether a collapsed group could be docked, and whether a layout a drag
 * would make fits and has each panel on a side it allows.
 *
 * A dock whose blueprint gives its main group no share has none of this: every answer is the layout's own.
 *
 * Scoped per dock, beside the {@link DockState} it fits.
 */
@Service()
export class DockRoom {
  /**
   * Holds the layout.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the minimums the layout is fitted by, and the space it is fitted in.
   */
  private readonly minimums: DockMinimums = inject(DockMinimums);

  /**
   * Holds which panels are open.
   */
  private readonly availability: DockPanelAvailability = inject(DockPanelAvailability);

  /**
   * Holds the panels, which say the sides they allow.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the focused group, by which the groups' last uses are known.
   */
  private readonly focus: DockFocus = inject(DockFocus);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets whether the dock keeps its main group a share of the space.
   */
  public readonly enabled: boolean =
    inject(DOCK_BLUEPRINT, { optional: true })?.mainShare !== undefined;

  /**
   * Holds the identifiers of the groups used, the latest last.
   */
  private used: readonly string[] = [];

  /**
   * Holds which groups are collapsed for want of room. It follows from what it was: a group stays collapsed
   * until there is room for it, whatever is used meanwhile.
   */
  private readonly squeeze: WritableSignal<Squeeze> = linkedSignal<Fitting, Squeeze>({
    source: (): Fitting => ({ layout: this.dockState.layout(), space: this.minimums.space() }),
    computation: (fitting: Fitting, previous?: { readonly value: Squeeze }): Squeeze =>
      this.fit(fitting, previous?.value ?? null),
  });

  public constructor() {
    if (this.enabled) {
      effect((): void => {
        const stackId: string | null = this.focus.focusedStackId();
        if (stackId !== null) {
          this.used = [...this.used.filter((other: string): boolean => other !== stackId), stackId];
        }
      });
      // A panel on a side it doesn't allow — one its group was moved to while the panel was closed, or
      // that a saved layout has from before — goes back to where it starts.
      effect((): void => {
        const layout: DockNode = this.dockState.layout();
        for (const [stackId, panels] of this.openPanels(layout)) {
          const side: DockSide | null = sideOfMain(layout, stackId)?.side ?? null;
          for (const id of panels) {
            if (side !== null && !allowsSide(this.sidesOf(id), side)) {
              untracked((): void => this.returnToStart(id));
              return;
            }
          }
        }
      });
    }
  }

  /**
   * Gets whether a group is collapsed, by the user or for want of room. Reads signals.
   * @param stack The group.
   * @returns Returns true when it is.
   */
  public isCollapsed(stack: StackNode): boolean {
    return stack.collapsed === true || (this.enabled && this.isSqueezed(stack.id));
  }

  /**
   * Gets whether every open group in a part of the layout is collapsed, so that all of it is a strip. Reads
   * signals.
   * @param node The part of the layout.
   * @returns Returns true when it has open groups and all of them are.
   */
  public isStrip(node: DockNode): boolean {
    if (isStackNode(node)) {
      return this.isCollapsed(node);
    }
    if (!this.enabled || countStacks(node, 'main') > 0) {
      return false;
    }
    const shown: readonly DockNode[] = node.children.filter(
      (child: DockNode): boolean => !this.minimums.isEmpty(child),
    );
    return shown.length > 0 && shown.every((child: DockNode): boolean => this.isStrip(child));
  }

  /**
   * Gets whether there is room to dock a collapsed group. Reads signals.
   * @param stackId The identifier of the group.
   * @returns Returns true when there is.
   */
  public canDock(stackId: string): boolean {
    if (!this.enabled) {
      return true;
    }
    return this.fits(
      this.dockState.layout(),
      (stack: StackNode): boolean => stack.id !== stackId && this.isCollapsed(stack),
    );
  }

  /**
   * Forgets that a group was collapsed for want of room, which the user is docking.
   * @param stackId The identifier of the group.
   */
  public release(stackId: string): void {
    if (this.enabled) {
      this.squeeze.update((squeeze: Squeeze): Squeeze => ({
        ...squeeze,
        stacks: squeeze.stacks.filter((other: string): boolean => other !== stackId),
      }));
    }
  }

  /**
   * Determines whether the dock could have a layout: whether there is room for it, with the groups the moved
   * panels are in docked, and each of their open panels is on a side it allows.
   * @param layout The layout.
   * @param moved The identifiers of the panels moved to make it.
   * @returns Returns true when it could.
   */
  public admits(layout: DockNode, moved: readonly string[]): boolean {
    if (!this.enabled) {
      return true;
    }
    const groups: readonly StackNode[] = stacksOf(layout).filter((stack: StackNode): boolean =>
      stack.panels.some((id: string): boolean => moved.includes(id)),
    );
    const allowed: boolean = groups.every((stack: StackNode): boolean => {
      const side: DockSide | null = sideOfMain(layout, stack.id)?.side ?? null;
      return (
        side === null ||
        this.openIn(stack).every((id: string): boolean => allowsSide(this.sidesOf(id), side))
      );
    });
    return (
      allowed &&
      this.fits(
        layout,
        (stack: StackNode): boolean =>
          !groups.some((group: StackNode): boolean => group.id === stack.id) &&
          this.isCollapsed(stack),
      )
    );
  }

  /**
   * Gets whether a group is collapsed for want of room.
   * @param stackId The identifier of the group.
   * @returns Returns true when it is.
   */
  private isSqueezed(stackId: string): boolean {
    return this.squeeze().stacks.includes(stackId);
  }

  /**
   * Works out which groups are to be collapsed for a layout to fit.
   * @param fitting The layout and its space.
   * @param previous Which groups were, or null the first time.
   * @returns Returns which groups are.
   */
  private fit(fitting: Fitting, previous: Squeeze | null): Squeeze {
    const open: ReadonlyMap<string, readonly string[]> = this.openPanels(fitting.layout);
    if (!this.enabled || fitting.space === null) {
      return { stacks: [], open };
    }
    const groups: readonly StackNode[] = stacksOf(fitting.layout).filter(
      (stack: StackNode): boolean =>
        stack.role === 'tool' && stack.collapsed !== true && (open.get(stack.id)?.length ?? 0) > 0,
    );
    const isGroup: (id: string) => boolean = (id: string): boolean =>
      groups.some((group: StackNode): boolean => group.id === id);
    let stacks: readonly string[] = (previous?.stacks ?? []).filter(isGroup);
    const over: (collapsed: readonly string[]) => number = (collapsed: readonly string[]): number =>
      this.excess(fitting.layout, collapsedWith(collapsed));

    while (stacks.length > 0 && over(stacks.slice(0, -1)) === 0) {
      stacks = stacks.slice(0, -1);
    }
    for (let excess: number = over(stacks); excess > 0; excess = over(stacks)) {
      const next: readonly string[] | null = this.nextToCollapse(
        fitting.layout,
        this.inOrderOfUse(groups, open, previous).filter(
          (id: string): boolean => !stacks.includes(id),
        ),
        (more: readonly string[]): boolean => over([...stacks, ...more]) < excess,
      );
      if (next === null) {
        break;
      }
      stacks = [...stacks, ...next];
    }
    if (stacks.join() !== (previous?.stacks ?? []).join()) {
      this.log.debug('DockRoom', 'Groups collapsed for want of room', stacks);
    }
    return { stacks, open };
  }

  /**
   * Gets what to collapse next: the first group whose collapse helps, or else every group of a part of the
   * layout whose groups only help together, as ones stacked in a column do when it is too wide.
   * @param layout The layout.
   * @param order The groups that may be, in the order they are to be.
   * @param helps Determines whether collapsing some would help.
   * @returns Returns the identifiers of the groups, or null when nothing would help.
   */
  private nextToCollapse(
    layout: DockNode,
    order: readonly string[],
    helps: (stacks: readonly string[]) => boolean,
  ): readonly string[] | null {
    for (const id of order) {
      if (helps([id])) {
        return [id];
      }
    }
    for (const id of order) {
      const beside: readonly string[] = sideOfTree(layout, id).filter((other: string): boolean =>
        order.includes(other),
      );
      if (helps(beside)) {
        return beside;
      }
    }
    return null;
  }

  /**
   * Orders groups by which is to collapse first: those with a panel just opened, and then the least recently
   * used, the ones never used from the end of the layout back.
   * @param groups The groups.
   * @param open Each group's open panels.
   * @param previous What was open before, or null the first time.
   * @returns Returns the groups' identifiers.
   */
  private inOrderOfUse(
    groups: readonly StackNode[],
    open: ReadonlyMap<string, readonly string[]>,
    previous: Squeeze | null,
  ): readonly string[] {
    const opened: (id: string) => boolean = (id: string): boolean => {
      const before: readonly string[] = previous?.open.get(id) ?? [];
      return (
        previous !== null &&
        (open.get(id) ?? []).some((panel: string): boolean => !before.includes(panel))
      );
    };
    const rank: (id: string) => number = (id: string): number =>
      opened(id) ? -1 : this.used.indexOf(id) + 1;
    return groups
      .map((group: StackNode): string => group.id)
      .reverse()
      .sort((one: string, other: string): number => rank(one) - rank(other));
  }

  /**
   * Determines whether a layout fits in the dock's space.
   * @param layout The layout.
   * @param isCollapsed Determines which groups are collapsed.
   * @returns Returns true when it does, or there is no telling.
   */
  private fits(layout: DockNode, isCollapsed: IsCollapsed): boolean {
    return this.excess(layout, isCollapsed) === 0;
  }

  /**
   * Gets how much more than the dock's space a layout needs, across and down together.
   * @param layout The layout.
   * @param isCollapsed Determines which groups are collapsed.
   * @returns Returns the pixels, zero when it fits or there is no telling.
   */
  private excess(layout: DockNode, isCollapsed: IsCollapsed): number {
    const space: DockMinimum | null = this.minimums.space();
    if (space === null) {
      return 0;
    }
    const least: DockMinimum = this.minimums.minimumOf(layout, isCollapsed);
    const across: number = least.inline - space.inline;
    const down: number = least.block - space.block;
    return (across > TOLERANCE ? across : 0) + (down > TOLERANCE ? down : 0);
  }

  /**
   * Gets the open panels of a layout's groups.
   * @param layout The layout.
   * @returns Returns the panels' identifiers, by their group's.
   */
  private openPanels(layout: DockNode): ReadonlyMap<string, readonly string[]> {
    return new Map<string, readonly string[]>(
      stacksOf(layout).map((stack: StackNode): [string, readonly string[]] => [
        stack.id,
        this.openIn(stack),
      ]),
    );
  }

  /**
   * Gets a group's open panels.
   * @param stack The group.
   * @returns Returns the panels' identifiers.
   */
  private openIn(stack: StackNode): readonly string[] {
    return stack.panels.filter((id: string): boolean => this.availability.isAvailable(id));
  }

  /**
   * Gets the sides a panel allows.
   * @param panelId The identifier of the panel.
   * @returns Returns the sides.
   */
  private sidesOf(panelId: string): DockSides {
    return this.registry.get(panelId)?.sides ?? DockSides.All;
  }

  /**
   * Moves a panel back to where the dock's own layout has it, unless it doesn't allow that either or has none.
   * @param panelId The identifier of the panel.
   */
  private returnToStart(panelId: string): void {
    const start: DockSide | null = this.dockState.startingSideOf(panelId);
    if (start !== null && allowsSide(this.sidesOf(panelId), start)) {
      this.dockState.returnToStart(panelId);
    }
  }
}

/**
 * Gets the groups of a layout, in order.
 * @param node The layout.
 * @returns Returns the groups.
 */
function stacksOf(node: DockNode): readonly StackNode[] {
  return isStackNode(node) ? [node] : node.children.flatMap(stacksOf);
}

/**
 * Determines which groups are collapsed: the layout's, and some for want of room.
 * @param stacks The identifiers of the groups collapsed for want of room.
 * @returns Returns the predicate.
 */
function collapsedWith(stacks: readonly string[]): IsCollapsed {
  return (stack: StackNode): boolean => stack.collapsed === true || stacks.includes(stack.id);
}

/**
 * Gets the groups beside a group in the part of the layout that parts from the main group's where it does.
 * @param layout The layout.
 * @param stackId The identifier of the group.
 * @returns Returns the groups' identifiers, the group's own among them.
 */
function sideOfTree(layout: DockNode, stackId: string): readonly string[] {
  let node: DockNode = layout;
  while (!isStackNode(node)) {
    const child: DockNode | undefined = node.children.find((candidate: DockNode): boolean =>
      stacksOf(candidate).some((stack: StackNode): boolean => stack.id === stackId),
    );
    if (child === undefined || countStacks(child, 'main') === 0) {
      return child === undefined ? [] : stacksOf(child).map((stack: StackNode): string => stack.id);
    }
    node = child;
  }
  return [stackId];
}
