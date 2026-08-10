import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Signal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Settings, WorkspaceTexture } from '@shared/angular/services/settings/settings';
import { DockFocus } from '../../../services/dock-layout/dock-focus';
import { DockGeometry } from '../../../services/dock-layout/dock-geometry';
import { DockNode as DockTreeNode, StackNode } from '../../../services/dock-layout/dock-node';
import { DockState } from '../../../services/dock-layout/dock-state';
import { firstStackOfRole } from '../../../services/dock-layout/dock-tree';
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
  host: {
    // The chosen texture rides on the element itself rather than on the document root: the dock
    // container also renders in pop-out windows, and an attribute on the host follows it there.
    '[attr.data-texture]': 'texture()',
  },
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
   * Holds the settings the background texture is chosen from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the root of the layout tree to render.
   */
  protected readonly layout: Signal<DockTreeNode> = this.dockState.layout;

  /**
   * Gets the background texture to paint behind the docked panes, or null when the user has chosen
   * none — the attribute is then absent, and the texture layer resolves to nothing.
   */
  protected readonly texture: Signal<string | null> = computed((): string | null => {
    const texture: WorkspaceTexture = this.settings.workspaceTexture();
    return texture === 'none' ? null : texture;
  });

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
    this.log.info('DockContainer', 'Reset dock layout');
    this.dockState.reset();
    this.focusDocumentWell();
  }

  /**
   * Restores the previous layout, discarding the last structural change. Focus returns to the
   * document well so the accent never points at a stack the undo may have removed.
   */
  public undo(): void {
    this.log.trace('DockContainer', 'Undo dock layout change');
    this.dockState.undo();
    this.focusDocumentWell();
  }

  /**
   * Reapplies the most recently undone layout. Focus returns to the document well so the accent never
   * points at a stack the redo may have removed.
   */
  public redo(): void {
    this.log.trace('DockContainer', 'Redo dock layout change');
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
