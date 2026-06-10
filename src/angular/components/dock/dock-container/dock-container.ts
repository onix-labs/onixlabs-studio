import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Signal,
} from '@angular/core';
import { DockGeometry } from '../../../services/dock/dock-geometry';
import { DockNode as DockTreeNode } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';
import { DockNode } from '../dock-node/dock-node';
import { DockOverlay } from '../dock-overlay/dock-overlay';

/**
 * Represents the root host of the dock layout. It renders the layout tree from {@link DockState},
 * connects every tab strip into one CDK drop-list group so tabs move between groups, hosts the drag
 * overlay, registers the workspace for edge docking, and offers a reset to the seeded layout.
 */
@Component({
  selector: 'app-dock-container',
  imports: [DockNode, DockOverlay, CdkDropListGroup],
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
