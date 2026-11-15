import { inject, Service, Type } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { Log } from '@shared/angular/services/log/log';

/**
 * Opens the Network Explorer's documents — pings, routes, captures — in its well: tabbed in and
 * brought forward when new, brought forward when already there.
 */
@Service({ autoProvided: false })
export class NetworkWell {
  /**
   * Holds the dock's panel registry, which documents are registered with.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the dock's layout, whose well documents are tabbed into.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock's focus, moved to the well as a document opens.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Opens a document in the well, or brings it forward when it is already there.
   * @param id The document's id.
   * @param title The document's title.
   * @param icon The document's icon.
   * @param component The component the document renders.
   */
  public open(id: string, title: string, icon: Icon, component: Type<unknown>): void {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    if (well === null) {
      this.log.warn('network-explorer.well', 'No well to open a document in', { id });
      return;
    }
    if (this.registry.has(id)) {
      this.dockState.setActive(well.id, id);
    } else {
      this.registry.register({ id, title, icon, role: 'document', component });
      this.dockState.tabInto(well.id, id);
    }
    this.dockFocus.focus(well.id);
  }
}
