import { DOCUMENT } from '@angular/common';
import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { DockFloating } from './dock-floating';
import { DockGeometry, DockGroupHit } from './dock-geometry';
import {
  DockResolution,
  DockTarget,
  GuideLegality,
  guideLegality,
  Rect,
  resolveEdgeTarget,
  resolveGroupTarget,
} from './dock-legality';
import { DockPanel } from './dock-panel';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockSide, StackNode } from './dock-node';
import { DockState } from './dock-state';
import { findStackOfPanel } from './dock-tree';

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
 * The distance, in pixels, the cursor must travel before a press becomes a drag. Below it a press
 * is treated as a click, so dragging never starts from a stationary mousedown.
 */
const DRAG_THRESHOLD: number = 5;

/**
 * A press that is armed but has not yet crossed the drag threshold.
 */
interface ArmedDrag {
  /**
   * Gets the panel that would be dragged.
   */
  readonly panel: DockPanel;

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
 * Coordinates a compass dock drag: the panel follows the cursor as a ghost while the overlay shows
 * the compass, edge guides and a drop preview resolved from the {@link DockGeometry} registry, and
 * the resolved {@link DockTarget} is committed to {@link DockState} on release.
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
   * Holds the panel being dragged, or null when idle.
   */
  private readonly draggedPanel: WritableSignal<DockPanel | null> = signal<DockPanel | null>(null);

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
  private readonly releaseHandler: () => void = (): void => this.onRelease();

  /**
   * Gets the panel being dragged, or null when idle.
   */
  public readonly panel: Signal<DockPanel | null> = this.draggedPanel.asReadonly();

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
  public readonly active: Signal<boolean> = computed((): boolean => this.draggedPanel() !== null);

  /**
   * Gets a value indicating whether edge guides apply (tool windows only).
   */
  public readonly showEdges: Signal<boolean> = computed(
    (): boolean => this.draggedPanel()?.role === 'tool',
  );

  /**
   * Begins a compass dock drag for the given panel.
   * @param panelId The identifier of the panel to drag.
   * @param event The originating mouse event.
   */
  public begin(panelId: string, event: MouseEvent): void {
    if (this.draggedPanel() !== null || this.armed !== null) {
      return;
    }
    const panel: DockPanel | undefined = this.registry.get(panelId);
    if (panel === undefined) {
      return;
    }
    event.preventDefault();

    const source: StackNode | null = findStackOfPanel(this.dockState.layout(), panelId);
    const sourceRect: Rect | null = source !== null ? this.geometry.rectOf(source.id) : null;
    const width: number = sourceRect?.width ?? DEFAULT_GHOST.width;
    const height: number = sourceRect?.height ?? DEFAULT_GHOST.height;
    this.armed = {
      panel,
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
    this.workspaceRect.set(armed.workspace);
    this.draggedPanel.set(armed.panel);
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
    if (this.draggedPanel() === null) {
      if (Math.hypot(x - armed.startX, y - armed.startY) < DRAG_THRESHOLD) {
        return;
      }
      this.activate(x, y);
    }

    const panel: DockPanel | null = this.draggedPanel();
    if (panel === null) {
      return;
    }
    const ghost: Rect | null = this.ghostRect();
    if (ghost !== null) {
      this.ghostRect.set({ ...ghost, left: x - this.offset.x, top: y - this.offset.y });
    }

    const workspace: Rect | null = this.workspaceRect();
    const edge: DockResolution | null =
      workspace !== null ? resolveEdgeTarget(x, y, workspace, panel.role) : null;
    if (edge !== null && edge.target.kind === 'edge') {
      this.currentTarget = edge.target;
      this.previewRect.set(edge.preview);
      this.hotEdgeSide.set(edge.target.side);
      this.compassState.set(null);
      return;
    }
    this.hotEdgeSide.set(null);

    const hit: DockGroupHit | null = this.geometry.groupAt(x, y);
    if (hit === null) {
      this.currentTarget = null;
      this.previewRect.set(null);
      this.compassState.set(null);
      return;
    }

    const resolution: DockResolution | null = resolveGroupTarget(
      x,
      y,
      hit.stackId,
      hit.role,
      hit.rect,
      panel.role,
    );
    this.currentTarget = resolution?.target ?? null;
    this.previewRect.set(resolution?.preview ?? null);
    this.compassState.set({
      x: hit.rect.left + hit.rect.width / 2,
      y: hit.rect.top + hit.rect.height / 2,
      legality: guideLegality(panel.role, hit.role),
      hot: resolution !== null ? guideKeyOf(resolution.target) : null,
    });
  }

  /**
   * Ends the drag: commits the resolved target, floats the panel when dropped on void, or does
   * nothing when the press never became a drag.
   */
  private onRelease(): void {
    this.document.removeEventListener('mousemove', this.moveHandler);
    this.document.removeEventListener('mouseup', this.releaseHandler);

    const panel: DockPanel | null = this.draggedPanel();
    const target: DockTarget | null = this.currentTarget;
    const ghost: Rect | null = this.ghostRect();
    this.armed = null;
    this.reset();
    if (panel === null) {
      return;
    }
    if (target !== null) {
      this.applyDock(panel, target);
    } else if (ghost !== null) {
      this.floating.float(panel.id, ghost);
    }
  }

  /**
   * Commits a resolved drop target to the layout.
   * @param panel The panel being docked.
   * @param target The resolved drop target.
   */
  private applyDock(panel: DockPanel, target: DockTarget): void {
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
   * Clears all drag state back to idle.
   */
  private reset(): void {
    this.currentTarget = null;
    this.draggedPanel.set(null);
    this.ghostRect.set(null);
    this.compassState.set(null);
    this.hotEdgeSide.set(null);
    this.previewRect.set(null);
    this.workspaceRect.set(null);
  }
}

/**
 * Resolves the compass guide a non-edge target corresponds to.
 * @param target The resolved target.
 * @returns Returns the guide key.
 */
function guideKeyOf(target: DockTarget): GuideKey | null {
  if (target.kind === 'tab') {
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
