import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Rect } from './dock-legality';
import { DockPanel } from './dock-panel';
import { DockPanelRegistry } from './dock-panel-registry';
import { StackNode } from './dock-node';
import { DockState } from './dock-state';
import { firstStackOfRole } from './dock-tree';

/**
 * A floating panel window: a panel detached from the docked layout, positioned over the workspace.
 */
export interface FloatWindow {
  /**
   * Gets the identifier of the floating panel.
   */
  readonly panelId: string;

  /**
   * Gets the window's left coordinate.
   */
  readonly left: number;

  /**
   * Gets the window's top coordinate.
   */
  readonly top: number;

  /**
   * Gets the window's width.
   */
  readonly width: number;

  /**
   * Gets the window's height.
   */
  readonly height: number;

  /**
   * Gets the window's stacking order; the highest is frontmost.
   */
  readonly z: number;
}

/**
 * The minimum width, in pixels, a floating window may be resized to.
 */
export const MINIMUM_WIDTH: number = 180;

/**
 * The minimum height, in pixels, a floating window may be resized to.
 */
export const MINIMUM_HEIGHT: number = 120;

/**
 * Manages the floating window layer: panels dropped on void or floated from a tool group detach
 * from the docked layout into movable, resizable windows, and dock back into the layout on request.
 */
@Service()
export class DockFloating {
  /**
   * Holds the layout state floating and docking-back drive.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the registry floating panels are resolved through.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the floating windows.
   */
  private readonly windows: WritableSignal<readonly FloatWindow[]> = signal<readonly FloatWindow[]>(
    [],
  );

  /**
   * Holds the running counter that assigns stacking order.
   */
  private zCounter: number = 0;

  /**
   * Gets the floating windows.
   */
  public readonly floats: Signal<readonly FloatWindow[]> = this.windows.asReadonly();

  /**
   * Floats a panel at the given rectangle, detaching it from the docked layout. A panel already
   * floating is brought to the front instead.
   * @param panelId The identifier of the panel to float.
   * @param rect The rectangle the window should occupy.
   */
  public float(panelId: string, rect: Rect): void {
    if (this.windows().some((window: FloatWindow): boolean => window.panelId === panelId)) {
      this.bringToFront(panelId);
      return;
    }
    if (!this.registry.has(panelId)) {
      return;
    }
    this.dockState.removeFromLayout(panelId);
    this.zCounter += 1;
    this.windows.set([
      ...this.windows(),
      {
        panelId,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        z: this.zCounter,
      },
    ]);
  }

  /**
   * Moves a floating window's top-left corner.
   * @param panelId The identifier of the floating panel.
   * @param left The new left coordinate.
   * @param top The new top coordinate.
   */
  public move(panelId: string, left: number, top: number): void {
    this.patch(panelId, { left, top });
  }

  /**
   * Resizes a floating window, clamped to the minimum window size.
   * @param panelId The identifier of the floating panel.
   * @param width The new width.
   * @param height The new height.
   */
  public resize(panelId: string, width: number, height: number): void {
    this.patch(panelId, {
      width: Math.max(MINIMUM_WIDTH, width),
      height: Math.max(MINIMUM_HEIGHT, height),
    });
  }

  /**
   * Sets a floating window's full rectangle, clamping its size to the minimum. Used to resize from
   * any edge or corner, where moving an edge changes the position as well as the size.
   * @param panelId The identifier of the floating panel.
   * @param left The new left coordinate.
   * @param top The new top coordinate.
   * @param width The new width.
   * @param height The new height.
   */
  public setBounds(
    panelId: string,
    left: number,
    top: number,
    width: number,
    height: number,
  ): void {
    this.patch(panelId, {
      left,
      top,
      width: Math.max(MINIMUM_WIDTH, width),
      height: Math.max(MINIMUM_HEIGHT, height),
    });
  }

  /**
   * Brings a floating window to the front of the stacking order.
   * @param panelId The identifier of the floating panel.
   */
  public bringToFront(panelId: string): void {
    this.zCounter += 1;
    this.patch(panelId, { z: this.zCounter });
  }

  /**
   * Closes a floating window, discarding the panel.
   * @param panelId The identifier of the floating panel.
   */
  public close(panelId: string): void {
    this.windows.set(
      this.windows().filter((window: FloatWindow): boolean => window.panelId !== panelId),
    );
  }

  /**
   * Docks a floating panel back into the layout: documents return to a document well, tools dock to
   * the right edge.
   * @param panelId The identifier of the floating panel.
   */
  public dockBack(panelId: string): void {
    const exists: boolean = this.windows().some(
      (window: FloatWindow): boolean => window.panelId === panelId,
    );
    if (!exists) {
      return;
    }
    this.close(panelId);
    const panel: DockPanel | undefined = this.registry.get(panelId);
    if (panel === undefined) {
      return;
    }
    if (panel.role === 'document') {
      const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
      if (well !== null) {
        this.dockState.tabInto(well.id, panelId);
        return;
      }
      const tool: StackNode | null = firstStackOfRole(this.dockState.layout(), 'tool');
      if (tool !== null) {
        this.dockState.splitStack(tool.id, panelId, 'right', 'document');
        return;
      }
    }
    this.dockState.dockEdge(panelId, 'right');
  }

  /**
   * Replaces the matching floating window with a patched copy.
   * @param panelId The identifier of the floating panel.
   * @param changes The properties to change.
   */
  private patch(panelId: string, changes: Partial<FloatWindow>): void {
    this.windows.set(
      this.windows().map(
        (window: FloatWindow): FloatWindow =>
          window.panelId === panelId ? { ...window, ...changes } : window,
      ),
    );
  }
}
