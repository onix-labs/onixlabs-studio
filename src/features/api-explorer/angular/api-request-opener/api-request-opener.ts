import { inject, Service } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { ApiRequest } from '@shared/api/api-client-types';
import { ApiRequestPanel } from '../panels/api-request-panel/api-request-panel';
import { ApiWorkspace } from '../api-workspace/api-workspace';

/**
 * Opens saved requests into the API well — the API Explorer's analog of the workspace's
 * {@link import('@shared/angular/services/file-opener/file-opener').FileOpener}, and deliberately the
 * same shape: a request is registered as a `document`-role dock panel keyed by its own id, so the well
 * tabs, splits, floats and pops out requests exactly as it does files. The well needs no knowledge
 * that its documents are HTTP calls rather than files.
 *
 * Re-opening an already-open request activates its tab rather than adding a second one.
 */
@Service()
export class ApiRequestOpener {
  /**
   * Holds the dock's panel registry.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the dock's layout state.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock's focus coordinator.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the API workspace the request is read from.
   */
  private readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Opens a saved request in the API well, activating it when it is already open.
   * @param id The identifier of the request to open.
   */
  public open(id: string): void {
    const request: ApiRequest | undefined = this.workspace.request(id);
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    if (request === undefined || well === null) {
      return;
    }
    if (this.registry.has(id)) {
      this.dockState.setActive(well.id, id);
      this.dockFocus.focus(well.id);
      return;
    }
    this.registry.register({
      id,
      title: request.name,
      icon: Icon.API_REQUEST,
      role: 'document',
      component: ApiRequestPanel,
    });
    this.dockState.tabInto(well.id, id);
    this.dockFocus.focus(well.id);
    this.log.debug('api-explorer.opener', 'Opened request in the well', { id });
  }

  /**
   * Re-titles an open request's tab, so renaming a request in the explorer is reflected in the well.
   * @param id The identifier of the request.
   * @param title The new tab title.
   */
  public retitle(id: string, title: string): void {
    if (!this.registry.has(id)) {
      return;
    }
    this.registry.register({
      id,
      title,
      icon: Icon.API_REQUEST,
      role: 'document',
      component: ApiRequestPanel,
    });
  }
}
