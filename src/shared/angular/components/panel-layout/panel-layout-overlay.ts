import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelLayoutDrag } from './panel-layout-drag';
import { PANEL_EDGES, PanelEdge, panelEdgeGuideRect, PanelRect } from './panel-types';

/**
 * Renders a panel layout's drag overlay: the four edge guides, the drop preview slab and the ghost
 * that follows the cursor. Every position is read reactively from the owning layout's
 * {@link PanelLayoutDrag}. The dock overlay's simplified counterpart — the centre is fixed, so
 * there is no compass.
 */
@Component({
  selector: 'app-panel-layout-overlay',
  imports: [AppIcon],
  templateUrl: './panel-layout-overlay.html',
  styleUrl: './panel-layout-overlay.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelLayoutOverlay {
  /**
   * Holds the drag session the overlay renders.
   */
  private readonly drag: PanelLayoutDrag = inject(PanelLayoutDrag);

  /**
   * Gets a value indicating whether a drag is in progress.
   */
  protected readonly active: Signal<boolean> = this.drag.active;

  /**
   * Gets the title shown on the ghost.
   */
  protected readonly title: Signal<string> = this.drag.title;

  /**
   * Gets the ghost rectangle following the cursor.
   */
  protected readonly ghost: Signal<PanelRect | null> = this.drag.ghost;

  /**
   * Gets the drop preview rectangle.
   */
  protected readonly preview: Signal<PanelRect | null> = this.drag.preview;

  /**
   * Gets the targeted edge.
   */
  protected readonly hotEdge: Signal<PanelEdge | null> = this.drag.hotEdge;

  /**
   * Gets the workspace rectangle.
   */
  protected readonly workspace: Signal<PanelRect | null> = this.drag.workspace;

  /**
   * Gets the edges the dragged panel may land on, so a guide is drawn only for an offered edge (top
   * and bottom stay hidden for a restricted panel).
   */
  protected readonly allowedEdges: Signal<readonly PanelEdge[]> = this.drag.allowedEdges;

  /**
   * Gets the edges, in render order.
   */
  protected readonly edges: readonly PanelEdge[] = PANEL_EDGES;

  /**
   * Resolves the icon shown in an edge guide: left and right dock horizontally and top and bottom
   * dock vertically.
   * @param edge The edge the guide marks.
   * @returns Returns the guide's icon.
   */
  protected guideIcon(edge: PanelEdge): Icon {
    return edge === 'left' || edge === 'right' ? Icon.COLLAPSE_HORIZONTAL : Icon.COLLAPSE_VERTICAL;
  }

  /**
   * Resolves the rotation, in degrees, of a guide's icon: the left and top guides flip their glyph
   * 180°.
   * @param edge The edge the guide marks.
   * @returns Returns the rotation in degrees.
   */
  protected guideRotation(edge: PanelEdge): number {
    return edge === 'left' || edge === 'top' ? 180 : 0;
  }

  /**
   * Computes the top-left position of an edge guide within the workspace, from the shared guide
   * geometry so the drawn guide and its hit-test always coincide.
   * @param edge The edge the guide marks.
   * @param workspace The workspace rectangle.
   * @returns Returns the guide's top-left position.
   */
  protected edgePosition(
    edge: PanelEdge,
    workspace: PanelRect,
  ): { readonly left: number; readonly top: number } {
    const rect: PanelRect = panelEdgeGuideRect(edge, workspace);
    return { left: rect.left, top: rect.top };
  }
}
