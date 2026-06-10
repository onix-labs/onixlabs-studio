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
import { DockAutoHide } from '../../../services/dock/dock-auto-hide';
import { DockGeometry } from '../../../services/dock/dock-geometry';
import { DockNode as DockTreeNode, DockSide } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';
import { DockAutoHideStrips } from '../dock-auto-hide-strips/dock-auto-hide-strips';
import { DockFloatingLayer } from '../dock-floating-layer/dock-floating-layer';
import { DockNode } from '../dock-node/dock-node';
import { DockOverlay } from '../dock-overlay/dock-overlay';

/**
 * The dock-area padding, in rem, on an edge with no auto-hidden stacks.
 */
const BASE_INSET: string = '0.25rem';

/**
 * The dock-area padding, in rem, on an edge occupied by an auto-hide strip.
 */
const STRIP_INSET: string = '1.625rem';

/**
 * Represents the root host of the dock layout. It renders the layout tree from {@link DockState},
 * connects every tab strip into one CDK drop-list group so tabs move between groups, hosts the drag
 * overlay, floating layer and auto-hide strips, insets the dock area away from occupied edges,
 * registers the workspace for edge docking, and offers a reset to the seeded layout.
 */
@Component({
  selector: 'app-dock-container',
  imports: [DockNode, DockOverlay, DockFloatingLayer, DockAutoHideStrips, CdkDropListGroup],
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
   * Holds the auto-hide store, whose occupied edges inset the dock area.
   */
  private readonly autoHide: DockAutoHide = inject(DockAutoHide);

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
   * Gets the dock-area padding, grown on edges that carry an auto-hide strip.
   */
  protected readonly padding: Signal<string> = computed((): string => {
    const occupied: Record<DockSide, boolean> = this.autoHide.occupiedEdges();
    const inset: (edge: DockSide) => string = (edge: DockSide): string =>
      occupied[edge] ? STRIP_INSET : BASE_INSET;
    return `${inset('top')} ${inset('right')} ${inset('bottom')} ${inset('left')}`;
  });

  /**
   * Registers the workspace element for edge docking once rendered.
   */
  public constructor() {
    afterNextRender((): void => this.geometry.setWorkspace(this.hostElement.nativeElement));
  }

  /**
   * Resets the layout to the seeded default, discarding the current arrangement.
   */
  public reset(): void {
    this.dockState.reset();
  }
}
