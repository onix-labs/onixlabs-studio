import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ConnectionField, DatabaseEngineInfo } from '@shared/api/database-engine-protocol';
import { DatabaseConnection } from '@shared/api/database-document';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import {
  DatabaseSelection,
  DatabaseWorkspace,
  OpenSession,
} from '../../database-workspace/database-workspace';

/**
 * The Properties panel's columns.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Property', width: '40%' },
  { id: 'value', header: 'Value' },
];

/**
 * The Database Explorer's Properties panel — SSMS's F4 window: the facts about whatever is selected.
 * A tree node shows what its engine said about it; a connection shows its engine, its server and its
 * settings (never a secret); a graph element or a grid row shows its properties.
 */
@Component({
  selector: 'app-properties-panel',
  imports: [Table, TableRowDef],
  template: `
    @if (title(); as title) {
      <p class="properties__title">{{ title }}</p>
    }
    <app-table
      class="properties__table"
      [columns]="columns"
      [rows]="rows()"
      emptyText="Select an object to see its properties."
    >
      <ng-template appTableRow let-row>
        <td class="properties__name">{{ row.data.name }}</td>
        <td class="properties__value" [title]="row.data.value">{{ row.data.value }}</td>
      </ng-template>
    </app-table>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      block-size: 100%;
      min-block-size: 0;
    }
    .properties__title {
      margin: 0;
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--body-foreground-color);
      border-block-end: 0.0625rem solid var(--dock-border-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .properties__table {
      flex: 1 1 auto;
      min-block-size: 0;
    }
    .properties__name {
      color: var(--form-muted-foreground-color);
    }
    .properties__value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropertiesPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  private readonly workspace: DatabaseWorkspace = inject(DatabaseWorkspace);
  protected readonly columns: readonly TableColumn[] = COLUMNS;

  /**
   * Gets the name of what is selected.
   */
  protected readonly title: Signal<string | null> = computed((): string | null => {
    const selection: DatabaseSelection | null = this.workspace.selection();
    switch (selection?.kind) {
      case 'connection':
        return this.workspace.connection(selection.connectionId)?.name ?? null;
      case 'node':
        return selection.node.label;
      case 'graph':
        return selection.title;
      default:
        return null;
    }
  });

  /**
   * Gets the selection's properties as table rows.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.properties().map(
      (property: { readonly name: string; readonly value: string }, index: number): TableRow => ({
        id: `${index}`,
        data: property,
      }),
    ),
  );

  /**
   * Gets the selection's properties.
   */
  private readonly properties: Signal<
    readonly { readonly name: string; readonly value: string }[]
  > = computed(() => {
    const selection: DatabaseSelection | null = this.workspace.selection();
    switch (selection?.kind) {
      case 'connection':
        return this.connectionProperties(selection.connectionId);
      case 'node':
        return selection.node.properties ?? [{ name: 'Name', value: selection.node.label }];
      case 'graph':
        return selection.properties;
      default:
        return [];
    }
  });

  /**
   * Lists a connection's properties: its engine, its server when connected, and its non-secret fields.
   * @param id The connection's id.
   * @returns Returns the properties.
   */
  private connectionProperties(
    id: string,
  ): readonly { readonly name: string; readonly value: string }[] {
    const connection: DatabaseConnection | undefined = this.workspace.connection(id);
    if (connection === undefined) {
      return [];
    }
    const engine: DatabaseEngineInfo | undefined = this.workspace.engine(connection.engine);
    const open: OpenSession | undefined = this.workspace.sessions().get(id);
    return [
      { name: 'Engine', value: engine?.displayName ?? connection.engine },
      { name: 'State', value: open === undefined ? 'Not connected' : 'Connected' },
      ...(open === undefined ? [] : [{ name: 'Server', value: open.serverVersion }]),
      ...(engine?.connectionFields ?? [])
        .filter((field: ConnectionField): boolean => field.secret !== true)
        .map((field: ConnectionField) => ({
          name: field.label,
          value: connection.values[field.id] ?? '',
        })),
    ];
  }
}
