import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import {
  DockFloating,
  FloatWindow,
  MINIMUM_HEIGHT,
  MINIMUM_WIDTH,
} from '../../../services/dock/dock-floating';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { DockPanelOutlet } from '../dock-panel-outlet/dock-panel-outlet';

/**
 * A floating window resize handle: its id (for styling) and which edges it moves along each axis,
 * where -1 moves the leading edge (west/north), 1 the trailing edge (east/south) and 0 neither.
 */
interface ResizeHandle {
  /**
   * Gets the handle's identifier, used as its style modifier.
   */
  readonly id: string;

  /**
   * Gets the horizontal edge the handle moves: -1 (west), 1 (east) or 0 (none).
   */
  readonly h: -1 | 0 | 1;

  /**
   * Gets the vertical edge the handle moves: -1 (north), 1 (south) or 0 (none).
   */
  readonly v: -1 | 0 | 1;
}

/**
 * A floating window paired with its resolved panel, for rendering.
 */
interface ResolvedFloat {
  /**
   * Gets the floating window geometry and stacking order.
   */
  readonly window: FloatWindow;

  /**
   * Gets the resolved panel.
   */
  readonly panel: DockPanel;
}

/**
 * Renders the floating window layer: each detached panel as a movable, resizable window with a
 * title bar (drag to move, dock back, close) and edge and corner resize handles. Interacting with a
 * window brings it to the front.
 */
@Component({
  selector: 'app-dock-floating-layer',
  imports: [DockPanelOutlet, AppIcon],
  templateUrl: './dock-floating-layer.html',
  styleUrl: './dock-floating-layer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockFloatingLayer {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the document the move and resize drags attach to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the floating window store.
   */
  private readonly floating: DockFloating = inject(DockFloating);

  /**
   * Holds the registry panel ids are resolved through.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Gets the eight resize handles (four edges and four corners), in render order.
   */
  protected readonly resizeHandles: readonly ResizeHandle[] = [
    { id: 'n', h: 0, v: -1 },
    { id: 's', h: 0, v: 1 },
    { id: 'e', h: 1, v: 0 },
    { id: 'w', h: -1, v: 0 },
    { id: 'ne', h: 1, v: -1 },
    { id: 'nw', h: -1, v: -1 },
    { id: 'se', h: 1, v: 1 },
    { id: 'sw', h: -1, v: 1 },
  ];

  /**
   * Gets the floating windows paired with their resolved panels.
   */
  protected readonly windows: Signal<readonly ResolvedFloat[]> = computed(
    (): readonly ResolvedFloat[] =>
      this.floating
        .floats()
        .map((window: FloatWindow): ResolvedFloat | null => {
          const panel: DockPanel | undefined = this.registry.get(window.panelId);
          return panel !== undefined ? { window, panel } : null;
        })
        .filter((resolved: ResolvedFloat | null): resolved is ResolvedFloat => resolved !== null),
  );

  /**
   * Brings a window to the front.
   * @param panelId The identifier of the floating panel.
   */
  protected bringToFront(panelId: string): void {
    this.floating.bringToFront(panelId);
  }

  /**
   * Docks a floating panel back into the layout.
   * @param panelId The identifier of the floating panel.
   */
  protected dockBack(panelId: string): void {
    this.floating.dockBack(panelId);
  }

  /**
   * Closes a floating window.
   * @param panelId The identifier of the floating panel.
   */
  protected close(panelId: string): void {
    this.floating.close(panelId);
  }

  /**
   * Begins moving a floating window by its title bar.
   * @param window The window being moved.
   * @param event The originating mouse event.
   */
  protected startMove(window: FloatWindow, event: MouseEvent): void {
    event.preventDefault();
    this.bringToFront(window.panelId);
    const offsetX: number = event.clientX - window.left;
    const offsetY: number = event.clientY - window.top;
    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      this.floating.move(window.panelId, move.clientX - offsetX, move.clientY - offsetY);
    };
    this.track(onMove);
  }

  /**
   * Begins resizing a floating window from one of its edge or corner handles, moving the dragged
   * edges while the opposite edges stay anchored.
   * @param window The window being resized.
   * @param handle The handle that was grabbed.
   * @param event The originating mouse event.
   */
  protected startResize(window: FloatWindow, handle: ResizeHandle, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.bringToFront(window.panelId);
    const startX: number = event.clientX;
    const startY: number = event.clientY;
    const { left, top, width, height } = window;

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const dx: number = move.clientX - startX;
      const dy: number = move.clientY - startY;
      let nextLeft: number = left;
      let nextTop: number = top;
      let nextWidth: number = handle.h === 1 ? width + dx : handle.h === -1 ? width - dx : width;
      let nextHeight: number =
        handle.v === 1 ? height + dy : handle.v === -1 ? height - dy : height;
      if (handle.h === -1) {
        nextLeft = left + dx;
      }
      if (handle.v === -1) {
        nextTop = top + dy;
      }
      // Clamp to the minimum size, holding the anchored edge fixed when the leading edge is dragged.
      if (nextWidth < MINIMUM_WIDTH) {
        if (handle.h === -1) {
          nextLeft -= MINIMUM_WIDTH - nextWidth;
        }
        nextWidth = MINIMUM_WIDTH;
      }
      if (nextHeight < MINIMUM_HEIGHT) {
        if (handle.v === -1) {
          nextTop -= MINIMUM_HEIGHT - nextHeight;
        }
        nextHeight = MINIMUM_HEIGHT;
      }
      this.floating.setBounds(window.panelId, nextLeft, nextTop, nextWidth, nextHeight);
    };
    this.track(onMove);
  }

  /**
   * Attaches a move handler to the document until the next mouse release.
   * @param onMove The move handler.
   */
  private track(onMove: (move: MouseEvent) => void): void {
    const onRelease: () => void = (): void => {
      this.document.removeEventListener('mousemove', onMove);
      this.document.removeEventListener('mouseup', onRelease);
    };
    this.document.addEventListener('mousemove', onMove);
    this.document.addEventListener('mouseup', onRelease);
  }
}
