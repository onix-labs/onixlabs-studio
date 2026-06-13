import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { CompassState, DockDrag, GuideKey } from '../../../services/dock/dock-drag';
import { DockSide } from '../../../services/dock/dock-node';
import { DockPanel } from '../../../services/dock/dock-panel';
import { edgeGuideRect, Rect } from '../../../services/dock/dock-legality';

/**
 * Renders the dock drag overlay: the directional compass over the hovered group, the four
 * application-edge guides (tool windows only), the drop preview rectangle and the ghost that
 * follows the cursor. Every position is read reactively from {@link DockDrag}.
 */
@Component({
  selector: 'app-dock-overlay',
  imports: [],
  templateUrl: './dock-overlay.html',
  styleUrl: './dock-overlay.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockOverlay {
  /**
   * Holds the drag session the overlay renders.
   */
  private readonly drag: DockDrag = inject(DockDrag);

  /**
   * Gets a value indicating whether a drag is in progress.
   */
  protected readonly active: Signal<boolean> = this.drag.active;

  /**
   * Gets the panel being dragged.
   */
  protected readonly panel: Signal<DockPanel | null> = this.drag.panel;

  /**
   * Gets the ghost rectangle following the cursor.
   */
  protected readonly ghost: Signal<Rect | null> = this.drag.ghost;

  /**
   * Gets the compass state over the hovered group.
   */
  protected readonly compass: Signal<CompassState | null> = this.drag.compass;

  /**
   * Gets the drop preview rectangle.
   */
  protected readonly preview: Signal<Rect | null> = this.drag.preview;

  /**
   * Gets the targeted application edge.
   */
  protected readonly hotEdge: Signal<DockSide | null> = this.drag.hotEdge;

  /**
   * Gets the workspace rectangle.
   */
  protected readonly workspace: Signal<Rect | null> = this.drag.workspace;

  /**
   * Gets a value indicating whether edge guides apply.
   */
  protected readonly showEdges: Signal<boolean> = this.drag.showEdges;

  /**
   * Gets the compass guides, in render order.
   */
  protected readonly guides: readonly GuideKey[] = ['center', 'left', 'right', 'top', 'bottom'];

  /**
   * Gets the application edges, in render order.
   */
  protected readonly edges: readonly DockSide[] = ['left', 'right', 'top', 'bottom'];

  /**
   * Computes the top-left position of an edge guide within the workspace, from the shared guide
   * geometry so the drawn guide and its hit-test always coincide.
   * @param edge The edge the guide marks.
   * @param workspace The workspace rectangle.
   * @returns Returns the guide's top-left position.
   */
  protected edgePosition(
    edge: DockSide,
    workspace: Rect,
  ): { readonly left: number; readonly top: number } {
    const rect: Rect = edgeGuideRect(edge, workspace);
    return { left: rect.left, top: rect.top };
  }
}
