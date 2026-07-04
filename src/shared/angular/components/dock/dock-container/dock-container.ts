import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Signal,
} from '@angular/core';
import { DockFocus } from '../../../services/dock/dock-focus';
import { DockGeometry } from '../../../services/dock/dock-geometry';
import { DockNode as DockTreeNode, StackNode } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';
import { firstStackOfRole } from '../../../services/dock/dock-tree';
import { DockFloatingLayer } from '../dock-floating-layer/dock-floating-layer';
import { DockNode } from '../dock-node/dock-node';
import { DockOverlay } from '../dock-overlay/dock-overlay';

/**
 * The dock-area padding, in rem. Matches the splitter thickness so the gap is uniform around the
 * panels and between them.
 */
const BASE_INSET: string = '0.5rem';

/**
 * Represents the root host of the dock layout. It renders the layout tree from {@link DockState},
 * connects every tab strip into one CDK drop-list group so tabs move between groups, hosts the drag
 * overlay and floating layer, insets the dock area uniformly, registers the workspace for edge
 * docking, and offers a reset to the seeded layout.
 */
@Component({
  selector: 'app-dock-container',
  imports: [DockNode, DockOverlay, DockFloatingLayer, CdkDropListGroup],
  templateUrl: './dock-container.html',
  styleUrl: './dock-container.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockContainer {
  /**
   * Holds the layout state the container renders and resets.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the geometry registry the workspace element is registered with.
   */
  private readonly geometry: DockGeometry = inject(DockGeometry);

  /**
   * Holds the focus tracker, seeded to the document well so the editor starts accented.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the container element, whose rectangle bounds edge docking.
   */
  private readonly hostElement: ElementRef<HTMLElement> = inject(
    ElementRef,
  ) as ElementRef<HTMLElement>;

  /**
   * Gets the root of the layout tree to render.
   */
  protected readonly layout: Signal<DockTreeNode> = this.dockState.layout;

  /**
   * Gets the uniform dock-area padding.
   */
  protected readonly padding: string = BASE_INSET;

  /**
   * Gets a value indicating whether an earlier layout can be restored.
   */
  protected readonly canUndo: Signal<boolean> = this.dockState.canUndo;

  /**
   * Gets a value indicating whether an undone layout can be reapplied.
   */
  protected readonly canRedo: Signal<boolean> = this.dockState.canRedo;

  /**
   * Registers the workspace element for edge docking and seeds focus to the document well.
   */
  public constructor() {
    this.focusDocumentWell();
    afterNextRender((): void => this.geometry.setWorkspace(this.hostElement.nativeElement));
  }

  /**
   * Resets the layout to the seeded default, discarding the current arrangement.
   */
  public reset(): void {
    this.dockState.reset();
    this.focusDocumentWell();
  }

  /**
   * Restores the previous layout, discarding the last structural change. Focus returns to the
   * document well so the accent never points at a stack the undo may have removed.
   */
  public undo(): void {
    this.dockState.undo();
    this.focusDocumentWell();
  }

  /**
   * Reapplies the most recently undone layout. Focus returns to the document well so the accent never
   * points at a stack the redo may have removed.
   */
  public redo(): void {
    this.dockState.redo();
    this.focusDocumentWell();
  }

  /**
   * Focuses the first document well so the editor starts (and resets) accented.
   */
  private focusDocumentWell(): void {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    if (well !== null) {
      this.dockFocus.focus(well.id);
    }
  }
}
