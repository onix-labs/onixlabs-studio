import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { DatabaseEngineInfo, DatabaseNode } from '@shared/api/database-engine-protocol';
import { DatabaseQuery } from '@shared/api/database-document';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { ExplorerToolbar } from '@shared/angular/components/explorer-toolbar/explorer-toolbar';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import {
  TreeEdit,
  TreeMenuSelection,
  TreeRow,
  TreeView,
} from '@shared/angular/components/tree-view/tree-view';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DatabaseEnginePrompt } from '@shared/angular/services/plugins/database-engine-prompt';
import { PluginSummary } from '@shared/api/plugin-channels';
import { DATABASE_NODE_ICONS } from '../../database-icons';
import { DatabasePrompts } from '../../database-prompts/database-prompts';
import { DatabaseQueryOpener } from '../../database-query-opener/database-query-opener';
import {
  DatabaseWorkspace,
  NodeChildren,
  nodeKey,
  OpenSession,
} from '../../database-workspace/database-workspace';

/**
 * The menu commands Studio adds to every row kind, beside the engine's own node actions.
 */
const ACTION_CONNECT: string = 'studio.connect';
const ACTION_DISCONNECT: string = 'studio.disconnect';
const ACTION_NEW_QUERY: string = 'studio.new-query';
const ACTION_REFRESH: string = 'studio.refresh';
const ACTION_EDIT: string = 'studio.edit';
const ACTION_DELETE: string = 'studio.delete';
const ACTION_NEW_CONNECTION: string = 'studio.new-connection';
const ACTION_OPEN: string = 'studio.open';
const ACTION_RENAME: string = 'studio.rename';

/**
 * What a tree row stands for.
 */
type ObjectRow =
  | {
      readonly kind: 'connection';
      readonly connectionId: string;
      readonly label: string;
      readonly detail: string;
      readonly state: 'closed' | 'connecting' | 'open' | 'failed';
    }
  | { readonly kind: 'node'; readonly connectionId: string; readonly node: DatabaseNode }
  | { readonly kind: 'status'; readonly label: string; readonly failed: boolean }
  | { readonly kind: 'queries'; readonly connectionId: string; readonly count: number }
  | { readonly kind: 'query'; readonly query: DatabaseQuery };

/**
 * A row waiting on the delete confirmation.
 */
interface DeleteTarget {
  readonly kind: 'connection' | 'query';
  readonly id: string;
  readonly label: string;
}

/**
 * The Database Explorer's Object Explorer: the document's connections, each one's objects as its engine
 * describes them, and the saved queries. It wears the same explorer tool strip and tree as the Solution
 * and API Explorers.
 *
 * The tree loads lazily: a node's children are asked for when it is first expanded, and nothing is
 * introspected ahead of the user. Introspecting eagerly is the single most complained-about thing in
 * DataGrip on a large schema, and SSMS's Object Explorer works the same lazy way.
 */
@Component({
  selector: 'app-object-explorer-panel',
  imports: [AppIcon, ExplorerToolbar, TreeView, Modal, ModalContent, Button, ButtonRow],
  templateUrl: './object-explorer-panel.html',
  styleUrl: './object-explorer-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObjectExplorerPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  protected readonly workspace: DatabaseWorkspace = inject(DatabaseWorkspace);
  protected readonly prompts: DatabasePrompts = inject(DatabasePrompts);
  private readonly opener: DatabaseQueryOpener = inject(DatabaseQueryOpener);
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the offer of an engine to a tab that has none.
   */
  private readonly enginePrompt: DatabaseEnginePrompt = inject(DatabaseEnginePrompt);

  /**
   * Gets the engine plugin the empty state offers, or null when none is available — the first the
   * catalogue lists; the rest are a visit to Plugins away.
   */
  protected readonly engineCandidate: Signal<PluginSummary | null> = computed(
    (): PluginSummary | null => this.enginePrompt.candidates()[0] ?? null,
  );

  /**
   * Gets whether the offered engine is being installed.
   */
  protected readonly installing: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the ids of the expanded rows.
   */
  private readonly expanded: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the connections whose Queries folder the user has folded. Open is the default — a query is
   * what a user reaches for most — so this records the exceptions rather than the rule.
   */
  private readonly foldedQueries: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the selected row's id.
   */
  protected readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the search text the tree is filtered by.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Holds the query being renamed in place, or null.
   */
  protected readonly renameTarget: WritableSignal<{
    readonly rowId: string;
    readonly title: string;
  } | null> = signal<{ readonly rowId: string; readonly title: string } | null>(null);

  /**
   * Holds the row awaiting a delete confirmation.
   */
  protected readonly deleteTarget: WritableSignal<DeleteTarget | null> =
    signal<DeleteTarget | null>(null);

  /**
   * Holds the connections already seen open, so only a connection that has just connected unfolds.
   */
  private readonly seenOpen: Set<string> = new Set<string>();

  /**
   * Unfolds a connection the moment it connects, wherever it was connected from — the dialog, the
   * tree, a query running — so connecting shows what is there rather than a row folded shut.
   */
  public constructor() {
    effect((): void => {
      const open: readonly string[] = [...this.workspace.sessions().keys()];
      untracked((): void => {
        for (const id of open) {
          if (!this.seenOpen.has(id)) {
            this.seenOpen.add(id);
            this.expand(`c:${id}`);
          }
        }
        for (const id of [...this.seenOpen]) {
          if (!open.includes(id)) {
            this.seenOpen.delete(id);
          }
        }
      });
    });
  }

  /**
   * Gets the toolbar's more-actions menu.
   */
  protected readonly moreItems: readonly MenuItem[] = [
    { id: ACTION_NEW_CONNECTION, label: 'New Connection', icon: Icon.DATABASE_CONNECTION },
    { id: ACTION_NEW_QUERY, label: 'New Query', icon: Icon.DATABASE_QUERY },
  ];

  /**
   * Gets the tree's flattened rows: each connection with its saved queries first, then whatever of
   * its object tree has been expanded.
   *
   * A search filters the *loaded* tree — it does not go and introspect everything to find a match —
   * and keeps every ancestor of a match so it is visible where it lives.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const filter: string = this.query().trim().toLowerCase();
    const expanded: ReadonlySet<string> = this.expanded();
    const sessions: ReadonlyMap<string, OpenSession> = this.workspace.sessions();
    const connecting: ReadonlySet<string> = this.workspace.connecting();
    const errors: ReadonlyMap<string, string> = this.workspace.connectionErrors();
    const children: ReadonlyMap<string, NodeChildren> = this.workspace.children();
    const folded: ReadonlySet<string> = this.foldedQueries();
    const allQueries: readonly DatabaseQuery[] = this.workspace.queries();
    const rows: TreeRow[] = [];

    for (const connection of this.workspace.connections()) {
      const id: string = `c:${connection.id}`;
      const open: OpenSession | undefined = sessions.get(connection.id);
      const error: string | undefined = errors.get(connection.id);
      const state: 'closed' | 'connecting' | 'open' | 'failed' = connecting.has(connection.id)
        ? 'connecting'
        : open !== undefined
          ? 'open'
          : error !== undefined
            ? 'failed'
            : 'closed';
      const engine: DatabaseEngineInfo | undefined = this.workspace.engine(connection.engine);
      const below: TreeRow[] = [];
      if (filter !== '' || expanded.has(id)) {
        below.push(...this.queryRows(connection.id, allQueries, folded, filter));
        if (state === 'connecting') {
          below.push(this.statusRow(`${id}:status`, 1, 'Connecting…', false));
        } else if (state === 'failed') {
          below.push(this.statusRow(`${id}:status`, 1, error ?? 'Could not connect.', true));
        } else if (state === 'open') {
          below.push(...this.nodeRows(connection.id, null, 1, children, expanded, filter));
        }
      }
      const matches: boolean = filter === '' || connection.name.toLowerCase().includes(filter);
      if (!matches && below.length === 0) {
        continue;
      }
      rows.push({
        id,
        depth: 0,
        expandable: true,
        expanded: expanded.has(id) || (filter !== '' && below.length > 0),
        tone: state === 'failed' ? 'danger' : undefined,
        hint: error,
        data: {
          kind: 'connection',
          connectionId: connection.id,
          label: connection.name,
          detail: open?.serverVersion ?? engine?.displayName ?? connection.engine,
          state,
        } satisfies ObjectRow,
      });
      rows.push(...below);
    }

    return rows;
  });

  /**
   * Builds a connection's Queries folder and, unless it is folded, the queries written against it.
   * @param connectionId The connection.
   * @param queries Every saved query.
   * @param folded The connections whose Queries folder is folded.
   * @param filter The lower-cased search text.
   * @returns Returns the rows, or none while a search matches none of the connection's queries.
   */
  private queryRows(
    connectionId: string,
    queries: readonly DatabaseQuery[],
    folded: ReadonlySet<string>,
    filter: string,
  ): TreeRow[] {
    const own: readonly DatabaseQuery[] = queries.filter(
      (query: DatabaseQuery): boolean => query.connectionId === connectionId,
    );
    const shown: readonly DatabaseQuery[] =
      filter === ''
        ? own
        : own.filter((query: DatabaseQuery): boolean => query.title.toLowerCase().includes(filter));
    if (filter !== '' && shown.length === 0) {
      return [];
    }
    const open: boolean = filter !== '' || !folded.has(connectionId);
    const rows: TreeRow[] = [
      {
        id: `qg:${connectionId}`,
        depth: 1,
        expandable: own.length > 0,
        expanded: open && own.length > 0,
        data: { kind: 'queries', connectionId, count: own.length } satisfies ObjectRow,
      },
    ];
    if (open) {
      for (const query of shown) {
        rows.push({
          id: `q:${query.id}`,
          depth: 2,
          expandable: false,
          expanded: false,
          data: { kind: 'query', query } satisfies ObjectRow,
        });
      }
    }
    return rows;
  }

  /**
   * Builds the rows beneath one node, recursing into the expanded ones.
   * @param connectionId The connection.
   * @param path The node's path, or null for the connection's top.
   * @param depth The depth of the children.
   * @param children The loaded children.
   * @param expanded The expanded row ids.
   * @param filter The lower-cased search text.
   * @returns Returns the rows.
   */
  private nodeRows(
    connectionId: string,
    path: string | null,
    depth: number,
    children: ReadonlyMap<string, NodeChildren>,
    expanded: ReadonlySet<string>,
    filter: string,
  ): TreeRow[] {
    const key: string = nodeKey(connectionId, path);
    const loaded: NodeChildren | undefined = children.get(key);
    if (loaded === undefined) {
      return [];
    }
    if (loaded.state === 'loading') {
      return filter === '' ? [this.statusRow(`l:${key}`, depth, 'Loading…', false)] : [];
    }
    if (loaded.state === 'failed') {
      return [this.statusRow(`f:${key}`, depth, loaded.message, true)];
    }
    const rows: TreeRow[] = [];
    for (const node of loaded.nodes) {
      const id: string = `n:${nodeKey(connectionId, node.path)}`;
      const open: boolean = !node.leaf && expanded.has(id);
      const below: TreeRow[] =
        open || (filter !== '' && !node.leaf)
          ? this.nodeRows(connectionId, node.path, depth + 1, children, expanded, filter)
          : [];
      const matches: boolean = filter === '' || node.label.toLowerCase().includes(filter);
      if (!matches && below.length === 0) {
        continue;
      }
      rows.push({
        id,
        depth,
        expandable: !node.leaf,
        expanded: open || (filter !== '' && below.length > 0),
        data: { kind: 'node', connectionId, node } satisfies ObjectRow,
      });
      if (open || filter !== '') {
        rows.push(...below);
      }
    }
    return rows;
  }

  /**
   * Builds a muted status row: loading, connecting, or why something failed.
   * @param id The row's id.
   * @param depth Its depth.
   * @param label What it says.
   * @param failed Whether it reports a failure.
   * @returns Returns the row.
   */
  private statusRow(id: string, depth: number, label: string, failed: boolean): TreeRow {
    return {
      id,
      depth,
      expandable: false,
      expanded: false,
      disabled: true,
      tone: failed ? 'danger' : 'muted',
      hint: label,
      data: { kind: 'status', label, failed } satisfies ObjectRow,
    };
  }

  /**
   * Builds a row's context menu: the engine's actions for a node, and Studio's own commands.
   */
  public readonly contextMenuFor: (row: TreeRow) => readonly MenuItem[] = (
    row: TreeRow,
  ): readonly MenuItem[] => {
    const data: ObjectRow = row.data as ObjectRow;
    switch (data.kind) {
      case 'connection': {
        const open: boolean = data.state === 'open';
        return [
          open
            ? { id: ACTION_DISCONNECT, label: 'Disconnect', icon: Icon.DATABASE_DISCONNECT }
            : { id: ACTION_CONNECT, label: 'Connect', icon: Icon.DATABASE_CONNECTION },
          { id: ACTION_NEW_QUERY, label: 'New Query', icon: Icon.DATABASE_QUERY },
          ...(open ? [{ id: ACTION_REFRESH, label: 'Refresh', icon: Icon.REFRESH }] : []),
          { id: 'sep', label: '', separator: true },
          { id: ACTION_EDIT, label: 'Edit Connection', icon: Icon.PENCIL },
          { id: ACTION_DELETE, label: 'Delete Connection', icon: Icon.TRASH },
        ];
      }
      case 'node':
        return [
          ...(data.node.actions ?? []).map((action) => ({ id: action.id, label: action.label })),
          ...((data.node.actions ?? []).length > 0
            ? [{ id: 'sep', label: '', separator: true }]
            : []),
          { id: ACTION_NEW_QUERY, label: 'New Query', icon: Icon.DATABASE_QUERY },
          ...(data.node.leaf ? [] : [{ id: ACTION_REFRESH, label: 'Refresh', icon: Icon.REFRESH }]),
        ];
      case 'query':
        return [
          { id: ACTION_OPEN, label: 'Open', icon: Icon.DATABASE_QUERY },
          { id: ACTION_RENAME, label: 'Rename', icon: Icon.PENCIL },
          { id: 'sep', label: '', separator: true },
          { id: ACTION_DELETE, label: 'Delete Query', icon: Icon.TRASH },
        ];
      case 'queries':
        return [{ id: ACTION_NEW_QUERY, label: 'New Query', icon: Icon.DATABASE_QUERY }];
      default:
        return [];
    }
  };

  /**
   * Runs a context-menu command.
   * @param selection The chosen item and its row.
   */
  public onContextAction(selection: TreeMenuSelection): void {
    const data: ObjectRow = selection.row.data as ObjectRow;
    switch (selection.itemId) {
      case ACTION_CONNECT:
        if (data.kind === 'connection') {
          this.expand(selection.row.id);
          this.prompts.connect(data.connectionId);
        }
        return;
      case ACTION_DISCONNECT:
        if (data.kind === 'connection') {
          void this.workspace.disconnect(data.connectionId);
        }
        return;
      case ACTION_NEW_QUERY:
        this.newQuery(data);
        return;
      case ACTION_REFRESH:
        if (data.kind === 'connection') {
          void this.workspace.refresh(data.connectionId, null);
        } else if (data.kind === 'node') {
          void this.workspace.refresh(data.connectionId, data.node.path);
        }
        return;
      case ACTION_EDIT:
        if (data.kind === 'connection') {
          this.prompts.editConnection(data.connectionId);
        }
        return;
      case ACTION_DELETE:
        if (data.kind === 'connection') {
          this.deleteTarget.set({ kind: 'connection', id: data.connectionId, label: data.label });
        } else if (data.kind === 'query') {
          this.deleteTarget.set({ kind: 'query', id: data.query.id, label: data.query.title });
        }
        return;
      case ACTION_RENAME:
        if (data.kind === 'query') {
          this.renameTarget.set({ rowId: selection.row.id, title: data.query.title });
        }
        return;
      case ACTION_OPEN:
        if (data.kind === 'query') {
          this.opener.open(data.query.id);
        }
        return;
      default:
        if (data.kind === 'node') {
          void this.workspace
            .runAction(data.connectionId, data.node, selection.itemId)
            .then((query: DatabaseQuery | null): void => {
              if (query !== null) {
                this.opener.open(query.id);
              }
            });
        }
    }
  }

  /**
   * Opens a new query against whatever a row belongs to.
   * @param data The row, or null for the toolbar.
   */
  private newQuery(data: ObjectRow | null): void {
    const connectionId: string | null =
      data !== null &&
      (data.kind === 'connection' || data.kind === 'node' || data.kind === 'queries')
        ? data.connectionId
        : (this.workspace.connections()[0]?.id ?? null);
    const database: string | undefined = data?.kind === 'node' ? data.node.database : undefined;
    this.opener.open(this.workspace.addQuery(connectionId, database).id);
  }

  /**
   * Handles a row click: expands or collapses it (connecting a connection on the way), shows a node
   * in Properties, or opens a query.
   * @param row The clicked row.
   */
  protected onRowClick(row: TreeRow): void {
    const data: ObjectRow = row.data as ObjectRow;
    if (data.kind === 'status') {
      return;
    }
    this.selectedId.set(row.id);
    switch (data.kind) {
      case 'connection':
        this.workspace.select({ kind: 'connection', connectionId: data.connectionId });
        if (this.toggle(row.id) && data.state !== 'open' && data.state !== 'connecting') {
          this.prompts.connect(data.connectionId);
        }
        return;
      case 'node':
        this.workspace.select({ kind: 'node', connectionId: data.connectionId, node: data.node });
        if (!data.node.leaf && this.toggle(row.id)) {
          void this.workspace.expand(data.connectionId, data.node.path);
        }
        return;
      case 'queries':
        this.foldedQueries.update((ids: ReadonlySet<string>): ReadonlySet<string> => {
          const next: Set<string> = new Set<string>(ids);
          if (!next.delete(data.connectionId)) {
            next.add(data.connectionId);
          }
          return next;
        });
        return;
      case 'query':
        this.opener.open(data.query.id);
        return;
    }
  }

  /**
   * Runs a toolbar more-actions command.
   * @param id The command's id.
   */
  protected onMoreAction(id: string): void {
    if (id === ACTION_NEW_CONNECTION) {
      this.prompts.newConnection();
    } else if (id === ACTION_NEW_QUERY) {
      this.newQuery(null);
    }
  }

  /**
   * Folds every branch.
   */
  protected collapseAll(): void {
    this.expanded.set(new Set<string>());
  }

  /**
   * Opens every connection that is connected, and the queries.
   */
  protected expandAll(): void {
    this.expanded.update(
      (ids: ReadonlySet<string>): ReadonlySet<string> =>
        new Set<string>([
          ...ids,
          ...[...this.workspace.sessions().keys()].map((id: string): string => `c:${id}`),
        ]),
    );
  }

  /**
   * Applies an in-place rename to its query, keeping the query's tab title in step.
   * @param edit The committed edit.
   */
  protected commitRename(edit: TreeEdit): void {
    const data: ObjectRow = edit.row.data as ObjectRow;
    this.renameTarget.set(null);
    if (data.kind === 'query') {
      this.workspace.updateQuery(data.query.id, { title: edit.value });
      this.opener.retitle(data.query.id, edit.value);
    }
  }

  /**
   * Deletes the confirmed row.
   */
  protected confirmDelete(): void {
    const target: DeleteTarget | null = this.deleteTarget();
    this.deleteTarget.set(null);
    if (target?.kind === 'connection') {
      void this.workspace.removeConnection(target.id);
    } else if (target?.kind === 'query') {
      this.workspace.removeQuery(target.id);
    }
  }

  /**
   * Gets the glyph for a node's icon.
   * @param node The node.
   * @returns Returns the icon.
   */
  protected nodeIcon(node: DatabaseNode): Icon {
    return DATABASE_NODE_ICONS[node.icon] ?? Icon.API_COLLECTION;
  }

  /**
   * Expands a row.
   * @param id The row's id.
   */
  private expand(id: string): void {
    this.expanded.update(
      (ids: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...ids, id]),
    );
  }

  /**
   * Toggles a row.
   * @param id The row's id.
   * @returns Returns true when the row is now expanded.
   */
  private toggle(id: string): boolean {
    let open: boolean = false;
    this.expanded.update((ids: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(ids);
      if (!next.delete(id)) {
        next.add(id);
        open = true;
      }
      return next;
    });
    return open;
  }

  /**
   * Installs the engine the empty state offers. The workspace notices the new engine itself.
   * @param plugin The plugin to install.
   */
  protected installEngine(plugin: PluginSummary): void {
    this.installing.set(true);
    void this.enginePrompt.install(plugin).finally((): void => this.installing.set(false));
  }
}
