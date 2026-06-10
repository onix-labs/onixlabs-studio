import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { DockNode as DockTreeNode } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';
import { DockNode } from '../dock-node/dock-node';

/**
 * Represents the root host of the dock layout. It renders the layout tree from {@link DockState}
 * and offers a reset to the seeded default layout.
 */
@Component({
  selector: 'app-dock-container',
  imports: [DockNode],
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
   * Gets the root of the layout tree to render.
   */
  protected readonly layout: Signal<DockTreeNode> = this.dockState.layout;

  /**
   * Resets the layout to the seeded default, discarding the current arrangement.
   */
  public reset(): void {
    this.dockState.reset();
  }
}
