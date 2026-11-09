import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { Icon } from '@shared/angular/icons/icon';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { DatabaseWorkspace, OpenSession } from '../database-workspace/database-workspace';

/**
 * The Database Explorer's status strip — SSMS's query status bar: on the left, the document; at the
 * end, for the query open in the well, what it runs against (connection, server, database). How its
 * last run went is the well's own status strip's, beside the query. Mounted through the active view's injector, so it reads that tab's
 * own workspace and dock.
 */
@Component({
  selector: 'app-database-explorer-status',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatabaseExplorerStatus {
  private readonly workspace: DatabaseWorkspace = inject(DatabaseWorkspace);
  private readonly dockState: DockState = inject(DockState);

  /**
   * Gets the query open in the well.
   */
  private readonly activeQuery: Signal<DatabaseQuery | undefined> = computed(
    (): DatabaseQuery | undefined => {
      const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
      return well?.active === undefined || well.active === null
        ? undefined
        : this.workspace.query(well.active);
    },
  );

  /**
   * Gets the document's path, marked while unsaved.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const path: string = this.workspace.filePath() ?? 'New Document';
      return [
        { id: 'database-path', text: this.workspace.dirty() ? `${path} ●` : path, shrink: 'start' },
      ];
    },
  );

  /**
   * Gets the open query's connection, server, database and last run.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const query: DatabaseQuery | undefined = this.activeQuery();
      if (query === undefined) {
        return [];
      }
      const connection: DatabaseConnection | undefined = this.workspace.connection(
        query.connectionId,
      );
      const open: OpenSession | undefined =
        connection === undefined ? undefined : this.workspace.sessions().get(connection.id);
      const segments: StatusSegment[] = [];
      if (query.database !== undefined) {
        segments.push({ id: 'database-database', text: query.database, icon: Icon.DATABASE });
      }
      segments.push({
        id: 'database-connection',
        text:
          connection === undefined
            ? 'No connection'
            : open === undefined
              ? `${connection.name} · not connected`
              : `${connection.name} · ${open.serverVersion}`,
        icon: Icon.DATABASE_CONNECTION,
        title: 'The connection this query runs against',
      });
      return segments;
    },
  );
}
