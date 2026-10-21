import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Signal,
} from '@angular/core';
import { Studio } from '@shared/angular/services/studio/studio';
import { DockMinimum, DockMinimums } from '../../../services/dock-layout/dock-minimums';
import { Display } from '@shared/angular/services/display/display';
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
   * Holds the display policy, read so the texture is suppressed below the full graphics-acceleration
   * level.
   */
  private readonly display: Display = inject(Display);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the dock's minimum sizes, whose root sets the window's own minimum (#1064).
   */
  private readonly minimums: DockMinimums = inject(DockMinimums);

  /**
   * Holds the shell bridge the window's minimum size is asked for through.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the last minimum asked of the window, so an unchanged one is not sent again.
   */
  private lastMinimum: string = '';

  /**
   * Gets the least size the whole layout can be given — its root's minimum.
   */
  private readonly layoutMinimum: Signal<DockMinimum> = computed((): DockMinimum =>
    this.minimums.minimumOf(this.dockState.layout()),
  );

  /**
   * Gets the root of the layout tree to render.
   */
  protected readonly layout: Signal<DockTreeNode> = this.dockState.layout;

  /**
   * Gets the background texture to paint behind the docked panes, or null when the user has chosen
   * none — the attribute is then absent, and the texture layer resolves to nothing.
   *
   * Anything below the full graphics-acceleration level also resolves to null: the texture is a
   * full-workspace masked layer repainted with everything behind it, which is among the costliest
   * things to draw. The choice itself is preserved and returns at the full level.
   */
  protected readonly texture: Signal<string | null> = computed((): string | null => {
    if (this.display.resolvedGraphicsAcceleration() !== 'full') return null;
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

    // The window may not be made smaller than the layout needs (#1064). Asked again when the layout's
    // minimum moves and when this container is resized — which is also how a workspace tab coming to
    // the front is noticed: hidden, its container measures nothing and asks for nothing.
    const destroyRef: DestroyRef = inject(DestroyRef);
    effect((): void => {
      this.layoutMinimum();
      this.applyWindowMinimum();
    });
    afterNextRender((): void => {
      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer: ResizeObserver = new ResizeObserver((): void => this.applyWindowMinimum());
      observer.observe(this.hostElement.nativeElement);
      destroyRef.onDestroy((): void => observer.disconnect());
    });
  }

  /**
   * Asks for the window's minimum size to fit this layout: its root's minimum, plus everything around
   * the dock in the window — the shell's strips, the ribbon, the dock's own padding — as measured now.
   * Only from the visible dock in the main window: a hidden workspace tab measures nothing, and a
   * pop-out shares the main window's bridge, so it would size the wrong window.
   */
  private applyWindowMinimum(): void {
    const host: HTMLElement = this.hostElement.nativeElement;
    const root: HTMLElement | null = host.querySelector<HTMLElement>('app-dock-node');
    if (root === null || host.ownerDocument !== document) {
      return;
    }
    const box: DOMRect = root.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      // Hidden behind another workspace tab, which asks for its own minimum meanwhile: forget what this
      // one asked, so coming back to the front asks again.
      this.lastMinimum = '';
      return;
    }
    const minimum: DockMinimum = this.layoutMinimum();
    const width: number = Math.ceil(minimum.inline + (window.innerWidth - box.width));
    const height: number = Math.ceil(minimum.block + (window.innerHeight - box.height));
    const key: string = `${width}x${height}`;
    if (key === this.lastMinimum) {
      return;
    }
    this.lastMinimum = key;
    this.studio.setWindowMinimumSize(width, height);
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
