import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { DockFloating, FloatWindow } from '../../../services/dock/dock-floating';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';
import { DockPanelOutlet } from '../dock-panel-outlet/dock-panel-outlet';

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
 * title bar (drag to move, dock back, close) and a corner resize handle. Interacting with a window
 * brings it to the front.
 */
@Component({
  selector: 'app-dock-floating-layer',
  imports: [DockPanelOutlet],
  templateUrl: './dock-floating-layer.html',
  styleUrl: './dock-floating-layer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockFloatingLayer {
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
   * Begins resizing a floating window from its corner handle.
   * @param window The window being resized.
   * @param event The originating mouse event.
   */
  protected startResize(window: FloatWindow, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const startX: number = event.clientX;
    const startY: number = event.clientY;
    const startWidth: number = window.width;
    const startHeight: number = window.height;
    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      this.floating.resize(
        window.panelId,
        startWidth + (move.clientX - startX),
        startHeight + (move.clientY - startY),
      );
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
