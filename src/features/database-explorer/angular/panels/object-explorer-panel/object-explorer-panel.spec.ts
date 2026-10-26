import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { TreeRow } from '@shared/angular/components/tree-view/tree-view';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { DatabaseEnginePrompt } from '@shared/angular/services/plugins/database-engine-prompt';
import { PluginSummary } from '@shared/api/plugin-channels';
import {
  ConnectOutcome,
  DatabaseEngineInfo,
  DatabaseNode,
  ExpandOutcome,
} from '@shared/api/database-engine-protocol';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { DatabaseClient } from '../../database-client/database-client';
import { DatabasePrompts } from '../../database-prompts/database-prompts';
import { DatabaseQueryOpener } from '../../database-query-opener/database-query-opener';
import { DatabaseWorkspace } from '../../database-workspace/database-workspace';
import { ObjectExplorerPanel } from './object-explorer-panel';

/**
 * A SQLite-shaped engine.
 */
const SQLITE: DatabaseEngineInfo = {
  id: 'sqlite',
  displayName: 'SQLite',
  language: 'sql',
  queryExtension: 'sql',
  capabilities: ['script'],
  connectionFields: [{ id: 'file', label: 'File', kind: 'file' }],
};

/**
 * The top of a connected tree: one folder.
 */
const TABLES: DatabaseNode = { path: 'tables', label: 'Tables', icon: 'folder', leaf: false };

/**
 * A table under the folder.
 */
const ORDERS: DatabaseNode = {
  path: 'tables/orders',
  label: 'orders',
  icon: 'table',
  leaf: true,
  actions: [{ id: 'select-top', label: 'Select Top 100' }],
};

/**
 * A stand-in engine client answering from fixed data.
 */
class FakeClient {
  /**
   * Holds the engines main reports.
   */
  public available: readonly DatabaseEngineInfo[] = [SQLITE];

  /**
   * Resolves the engines.
   * @returns Returns the engines.
   */
  public engines(): Promise<readonly DatabaseEngineInfo[]> {
    return Promise.resolve(this.available);
  }

  /**
   * Resolves a connection.
   * @returns Returns a connected outcome.
   */
  public connect(): Promise<ConnectOutcome> {
    return Promise.resolve({ kind: 'connected', session: 's1', serverVersion: 'SQLite 3.46' });
  }

  /**
   * Resolves once closed.
   * @returns Returns once closed.
   */
  public disconnect(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Answers the tree from fixed data.
   * @param session The session.
   * @param path The path.
   * @returns Returns the children.
   */
  public expand(session: string, path: string | null): Promise<ExpandOutcome> {
    return Promise.resolve({
      kind: 'nodes',
      nodes: path === null ? [TABLES] : path === 'tables' ? [ORDERS] : [],
    });
  }
}

/**
 * Lets queued promise callbacks run.
 * @returns Returns a promise resolving after the task queue drains.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('ObjectExplorerPanel', () => {
  let fixture: ComponentFixture<ObjectExplorerPanel>;
  let component: ObjectExplorerPanel;
  let workspace: DatabaseWorkspace;
  let client: FakeClient;
  let candidates: WritableSignal<readonly PluginSummary[]>;
  let installedKey: WritableSignal<string>;
  let installs: string[];
  let opened: string[];
  let connectPrompts: string[];
  let newConnectionPrompts: number;

  /**
   * Reads the panel's protected members, which are what the template binds to.
   */
  interface PanelInternals {
    readonly rows: () => readonly TreeRow[];
    readonly query: { set: (value: string) => void };
    onRowClick(row: TreeRow): void;
    installEngine(plugin: PluginSummary): void;
  }

  /**
   * Gets the panel's internals for assertion.
   * @returns Returns the panel, typed to its protected surface.
   */
  function panel(): PanelInternals {
    return component as unknown as PanelInternals;
  }

  /**
   * Gets the rendered element.
   * @returns Returns the host element.
   */
  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Describes each row by its kind and label, in order.
   * @returns Returns one line per row.
   */
  function describeRows(): string[] {
    return panel()
      .rows()
      .map((row: TreeRow): string => {
        const data: {
          kind: string;
          label?: string;
          node?: DatabaseNode;
          query?: DatabaseQuery;
          count?: number;
        } = row.data as {
          kind: string;
          label?: string;
          node?: DatabaseNode;
          query?: DatabaseQuery;
          count?: number;
        };
        const label: string =
          data.label ??
          data.node?.label ??
          data.query?.title ??
          (data.kind === 'queries' ? `Queries (${data.count})` : '');
        return `${'  '.repeat(row.depth)}${data.kind}:${label}`;
      });
  }

  /**
   * Finds a row by id.
   * @param id The row's id.
   * @returns Returns the row.
   */
  function row(id: string): TreeRow {
    const found: TreeRow | undefined = panel()
      .rows()
      .find((candidate: TreeRow): boolean => candidate.id === id);
    if (found === undefined) {
      throw new Error(`No row ${id}`);
    }
    return found;
  }

  /**
   * Builds the panel and lets the workspace hear which engines there are.
   */
  async function build(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ObjectExplorerPanel],
      providers: [
        DatabaseWorkspace,
        { provide: DatabaseClient, useValue: client },
        { provide: FileSystem, useValue: {} },
        {
          provide: DatabaseEnginePrompt,
          useValue: {
            installedKey,
            candidates,
            install: (plugin: PluginSummary): Promise<void> => {
              installs.push(plugin.id);
              return Promise.resolve();
            },
          },
        },
        {
          provide: DatabasePrompts,
          useValue: {
            connect: (id: string): void => {
              connectPrompts.push(id);
            },
            newConnection: (): void => {
              newConnectionPrompts += 1;
            },
            editConnection: (): void => undefined,
          },
        },
        {
          provide: DatabaseQueryOpener,
          useValue: {
            open: (id: string): void => {
              opened.push(id);
            },
            retitle: (): void => undefined,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ObjectExplorerPanel);
    component = fixture.componentInstance;
    workspace = TestBed.inject(DatabaseWorkspace);
    fixture.componentRef.setInput('panel', {
      id: 'objects',
      title: 'Object Explorer',
      icon: Icon.DATABASE_CONNECTION,
      role: 'tool',
      component: ObjectExplorerPanel,
    } satisfies DockPanel);
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  /**
   * Builds a plugin summary offering a database engine.
   * @param id The plugin's id.
   * @returns Returns the summary.
   */
  function candidate(id: string): PluginSummary {
    return {
      id,
      name: `${id} plugin`,
      description: '',
      state: 'available',
      contributions: [{ slot: 'database-engine', id, displayName: id, priority: 100 }],
      version: '1.0.0',
      detail: null,
      origin: null,
      installedVersion: null,
    };
  }

  beforeEach(() => {
    client = new FakeClient();
    candidates = signal<readonly PluginSummary[]>([]);
    installedKey = signal<string>('sqlite');
    installs = [];
    opened = [];
    connectPrompts = [];
    newConnectionPrompts = 0;
  });

  // --- Empty states ---

  it('render_withNoEngineInstalled_saysSoAndOffersTheFirstCandidate', async () => {
    client.available = [];
    candidates.set([candidate('sqlite-engine'), candidate('postgres-engine')]);
    await build();

    const text: string = element().textContent ?? '';
    expect(text).toContain('No database engine is installed');
    expect(text).not.toContain('No connections yet');
    // The first the catalogue lists is offered; the rest are a visit to Plugins away.
    const buttons: string[] = [...element().querySelectorAll('app-button')].map(
      (button: Element): string => button.textContent?.trim() ?? '',
    );
    expect(buttons).toContain('Install sqlite-engine plugin');
    expect(buttons).not.toContain('Install postgres-engine plugin');
    expect(element().querySelector('app-tree-view')).toBeNull();
  });

  it('installEngine_installsTheOfferedPlugin', async () => {
    client.available = [];
    candidates.set([candidate('sqlite-engine')]);
    await build();

    panel().installEngine(candidate('sqlite-engine'));
    await settle();

    expect(installs).toEqual(['sqlite-engine']);
  });

  it('render_withNoEngineAndNothingToInstall_saysThereIsNothingToInstall', async () => {
    client.available = [];
    await build();

    const text: string = element().textContent ?? '';
    expect(text).toContain('No database engine is installed');
    expect(text).toContain('No database engine plugin is available to install.');
  });

  it('render_whileTheEnginesAreStillBeingAsked_doesNotSayNoneIsInstalled', async () => {
    // Until main answers, "no engine is installed" would be a guess.
    client.engines = (): Promise<readonly DatabaseEngineInfo[]> =>
      new Promise<readonly DatabaseEngineInfo[]>((): void => undefined);
    await build();

    const text: string = element().textContent ?? '';
    expect(text).not.toContain('No database engine is installed');
    expect(text).toContain('No connections yet');
  });

  it('render_withAnEngineButNoConnections_saysNoConnectionsYet', async () => {
    await build();

    const text: string = element().textContent ?? '';
    expect(text).toContain('No connections yet');
    expect(text).not.toContain('No database engine is installed');
    element().querySelector<HTMLElement>('app-button[label="New Connection"] button')?.click();
    expect(newConnectionPrompts).toBe(1);
  });

  it('render_withAConnectionButNoEngine_showsTheTreeNotTheEngineOffer', async () => {
    // A document opened before its engine is installed still lists what it holds.
    client.available = [];
    candidates.set([candidate('sqlite-engine')]);
    await build();
    workspace.addConnection('Local', 'sqlite', { file: '/a.db' });
    fixture.detectChanges();

    expect(element().textContent).not.toContain('No database engine is installed');
    expect(element().querySelector('app-tree-view')).not.toBeNull();
  });

  // --- Rows ---

  it('rows_listEachConnectionFoldedUntilOpened', async () => {
    await build();
    workspace.addConnection('Local', 'sqlite', { file: '/a.db' });
    workspace.addConnection('Other', 'sqlite', { file: '/b.db' });

    expect(describeRows()).toEqual(['connection:Local', 'connection:Other']);
    expect(row(`c:${workspace.connections()[0].id}`).expanded).toBe(false);
  });

  it('rows_connectionDetail_isTheEngineUntilConnected', async () => {
    await build();
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});

    expect((row(`c:${connection.id}`).data as { detail: string }).detail).toBe('SQLite');

    await workspace.connect(connection.id);
    expect((row(`c:${connection.id}`).data as { detail: string }).detail).toBe('SQLite 3.46');
  });

  it('rows_whenAConnectionConnects_unfoldToItsQueriesThenItsObjects', async () => {
    await build();
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    workspace.addQuery(connection.id, undefined, 'select 1', 'Recent orders');

    await workspace.connect(connection.id);
    fixture.detectChanges();

    expect(describeRows()).toEqual([
      'connection:Local',
      '  queries:Queries (1)',
      '    query:Recent orders',
      '  node:Tables',
    ]);
    expect((row(`c:${connection.id}`).data as { state: string }).state).toBe('open');
  });

  it('rows_expandingAFolder_showsItsObjects', async () => {
    await build();
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    await workspace.connect(connection.id);
    fixture.detectChanges();

    const tables: TreeRow | undefined = panel()
      .rows()
      .find((candidateRow: TreeRow): boolean => candidateRow.id.endsWith('tables'));
    panel().onRowClick(tables!);
    await settle();

    expect(describeRows()).toEqual([
      'connection:Local',
      '  queries:Queries (0)',
      '  node:Tables',
      '    node:orders',
    ]);
  });

  it('rows_queriesBelongToTheirOwnConnection', async () => {
    await build();
    const first: DatabaseConnection = workspace.addConnection('First', 'sqlite', {});
    const second: DatabaseConnection = workspace.addConnection('Second', 'sqlite', {});
    workspace.addQuery(first.id, undefined, '', 'Mine');
    workspace.addQuery(second.id, undefined, '', 'Theirs');
    await workspace.connect(first.id);
    fixture.detectChanges();

    const lines: string[] = describeRows();
    expect(lines).toContain('    query:Mine');
    expect(lines).not.toContain('    query:Theirs');
  });

  it('rows_aClosedConnectionClicked_asksToConnect', async () => {
    await build();
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});

    panel().onRowClick(row(`c:${connection.id}`));

    expect(connectPrompts).toEqual([connection.id]);
    expect(workspace.selection()).toEqual({ kind: 'connection', connectionId: connection.id });
  });

  it('rows_aFailedConnection_showsWhyUnderneath', async () => {
    await build();
    client.connect = (): Promise<ConnectOutcome> =>
      Promise.resolve({ kind: 'failure', message: 'file not found' });
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    panel().onRowClick(row(`c:${connection.id}`));
    await workspace.connect(connection.id);

    expect(row(`c:${connection.id}`).tone).toBe('danger');
    expect(describeRows()).toEqual([
      'connection:Local',
      '  queries:Queries (0)',
      '  status:file not found',
    ]);
  });

  it('rows_aQueryClicked_opensIt', async () => {
    await build();
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, '', 'Q');
    await workspace.connect(connection.id);
    fixture.detectChanges();

    panel().onRowClick(row(`q:${query.id}`));

    expect(opened).toEqual([query.id]);
  });

  it('rows_search_filtersTheLoadedTreeKeepingAncestors', async () => {
    await build();
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    await workspace.connect(connection.id);
    await workspace.expand(connection.id, 'tables');
    workspace.addConnection('Unrelated', 'sqlite', {});

    panel().query.set('ord');

    expect(describeRows()).toEqual(['connection:Local', '  node:Tables', '    node:orders']);
  });

  // --- Menus ---

  it('contextMenuFor_aNode_offersTheEngineActionsFirst', async () => {
    await build();
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    await workspace.connect(connection.id);
    fixture.detectChanges();
    panel().onRowClick(
      panel()
        .rows()
        .find((candidateRow: TreeRow): boolean => candidateRow.id.endsWith('tables'))!,
    );
    await settle();
    const orders: TreeRow = panel()
      .rows()
      .find((candidateRow: TreeRow): boolean => candidateRow.id.endsWith('orders'))!;

    const labels: string[] = component
      .contextMenuFor(orders)
      .filter((item: MenuItem): boolean => item.separator !== true)
      .map((item: MenuItem): string => item.label);

    expect(labels).toEqual(['Select Top 100', 'New Query']);
  });

  it('onContextAction_deleteConnection_removesItAndItsQueriesOnConfirm', async () => {
    await build();
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    workspace.addQuery(connection.id, undefined);
    component.onContextAction({
      itemId: 'studio.delete',
      row: row(`c:${connection.id}`),
    });

    (component as unknown as { confirmDelete(): void }).confirmDelete();
    await settle();

    expect(workspace.connections()).toEqual([]);
    expect(workspace.queries()).toEqual([]);
  });
});
