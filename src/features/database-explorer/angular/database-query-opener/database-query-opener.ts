import { inject, Service } from '@angular/core';
import { DatabaseQuery } from '@shared/api/database-document';
import { Icon } from '@shared/angular/icons/icon';
import { OpenOptions } from '@shared/angular/services/tabs/tab';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { QueryPanel } from '../panels/query-panel/query-panel';
import { DatabaseWorkspace } from '../database-workspace/database-workspace';

/**
 * Opens queries into the Database Explorer's well — the same shape as the API Explorer's request
 * opener: a query is a `document`-role dock panel whose id is the query's id, so the well tabs, splits,
 * floats and pops queries out with no knowledge that they are SQL.
 */
@Service()
export class DatabaseQueryOpener {
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);
  private readonly dockState: DockState = inject(DockState);
  private readonly dockFocus: DockFocus = inject(DockFocus);
  private readonly workspace: DatabaseWorkspace = inject(DatabaseWorkspace);

  /**
   * Opens a query in the well, activating it when it is already open.
   * @param id The query's id.
   * @param options How to open it; in the background — on an agent's account — it goes in behind the
   * query the user is looking at, and nothing takes focus.
   */
  public open(id: string, options?: OpenOptions): void {
    const background: boolean = options?.background === true;
    const query: DatabaseQuery | undefined = this.workspace.query(id);
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    if (query === undefined || well === null) {
      return;
    }
    if (this.registry.has(id)) {
      if (!background) {
        this.dockState.setActive(well.id, id);
        this.dockFocus.focus(well.id);
      }
      return;
    }
    this.register(id, query.title);
    this.dockState.tabInto(well.id, id, options);
    if (!background) {
      this.dockFocus.focus(well.id);
    }
  }

  /**
   * Holds how each open query panel runs itself, so the ribbon's Execute runs the panel's selection
   * exactly as the panel's own button does.
   */
  private readonly runners: Map<string, () => void> = new Map<string, () => void>();

  /**
   * Records how an open query panel runs itself.
   * @param id The query's id.
   * @param run Runs the panel's selection, or all of it.
   * @returns Returns a function that forgets it again.
   */
  public attach(id: string, run: () => void): () => void {
    this.runners.set(id, run);
    return (): void => {
      if (this.runners.get(id) === run) {
        this.runners.delete(id);
      }
    };
  }

  /**
   * Runs an open query as its panel would.
   * @param id The query's id.
   */
  public run(id: string): void {
    this.runners.get(id)?.();
  }

  /**
   * Re-titles an open query's tab.
   * @param id The query's id.
   * @param title The new title.
   */
  public retitle(id: string, title: string): void {
    if (this.registry.has(id)) {
      this.register(id, title);
    }
  }

  /**
   * Registers a query's panel.
   * @param id The query's id.
   * @param title Its tab title.
   */
  private register(id: string, title: string): void {
    this.registry.register({
      id,
      title,
      icon: Icon.DATABASE_QUERY,
      role: 'document',
      component: QueryPanel,
    });
  }
}
