import { DOCUMENT } from '@angular/common';
import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import {
  PanelEdge,
  panelEdgePreview,
  PanelRect,
  resolvePanelEdgeGuideTarget,
  resolvePanelEdgeTarget,
} from './panel-types';

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
 * The default ghost size, in pixels, used when the dragged panel cannot be measured.
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
   * Gets the identifier of the panel that would be dragged.
   */
  readonly panelId: string;

  /**
   * Gets the title shown on the ghost.
   */
  readonly title: string;

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
}

/**
 * Coordinates a panel dock drag within one {@link PanelLayout}: the panel follows the cursor as a
 * ghost while the overlay shows the four edge guides and a drop preview, and the targeted edge is
 * handed to the layout's drop handler on release. Provided per layout instance so simultaneous
 * views never share transient drag state.
 *
 * This is the panel layout's simplified counterpart to the dock's drag coordinator: the centre is
 * fixed, so there is no compass, no tab or split targets, and no floating — a panel can only land
 * on one of the four edges, which are always legal.
 */
@Service()
export class PanelLayoutDrag {
  /**
   * Holds the document the drag listeners attach to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the element the workspace rectangle is measured from, registered by the owning layout.
   */
  private host: HTMLElement | null = null;

  /**
   * Holds the drop handler committed to on release, registered by the owning layout.
   */
  private dropHandler: ((panelId: string, edge: PanelEdge) => void) | null = null;

  /**
   * Holds the identifier of the panel being dragged, or null when idle.
   */
  private readonly draggedPanelId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the title shown on the ghost.
   */
  private readonly ghostTitle: WritableSignal<string> = signal<string>('');

  /**
   * Holds the ghost rectangle that follows the cursor.
   */
  private readonly ghostRect: WritableSignal<PanelRect | null> = signal<PanelRect | null>(null);

  /**
   * Holds the targeted edge, or null when none is.
   */
  private readonly hotEdgeSide: WritableSignal<PanelEdge | null> = signal<PanelEdge | null>(null);

  /**
   * Holds the drop preview rectangle.
   */
  private readonly previewRect: WritableSignal<PanelRect | null> = signal<PanelRect | null>(null);

  /**
   * Holds the workspace rectangle, fixed at the start of a drag.
   */
  private readonly workspaceRect: WritableSignal<PanelRect | null> = signal<PanelRect | null>(null);

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
   * Gets the identifier of the panel being dragged, or null when idle.
   */
  public readonly panelId: Signal<string | null> = this.draggedPanelId.asReadonly();

  /**
   * Gets the title shown on the ghost.
   */
  public readonly title: Signal<string> = this.ghostTitle.asReadonly();

  /**
   * Gets the ghost rectangle that follows the cursor.
   */
  public readonly ghost: Signal<PanelRect | null> = this.ghostRect.asReadonly();

  /**
   * Gets the targeted edge, or null when none is.
   */
  public readonly hotEdge: Signal<PanelEdge | null> = this.hotEdgeSide.asReadonly();

  /**
   * Gets the drop preview rectangle.
   */
  public readonly preview: Signal<PanelRect | null> = this.previewRect.asReadonly();

  /**
   * Gets the workspace rectangle.
   */
  public readonly workspace: Signal<PanelRect | null> = this.workspaceRect.asReadonly();

  /**
   * Gets a value indicating whether a drag is in progress.
   */
  public readonly active: Signal<boolean> = computed((): boolean => this.draggedPanelId() !== null);

  /**
   * Registers the owning layout: the element the workspace is measured from and the handler a
   * resolved drop is committed to.
   * @param host The layout's host element.
   * @param onDrop The handler invoked with the dropped panel and targeted edge.
   */
  public attach(host: HTMLElement, onDrop: (panelId: string, edge: PanelEdge) => void): void {
    this.host = host;
    this.dropHandler = onDrop;
  }

  /**
   * Begins a dock drag for the given panel. The press is armed only; it becomes a drag once the
   * cursor travels past the drag threshold, so a plain click on a drag handle stays a click.
   * @param panelId The identifier of the panel to drag.
   * @param title The title shown on the ghost.
   * @param source The dragged panel's current rectangle, sizing the ghost, or null to use a
   * default.
   * @param event The originating mouse event.
   */
  public begin(panelId: string, title: string, source: PanelRect | null, event: MouseEvent): void {
    if (this.draggedPanelId() !== null || this.armed !== null) {
      return;
    }
    event.preventDefault();

    const width: number = source?.width ?? DEFAULT_GHOST.width;
    const height: number = source?.height ?? DEFAULT_GHOST.height;
    this.armed = {
      panelId,
      title,
      startX: event.clientX,
      startY: event.clientY,
      width,
      height,
      offset: {
        x: source !== null ? clamp(event.clientX - source.left, 8, width - 12) : 16,
        y: source !== null ? clamp(event.clientY - source.top, 6, 24) : 12,
      },
    };

    this.document.addEventListener('mousemove', this.moveHandler);
    this.document.addEventListener('mouseup', this.releaseHandler);
  }

  /**
   * Promotes the armed press into an active drag, capturing the workspace and showing the ghost.
   * @param x The cursor's x coordinate.
   * @param y The cursor's y coordinate.
   */
  private activate(x: number, y: number): void {
    const armed: ArmedDrag | null = this.armed;
    if (armed === null) {
      return;
    }
    this.offset = armed.offset;
    this.workspaceRect.set(this.measureWorkspace());
    this.ghostTitle.set(armed.title);
    this.draggedPanelId.set(armed.panelId);
    this.ghostRect.set({
      left: x - armed.offset.x,
      top: y - armed.offset.y,
      width: armed.width,
      height: armed.height,
    });
  }

  /**
   * Tracks the cursor, arming then activating the drag once the threshold is crossed, moving the
   * ghost and resolving the targeted edge and its preview.
   * @param event The mouse move event.
   */
  private onMove(event: MouseEvent): void {
    const armed: ArmedDrag | null = this.armed;
    if (armed === null) {
      return;
    }
    const x: number = event.clientX;
    const y: number = event.clientY;
    if (this.draggedPanelId() === null) {
      if (Math.hypot(x - armed.startX, y - armed.startY) < DRAG_THRESHOLD) {
        return;
      }
      this.activate(x, y);
    }

    const ghost: PanelRect | null = this.ghostRect();
    if (ghost !== null) {
      this.ghostRect.set({ ...ghost, left: x - this.offset.x, top: y - this.offset.y });
    }

    // Either the border-proximity band or the edge guide square itself targets an edge, so the
    // whole visible guide is droppable, not just the part within the border threshold.
    const workspace: PanelRect | null = this.workspaceRect();
    const edge: PanelEdge | null =
      workspace !== null
        ? (resolvePanelEdgeTarget(x, y, workspace) ?? resolvePanelEdgeGuideTarget(x, y, workspace))
        : null;
    this.hotEdgeSide.set(edge);
    this.previewRect.set(
      edge !== null && workspace !== null ? panelEdgePreview(edge, workspace) : null,
    );
  }

  /**
   * Ends the drag: commits the targeted edge to the layout's drop handler, or does nothing when
   * the press never became a drag or released over no edge.
   */
  private onRelease(): void {
    this.document.removeEventListener('mousemove', this.moveHandler);
    this.document.removeEventListener('mouseup', this.releaseHandler);

    const panelId: string | null = this.draggedPanelId();
    const edge: PanelEdge | null = this.hotEdgeSide();
    this.armed = null;
    this.reset();
    if (panelId !== null && edge !== null) {
      this.dropHandler?.(panelId, edge);
    }
  }

  /**
   * Measures the workspace rectangle from the registered host element.
   * @returns Returns the workspace rectangle, or null when no host is registered.
   */
  private measureWorkspace(): PanelRect | null {
    if (this.host === null) {
      return null;
    }
    const rect: DOMRect = this.host.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  /**
   * Clears all drag state back to idle.
   */
  private reset(): void {
    this.draggedPanelId.set(null);
    this.ghostTitle.set('');
    this.ghostRect.set(null);
    this.hotEdgeSide.set(null);
    this.previewRect.set(null);
    this.workspaceRect.set(null);
  }
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
