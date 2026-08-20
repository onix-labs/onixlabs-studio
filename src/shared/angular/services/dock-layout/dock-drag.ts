import { DOCUMENT } from '@angular/common';
import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { DockFloating } from './dock-floating';
import { DockGeometry, DockGroupHit } from './dock-geometry';
import {
  DockResolution,
  DockTarget,
  GuideLegality,
  guideLegality,
  Rect,
  resolveCompassTarget,
  resolveEdgeGuideTarget,
  resolveEdgeTarget,
  resolveGroupTarget,
} from './dock-legality';
import { DockFocus } from './dock-focus';
import { DockPanel } from './dock-panel';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockNode, DockSide, isStackNode, StackNode, StackRole } from './dock-node';
import { DockState } from './dock-state';
import { findNode, findStackOfPanel } from './dock-tree';

/**
 * Identifies a compass guide: the centre tab-into guide or one of the four split sides.
 */
export type GuideKey = 'center' | DockSide;

/**
 * The state of the compass shown over the hovered group during a drag.
 */
export interface CompassState {
  /**
   * Gets the viewport x coordinate of the compass centre.
   */
  readonly x: number;

  /**
   * Gets the viewport y coordinate of the compass centre.
   */
  readonly y: number;

  /**
   * Gets the legality of each guide over the hovered group.
   */
  readonly legality: GuideLegality;

  /**
   * Gets the guide currently targeted, or null when none is.
   */
  readonly hot: GuideKey | null;
}

/**
 * What a drag moves. A `panel` drag lifts a single panel out of its group — the gesture a tool
 * group's title bar and a document well's grip start. A `group` drag moves a whole stack, tabs and
 * all, as one — the gesture the tab rail starts. Both resolve against the same compass; they differ
 * in what is committed on release, and in that a group has no meaningful void drop (there is no
 * floating layer for a whole group), so a group released over nothing simply stays where it is.
 */
export type DragSubject =
  | {
      /**
       * Gets the discriminant identifying this subject as a single panel.
       */
      readonly kind: 'panel';

      /**
       * Gets the panel being dragged.
       */
      readonly panel: DockPanel;
    }
  | {
      /**
       * Gets the discriminant identifying this subject as a whole group.
       */
      readonly kind: 'group';

      /**
       * Gets the identifier of the stack being dragged.
       */
      readonly stackId: string;

      /**
       * Gets the role of the stack, which governs docking legality exactly as a panel's does.
       */
      readonly role: StackRole;

      /**
       * Gets the group's active panel, whose title labels the ghost, or null when it has none.
       */
      readonly panel: DockPanel | null;

      /**
       * Gets the number of panels the group holds.
       */
      readonly count: number;
    };

/**
 * The pixel offset from the ghost's top-left to the cursor, fixed at the start of a drag.
 */
interface DragOffset {
  /**
   * Gets the horizontal offset.
   */
  readonly x: number;

  /**
   * Gets the vertical offset.
   */
  readonly y: number;
}

/**
 * The default ghost size, in pixels, used when the dragged panel's group cannot be measured.
 */
const DEFAULT_GHOST: { readonly width: number; readonly height: number } = {
  width: 280,
  height: 200,
};

/**
 * Takes a drag released over none of the dock's own targets — outside the window, or over another
 * window entirely. The handler decides from the event's coordinates whether the drop is its to
 * take (tearing the panel out into a new OS window, moving it into an existing one); a drop it
 * declines falls back to the dock's own void behaviour (floating the panel).
 * @param panel The dragged panel.
 * @param event The release event, carrying viewport and screen coordinates.
 * @returns Returns true when the drop was consumed.
 */
export type ExternalDropHandler = (panel: DockPanel, event: MouseEvent) => boolean;

/**
 * The distance, in pixels, the cursor must travel before a press becomes a drag. Below it a press
 * is treated as a click, so dragging never starts from a stationary mousedown.
 */
const DRAG_THRESHOLD: number = 5;

/**
 * A press that is armed but has not yet crossed the drag threshold.
 */
interface ArmedDrag {
  /**
   * Gets what would be dragged: a single panel, or a whole group.
   */
  readonly subject: DragSubject;

  /**
   * Gets the cursor's x coordinate at the press.
   */
  readonly startX: number;

  /**
   * Gets the cursor's y coordinate at the press.
   */
  readonly startY: number;

  /**
   * Gets the ghost width.
   */
  readonly width: number;

  /**
   * Gets the ghost height.
   */
  readonly height: number;

  /**
   * Gets the cursor offset from the ghost's top-left.
   */
  readonly offset: DragOffset;

  /**
   * Gets the workspace rectangle captured at the press.
   */
  readonly workspace: Rect | null;
}

/**
 * Coordinates a compass dock drag: the dragged subject follows the cursor as a ghost while the
 * overlay shows the compass, edge guides and a drop preview resolved from the {@link DockGeometry}
 * registry, and the resolved {@link DockTarget} is committed to {@link DockState} on release. The
 * subject is either a single panel ({@link begin}) or a whole group ({@link beginGroup}); the
 * resolution is identical either way, since a group docks by its stack's role just as a panel docks
 * by its own.
 */
@Service()
export class DockDrag {
  /**
   * Holds the document the drag listeners attach to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the layout state the drop commits to.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the registry the dragged panel is resolved through.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the geometry registry the cursor is hit-tested against.
   */
  private readonly geometry: DockGeometry = inject(DockGeometry);

  /**
   * Holds the floating layer a void drop floats the panel into.
   */
  private readonly floating: DockFloating = inject(DockFloating);

  /**
   * Holds the focus tracker, so the accent follows a group to wherever it was dropped.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds what is being dragged, or null when idle.
   */
  private readonly draggedSubject: WritableSignal<DragSubject | null> = signal<DragSubject | null>(
    null,
  );

  /**
   * Holds the ghost rectangle that follows the cursor.
   */
  private readonly ghostRect: WritableSignal<Rect | null> = signal<Rect | null>(null);

  /**
   * Holds the compass state over the hovered group.
   */
  private readonly compassState: WritableSignal<CompassState | null> = signal<CompassState | null>(
    null,
  );

  /**
   * Holds the targeted application edge, or null when none is.
   */
  private readonly hotEdgeSide: WritableSignal<DockSide | null> = signal<DockSide | null>(null);

  /**
   * Holds the drop preview rectangle.
   */
  private readonly previewRect: WritableSignal<Rect | null> = signal<Rect | null>(null);

  /**
   * Holds the workspace rectangle, fixed at the start of a drag.
   */
  private readonly workspaceRect: WritableSignal<Rect | null> = signal<Rect | null>(null);

  /**
   * Holds the resolved drop target, or null when the cursor is over no legal target.
   */
  private currentTarget: DockTarget | null = null;

  /**
   * Holds the cursor offset from the ghost's top-left.
   */
  private offset: DragOffset = { x: 0, y: 0 };

  /**
   * Holds the armed press, before the drag threshold is crossed, or null when none is pending.
   */
  private armed: ArmedDrag | null = null;

  /**
   * Holds the bound move handler so it can be detached on release.
   */
  private readonly moveHandler: (event: MouseEvent) => void = (event: MouseEvent): void =>
    this.onMove(event);

  /**
   * Holds the bound release handler so it can be detached.
   */
  private readonly releaseHandler: (event: MouseEvent) => void = (event: MouseEvent): void =>
    this.onRelease(event);

  /**
   * Holds the external drop handler, or null when none is registered.
   */
  private externalDrop: ExternalDropHandler | null = null;

  /**
   * Gets what is being dragged, or null when idle.
   */
  public readonly subject: Signal<DragSubject | null> = this.draggedSubject.asReadonly();

  /**
   * Gets the panel being dragged — the panel itself for a panel drag, the group's active panel for a
   * group drag — or null when idle.
   */
  public readonly panel: Signal<DockPanel | null> = computed(
    (): DockPanel | null => this.draggedSubject()?.panel ?? null,
  );

  /**
   * Gets the label shown on the ghost: the dragged panel's title, suffixed with the number of tabs
   * riding along when a whole group is dragged, or null when idle.
   */
  public readonly title: Signal<string | null> = computed((): string | null => {
    const subject: DragSubject | null = this.draggedSubject();
    if (subject === null) {
      return null;
    }
    const title: string = subject.panel?.title ?? '';
    if (subject.kind === 'panel' || subject.count <= 1) {
      return title;
    }
    return title !== '' ? `${title} +${subject.count - 1}` : `${subject.count} panels`;
  });

  /**
   * Gets the ghost rectangle that follows the cursor.
   */
  public readonly ghost: Signal<Rect | null> = this.ghostRect.asReadonly();

  /**
   * Gets the compass state over the hovered group.
   */
  public readonly compass: Signal<CompassState | null> = this.compassState.asReadonly();

  /**
   * Gets the targeted application edge, or null when none is.
   */
  public readonly hotEdge: Signal<DockSide | null> = this.hotEdgeSide.asReadonly();

  /**
   * Gets the drop preview rectangle.
   */
  public readonly preview: Signal<Rect | null> = this.previewRect.asReadonly();

  /**
   * Gets the workspace rectangle.
   */
  public readonly workspace: Signal<Rect | null> = this.workspaceRect.asReadonly();

  /**
   * Gets a value indicating whether a drag is in progress.
   */
  public readonly active: Signal<boolean> = computed((): boolean => this.draggedSubject() !== null);

  /**
   * Gets the role the drag docks by: the dragged panel's role, or the dragged group's stack role.
   */
  private readonly subjectRole: Signal<StackRole | null> = computed((): StackRole | null => {
    const subject: DragSubject | null = this.draggedSubject();
    if (subject === null) {
      return null;
    }
    return subject.kind === 'group' ? subject.role : subject.panel.role;
  });

  /**
   * Gets a value indicating whether edge guides apply (tool windows and tool groups only).
   */
  public readonly showEdges: Signal<boolean> = computed(
    (): boolean => this.subjectRole() === 'tool',
  );

  /**
   * Registers the handler offered drops released over none of the dock's own targets.
   * @param handler The external drop handler.
   * @returns Returns a function that deregisters the handler (unless it was replaced since).
   */
  public registerExternalDrop(handler: ExternalDropHandler): () => void {
    this.externalDrop = handler;
    return (): void => {
      if (this.externalDrop === handler) {
        this.externalDrop = null;
      }
    };
  }

  /**
   * Begins a compass dock drag for the given panel.
   * @param panelId The identifier of the panel to drag.
   * @param event The originating mouse event.
   */
  public begin(panelId: string, event: MouseEvent): void {
    const panel: DockPanel | undefined = this.registry.get(panelId);
    if (panel === undefined) {
      return;
    }
    const source: StackNode | null = findStackOfPanel(this.dockState.layout(), panelId);
    this.arm({ kind: 'panel', panel }, source?.id ?? null, event);
  }

  /**
   * Begins a compass dock drag for a whole group: every tab in the stack moves as one, wherever the
   * drop resolves. Empty groups are ignored — there is nothing to move.
   * @param stackId The identifier of the stack to drag.
   * @param event The originating mouse event.
   */
  public beginGroup(stackId: string, event: MouseEvent): void {
    const node: DockNode | null = findNode(this.dockState.layout(), stackId);
    if (node === null || !isStackNode(node) || node.panels.length === 0) {
      return;
    }
    const active: DockPanel | undefined =
      node.active !== null ? this.registry.get(node.active) : undefined;
    this.arm(
      {
        kind: 'group',
        stackId,
        role: node.role,
        panel: active ?? null,
        count: node.panels.length,
      },
      stackId,
      event,
    );
  }

  /**
   * Arms a press so it becomes a drag once the cursor crosses the threshold, sizing the ghost from
   * the rectangle of the group the subject comes from.
   * @param subject What the drag would move.
   * @param sourceStackId The identifier of the stack the drag starts from, measured for the ghost, or
   * null when it cannot be resolved.
   * @param event The originating mouse event.
   */
  private arm(subject: DragSubject, sourceStackId: string | null, event: MouseEvent): void {
    if (this.draggedSubject() !== null || this.armed !== null) {
      return;
    }
    this.log.trace(
      'DockDrag',
      subject.kind === 'panel'
        ? `Drag armed for panel '${subject.panel.id}'`
        : `Drag armed for group '${subject.stackId}'`,
    );
    event.preventDefault();

    const sourceRect: Rect | null =
      sourceStackId !== null ? this.geometry.rectOf(sourceStackId) : null;
    const width: number = sourceRect?.width ?? DEFAULT_GHOST.width;
    const height: number = sourceRect?.height ?? DEFAULT_GHOST.height;
    this.armed = {
      subject,
      startX: event.clientX,
      startY: event.clientY,
      width,
      height,
      offset: {
        x: sourceRect !== null ? clamp(event.clientX - sourceRect.left, 8, width - 12) : 16,
        y: sourceRect !== null ? clamp(event.clientY - sourceRect.top, 6, 24) : 12,
      },
      workspace: this.geometry.workspaceRect(),
    };

    this.document.addEventListener('mousemove', this.moveHandler);
    this.document.addEventListener('mouseup', this.releaseHandler);
  }

  /**
   * Promotes the armed press into an active drag, showing the ghost.
   * @param x The cursor's x coordinate.
   * @param y The cursor's y coordinate.
   */
  private activate(x: number, y: number): void {
    const armed: ArmedDrag | null = this.armed;
    if (armed === null) {
      return;
    }
    this.offset = armed.offset;
    this.log.trace('DockDrag', `Drag started`, describe(armed.subject));
    this.workspaceRect.set(armed.workspace);
    this.draggedSubject.set(armed.subject);
    this.ghostRect.set({
      left: x - armed.offset.x,
      top: y - armed.offset.y,
      width: armed.width,
      height: armed.height,
    });
  }

  /**
   * Tracks the cursor, arming then activating the drag once the threshold is crossed, moving the
   * ghost and resolving the current drop target and overlay state.
   * @param event The mouse move event.
   */
  private onMove(event: MouseEvent): void {
    const armed: ArmedDrag | null = this.armed;
    if (armed === null) {
      return;
    }
    const x: number = event.clientX;
    const y: number = event.clientY;
    if (this.draggedSubject() === null) {
      if (Math.hypot(x - armed.startX, y - armed.startY) < DRAG_THRESHOLD) {
        return;
      }
      this.activate(x, y);
    }

    const subject: DragSubject | null = this.draggedSubject();
    const role: StackRole | null = this.subjectRole();
    if (subject === null || role === null) {
      return;
    }
    const ghost: Rect | null = this.ghostRect();
    if (ghost !== null) {
      this.ghostRect.set({ ...ghost, left: x - this.offset.x, top: y - this.offset.y });
    }

    // Either the border-proximity band or the edge guide square itself targets an edge, so the whole
    // visible guide is droppable, not just the part within the border threshold.
    const workspace: Rect | null = this.workspaceRect();
    const edge: DockResolution | null =
      workspace !== null
        ? (resolveEdgeTarget(x, y, workspace, role) ??
          resolveEdgeGuideTarget(x, y, workspace, role))
        : null;
    if (edge !== null && edge.target.kind === 'edge') {
      this.currentTarget = edge.target;
      this.previewRect.set(edge.preview);
      this.hotEdgeSide.set(edge.target.side);
      this.compassState.set(null);
      return;
    }
    this.hotEdgeSide.set(null);

    // A group hovering its own rectangle has no legal target — every guide would move it onto
    // itself — so the compass stays hidden there rather than offering guides that do nothing.
    const hit: DockGroupHit | null = this.geometry.groupAt(x, y);
    if (hit === null || (subject.kind === 'group' && hit.stackId === subject.stackId)) {
      this.currentTarget = null;
      this.previewRect.set(null);
      this.compassState.set(null);
      return;
    }

    // The compass centres on the hovered group; a guide the cursor is directly over wins, so the
    // arrows are explicit targets, and the position-based zones serve as a fallback elsewhere. The
    // hovered stack's emptiness gates the well's centre guide alone: a tool occupies a blank centre,
    // but can never tab into a well that holds documents. Its splits are open either way.
    const centerX: number = hit.rect.left + hit.rect.width / 2;
    const centerY: number = hit.rect.top + hit.rect.height / 2;
    const hovered: DockNode | null = findNode(this.dockState.layout(), hit.stackId);
    const targetEmpty: boolean =
      hovered !== null && isStackNode(hovered) && hovered.panels.length === 0;
    const resolution: DockResolution | null =
      resolveCompassTarget(
        x,
        y,
        centerX,
        centerY,
        hit.stackId,
        hit.role,
        hit.rect,
        role,
        targetEmpty,
      ) ?? resolveGroupTarget(x, y, hit.stackId, hit.role, hit.rect, role, targetEmpty);
    this.currentTarget = resolution?.target ?? null;
    this.previewRect.set(resolution?.preview ?? null);
    this.compassState.set({
      x: centerX,
      y: centerY,
      legality: guideLegality(role, hit.role, targetEmpty),
      hot: resolution !== null ? guideKeyOf(resolution.target) : null,
    });
  }

  /**
   * Ends the drag: commits the resolved target, offers a target-less panel release to the external
   * drop handler (a tear-out beyond the window, a drop onto another window), floats the panel when
   * dropped on in-window void, or does nothing when the press never became a drag. A group released
   * over no target stays where it is — the floating layer and the pop-out windows both hold single
   * panels, so neither can take a whole group.
   * @param event The release event.
   */
  private onRelease(event: MouseEvent): void {
    this.document.removeEventListener('mousemove', this.moveHandler);
    this.document.removeEventListener('mouseup', this.releaseHandler);

    const subject: DragSubject | null = this.draggedSubject();
    const target: DockTarget | null = this.currentTarget;
    const ghost: Rect | null = this.ghostRect();
    this.armed = null;
    this.reset();
    if (subject === null) {
      return;
    }
    this.log.trace(
      'DockDrag',
      `Drag released for ${describe(subject)}`,
      target?.kind ?? 'no-target',
    );
    if (subject.kind === 'group') {
      if (target !== null) {
        this.applyGroupDock(subject.stackId, target);
      }
      return;
    }

    const panel: DockPanel = subject.panel;
    if (target !== null) {
      this.applyDock(panel, target);
    } else if (this.externalDrop?.(panel, event) === true) {
      this.log.debug('DockDrag', `Panel '${panel.id}' consumed by external drop handler`);
      return;
    } else if (ghost !== null) {
      this.log.info('DockDrag', `Floated panel '${panel.id}' on void drop`);
      this.floating.float(panel.id, ghost);
    }
  }

  /**
   * Commits a resolved drop target to the layout.
   * @param panel The panel being docked.
   * @param target The resolved drop target.
   */
  private applyDock(panel: DockPanel, target: DockTarget): void {
    this.log.debug('DockDrag', `Applying drop of panel '${panel.id}'`, target.kind);
    const source: StackNode | null = findStackOfPanel(this.dockState.layout(), panel.id);
    switch (target.kind) {
      case 'edge':
        this.dockState.removeFromLayout(panel.id);
        this.dockState.dockEdge(panel.id, target.side);
        return;
      case 'tab':
        if (source !== null && source.id === target.stackId) {
          return;
        }
        this.dockState.removeFromLayout(panel.id);
        this.dockState.tabInto(target.stackId, panel.id);
        return;
      case 'occupy':
        // The tool takes over the empty centre well. Lift it from its source first (pruning that
        // stack if it empties), then flip the well's slot to hold it.
        this.dockState.removeFromLayout(panel.id);
        this.dockState.occupyWell(target.stackId, panel.id);
        return;
      case 'split':
        if (source !== null && source.id === target.stackId && source.panels.length <= 1) {
          return;
        }
        this.dockState.removeFromLayout(panel.id);
        this.dockState.splitStack(target.stackId, panel.id, target.side, panel.role);
        return;
    }
  }

  /**
   * Commits a resolved drop target for a whole group: every tab in the stack moves together, and
   * the accent follows it to where it landed. A drop onto the dragged group itself is a no-op, and
   * is left to the tree operations to reject, since each of them is a move relative to another
   * stack.
   * @param stackId The identifier of the stack being docked.
   * @param target The resolved drop target.
   */
  private applyGroupDock(stackId: string, target: DockTarget): void {
    this.log.debug('DockDrag', `Applying drop of group '${stackId}'`, target.kind);
    switch (target.kind) {
      case 'edge':
        this.dockState.dockStackEdge(stackId, target.side);
        this.dockFocus.focus(stackId);
        return;
      case 'tab':
        this.dockState.tabStackInto(stackId, target.stackId);
        this.dockFocus.focus(target.stackId);
        return;
      case 'occupy':
        this.dockState.occupyWellWithStack(stackId, target.stackId);
        this.dockFocus.focus(target.stackId);
        return;
      case 'split':
        this.dockState.splitStackBeside(stackId, target.stackId, target.side);
        this.dockFocus.focus(stackId);
        return;
    }
  }

  /**
   * Clears all drag state back to idle.
   */
  private reset(): void {
    this.currentTarget = null;
    this.draggedSubject.set(null);
    this.ghostRect.set(null);
    this.compassState.set(null);
    this.hotEdgeSide.set(null);
    this.previewRect.set(null);
    this.workspaceRect.set(null);
  }
}

/**
 * Describes a drag subject for the log.
 * @param subject The drag subject.
 * @returns Returns a short description naming the panel or the group.
 */
function describe(subject: DragSubject): string {
  return subject.kind === 'panel'
    ? `panel '${subject.panel.id}'`
    : `group '${subject.stackId}' (${subject.count} panels)`;
}

/**
 * Resolves the compass guide a non-edge target corresponds to.
 * @param target The resolved target.
 * @returns Returns the guide key.
 */
function guideKeyOf(target: DockTarget): GuideKey | null {
  if (target.kind === 'tab' || target.kind === 'occupy') {
    return 'center';
  }
  if (target.kind === 'split') {
    return target.side;
  }
  return null;
}

/**
 * Clamps a value to an inclusive range.
 * @param value The value to clamp.
 * @param low The lower bound.
 * @param high The upper bound.
 * @returns Returns the clamped value.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
