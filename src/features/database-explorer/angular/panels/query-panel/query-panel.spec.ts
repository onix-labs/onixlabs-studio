import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { DatabasePrompts } from '../../database-prompts/database-prompts';
import { Settings } from '@shared/angular/services/settings/settings';
import type * as MonacoApi from 'monaco-editor';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TableColumn, TableRow } from '@shared/angular/components/table/table';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { FileWriteResult } from '@shared/api/file-channels';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { isStudioProvider } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { DatabaseEnginePrompt } from '@shared/angular/services/plugins/database-engine-prompt';
import {
  ConnectOutcome,
  DatabaseEngineInfo,
  ExecuteOutcome,
  ExecuteRequest,
  ExpandOutcome,
  DatabaseValue,
  FetchRequest,
  QueryMessage,
  ResultSet,
} from '@shared/api/database-engine-protocol';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { DatabaseClient } from '../../database-client/database-client';
import {
  DatabaseCompletions,
  QueryCompletion,
} from '../../database-completions/database-completions';
import { DatabaseQueryOpener } from '../../database-query-opener/database-query-opener';
import { DatabaseWorkspace } from '../../database-workspace/database-workspace';
import { QueryPanel } from './query-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockNode } from '@shared/angular/services/dock-layout/dock-node';
import {
  DocumentStatus,
  DocumentStatusInfo,
} from '@shared/angular/services/document-status/document-status';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { GraphPick } from '../../graph-view/graph-view';

/**
 * A PostgreSQL-shaped engine: it reaches several databases and can cancel.
 */
const POSTGRES: DatabaseEngineInfo = {
  id: 'postgres',
  displayName: 'PostgreSQL',
  language: 'pgsql',
  queryExtension: 'sql',
  capabilities: ['cancel', 'multipleDatabases'],
  connectionFields: [{ id: 'host', label: 'Host', kind: 'text' }],
};

/**
 * A SQLite-shaped engine: one database, no cancel.
 */
const SQLITE: DatabaseEngineInfo = {
  id: 'sqlite',
  displayName: 'SQLite',
  language: 'sql',
  queryExtension: 'sql',
  capabilities: [],
  connectionFields: [{ id: 'file', label: 'File', kind: 'file' }],
};

/**
 * A stand-in engine client.
 */
class FakeClient {
  /**
   * Holds every execute.
   */
  public readonly executes: ExecuteRequest[] = [];

  /**
   * Holds every cancel.
   */
  public readonly cancels: string[] = [];

  /**
   * Holds the outcome every execute resolves with, minus its id.
   */
  public outcome: Omit<ExecuteOutcome, 'id'> = {
    resultSets: [
      {
        id: 'rs',
        columns: [{ name: 'id', type: 'int4' }, { name: 'name' }],
        rows: [
          [1, 'Ada'],
          [2, null],
        ],
        totalRows: 2,
        line: 1,
      },
    ],
    messages: [{ severity: 'info', text: '2 rows' }],
    elapsedMs: 3,
    failed: false,
    cancelled: false,
  };

  /**
   * Holds how an execute is held open, or null to answer at once.
   */
  public gate: Promise<void> | null = null;

  /**
   * Resolves the engines.
   * @returns Returns the engines.
   */
  public engines(): Promise<readonly DatabaseEngineInfo[]> {
    return Promise.resolve([POSTGRES, SQLITE]);
  }

  /**
   * Reports that this machine cannot seal secrets, so nothing is remembered.
   * @returns Returns false.
   */
  public canSealWithMachine(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * Resolves a connection.
   * @returns Returns a connected outcome.
   */
  public connect(): Promise<ConnectOutcome> {
    return Promise.resolve({ kind: 'connected', session: 's1', serverVersion: 'v' });
  }

  /**
   * Resolves once closed.
   * @returns Returns once closed.
   */
  public disconnect(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Answers the top of the tree with two databases.
   * @returns Returns the nodes.
   */
  public expand(): Promise<ExpandOutcome> {
    return Promise.resolve({
      kind: 'nodes',
      nodes: [
        { path: 'shop', label: 'shop', icon: 'database', leaf: false, database: 'shop' },
        { path: 'hr', label: 'hr', icon: 'database', leaf: false, database: 'hr' },
      ],
    });
  }

  /**
   * Records an execute.
   * @param request The request.
   * @returns Returns the configured outcome.
   */
  public async execute(request: ExecuteRequest): Promise<ExecuteOutcome> {
    this.executes.push(request);
    if (this.gate !== null) {
      await this.gate;
    }
    return { id: request.id, ...this.outcome };
  }

  /**
   * Records a cancel.
   * @param id The execution.
   */
  public cancel(id: string): void {
    this.cancels.push(id);
  }

  /**
   * Answers a fetch with no more rows, as an engine does once the result is gone.
   * @param request The request.
   * @returns Returns no rows.
   */
  public fetch(request: FetchRequest): Promise<readonly (readonly DatabaseValue[])[]> {
    void request;
    return Promise.resolve([]);
  }
}

/**
 * A stand-in for the file system, answering the save dialog and recording what was written.
 */
class FakeFileSystem {
  /**
   * Holds the path the save dialog answers, or null for a cancelled dialog.
   */
  public chosen: string | null = '/exports/out';

  /**
   * Holds the default names the save dialog was opened with.
   */
  public readonly dialogs: (string | undefined)[] = [];

  /**
   * Holds every text write.
   */
  public readonly writes: { path: string; content: string; hasBom: boolean }[] = [];

  /**
   * Holds every byte write.
   */
  public readonly byteWrites: { path: string; bytes: Uint8Array }[] = [];

  /**
   * Holds what every write answers.
   */
  public result: FileWriteResult = { success: true, path: '/exports/out' };

  /**
   * Answers the save dialog.
   * @param defaultPath The name it opens with.
   * @returns Returns {@link chosen}.
   */
  public saveDialog(defaultPath?: string): Promise<string | null> {
    this.dialogs.push(defaultPath);
    return Promise.resolve(this.chosen);
  }

  /**
   * Records a text write.
   * @param path The path.
   * @param content The text.
   * @param hasBom Whether a byte-order mark leads it.
   * @returns Returns {@link result}.
   */
  public write(path: string, content: string, hasBom: boolean = false): Promise<FileWriteResult> {
    this.writes.push({ path, content, hasBom });
    return Promise.resolve(this.result);
  }

  /**
   * Records a byte write.
   * @param path The path.
   * @param bytes The bytes.
   * @returns Returns {@link result}.
   */
  public writeBytes(path: string, bytes: Uint8Array): Promise<FileWriteResult> {
    this.byteWrites.push({ path, bytes });
    return Promise.resolve(this.result);
  }
}

/**
 * A stand-in for the completions service, recording what it is asked and answering {@link items}.
 */
class FakeCompletions {
  /**
   * Holds every completion asked for: the query, its text and the caret's offset.
   */
  public readonly asked: { queryId: string; text: string; offset: number }[] = [];

  /**
   * Holds what each completion answers.
   */
  public items: readonly QueryCompletion[] = [];

  /**
   * Records a completion.
   * @param queryId The query's id.
   * @param text The text.
   * @param offset The caret's offset.
   * @returns Returns {@link items}.
   */
  public complete(
    queryId: string,
    text: string,
    offset: number,
  ): Promise<readonly QueryCompletion[]> {
    this.asked.push({ queryId, text, offset });
    return Promise.resolve(this.items);
  }
}

/**
 * A completion provider registered with the fake Monaco, and whether it has been disposed.
 */
interface Registered {
  readonly language: string;
  readonly provider: MonacoApi.languages.CompletionItemProvider;
  disposed: boolean;
}

/**
 * A stand-in for the Monaco API, recording the completion providers registered with it.
 */
class FakeMonacoApi {
  public readonly registered: Registered[] = [];
  public readonly KeyMod: { CtrlCmd: number } = { CtrlCmd: 2048 };
  public readonly KeyCode: { Enter: number } = { Enter: 3 };
  public readonly MarkerSeverity: { Error: number } = { Error: 8 };
  public readonly markers: (readonly MonacoApi.editor.IMarkerData[])[] = [];
  public readonly editor: {
    setModelMarkers: (
      model: unknown,
      owner: string,
      markers: readonly MonacoApi.editor.IMarkerData[],
    ) => void;
  } = {
    setModelMarkers: (
      _model: unknown,
      _owner: string,
      markers: readonly MonacoApi.editor.IMarkerData[],
    ): void => {
      this.markers.push(markers);
    },
  };
  public readonly languages: {
    CompletionItemKind: Record<string, number>;
    registerCompletionItemProvider: (
      language: string,
      provider: MonacoApi.languages.CompletionItemProvider,
    ) => { dispose(): void };
  } = {
    CompletionItemKind: { Module: 8, Struct: 6, Interface: 7, Function: 1, Field: 3, Class: 5 },
    registerCompletionItemProvider: (
      language: string,
      provider: MonacoApi.languages.CompletionItemProvider,
    ): { dispose(): void } => {
      const entry: Registered = { language, provider, disposed: false };
      this.registered.push(entry);
      return {
        dispose: (): void => {
          entry.disposed = true;
        },
      };
    },
  };
}

/**
 * Builds a one-line text model.
 * @param text The line.
 * @returns Returns the model.
 */
function lineModel(text: string): MonacoApi.editor.ITextModel {
  return {
    getValue: (): string => text,
    getOffsetAt: (position: MonacoApi.IPosition): number => position.column - 1,
    getWordUntilPosition: (position: MonacoApi.IPosition): MonacoApi.editor.IWordAtPosition => {
      const word: string = /[\w$]*$/.exec(text.slice(0, position.column - 1))?.[0] ?? '';
      return { word, startColumn: position.column - word.length, endColumn: position.column };
    },
    getLineCount: (): number => 1,
  } as unknown as MonacoApi.editor.ITextModel;
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

describe('QueryPanel', () => {
  let fixture: ComponentFixture<QueryPanel>;
  let component: QueryPanel;
  let workspace: DatabaseWorkspace;
  let client: FakeClient;
  let attached: string[];
  let completions: FakeCompletions;
  let monacoApi: FakeMonacoApi;
  let files: FakeFileSystem;
  let notes: NotificationRequest[];

  /**
   * Reads the panel's protected members, which are what the template binds to.
   */
  interface PanelInternals {
    readonly query: () => DatabaseQuery | undefined;
    readonly language: () => string;
    readonly canRun: () => boolean;
    readonly running: () => boolean;
    readonly resultsVisible: () => boolean;
    readonly connectionOptions: () => readonly DropdownOption[];
    readonly databaseOptions: () => readonly DropdownOption[];
    readonly columns: () => readonly TableColumn[];
    readonly columnFit: WritableSignal<'view' | 'data'>;
    readonly gridWidth: WritableSignal<number>;
    readonly gridRows: () => readonly TableRow[];
    readonly rawJson: () => string;
    readonly errorCount: () => number;
    readonly tab: () => 'results' | 'messages';
    readonly moreItems: () => readonly MenuItem[];
    onMoreAction(id: string): void;
    onText(text: string): void;
    setConnection(id: string): void;
    setDatabase(name: string): void;
    onRowClick(row: TableRow): void;
    onRowSelect(select: { row: TableRow; toggle: boolean; range: boolean }): void;
    readonly resultTabs: () => readonly { value: string; badge?: number }[];
    readonly resultView: () => string;
    readonly resultsDefaultSize: () => number | null;
    readonly selectedRows: () => ReadonlySet<string>;
    readonly executeTooltip: () => string;
    chooseView(view: string): void;
    chooseResult(index: number): void;
    loadMore(): void;
    reveal(message: QueryMessage): void;
    onCursor(cursor: { line: number; column: number }): void;
    onGraphPick(pick: GraphPick): void;
    messageIcon(message: QueryMessage): Icon;
    resultLabel(set: ResultSet, index: number): string;
    onEditorReady(): void;
  }

  /**
   * Gets the panel's internals for assertion.
   * @returns Returns the panel, typed to its protected surface.
   */
  function panel(): PanelInternals {
    return component as unknown as PanelInternals;
  }

  /**
   * Builds the panel for a query. The template is left out: the editor is Monaco's, and what is under
   * test is the panel's model of its query, not the editor.
   * @param query The query the panel shows.
   */
  function build(query: DatabaseQuery): void {
    fixture = TestBed.createComponent(QueryPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', {
      id: query.id,
      title: query.title,
      icon: Icon.DATABASE_QUERY,
      role: 'document',
      component: QueryPanel,
    } satisfies DockPanel);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    client = new FakeClient();
    attached = [];
    completions = new FakeCompletions();
    monacoApi = new FakeMonacoApi();
    files = new FakeFileSystem();
    notes = [];
    TestBed.configureTestingModule({
      imports: [QueryPanel],
      providers: [
        DatabaseWorkspace,
        { provide: DatabaseClient, useValue: client },
        { provide: FileSystem, useValue: files },
        {
          provide: Notifications,
          useValue: { notify: (request: NotificationRequest): number => notes.push(request) },
        },
        { provide: DatabaseCompletions, useValue: completions },
        { provide: Monaco, useValue: { getMonaco: (): FakeMonacoApi => monacoApi } },
        { provide: DatabaseEnginePrompt, useValue: { installedKey: signal<string>('x') } },
        {
          provide: DatabaseQueryOpener,
          useValue: {
            attach: (id: string): (() => void) => {
              attached.push(id);
              return (): void => undefined;
            },
          },
        },
      ],
    });
    TestBed.overrideComponent(QueryPanel, { set: { template: '', imports: [] } });
    workspace = TestBed.inject(DatabaseWorkspace);
    TestBed.tick();
    await settle();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem('settings');
  });

  /**
   * Adds a PostgreSQL connection.
   * @returns Returns it.
   */
  function postgres(): DatabaseConnection {
    return workspace.addConnection('Production', 'postgres', { host: 'h' });
  }

  it('constructor_letsTheRibbonRunThisQuery', () => {
    const query: DatabaseQuery = workspace.addQuery(null, undefined);
    build(query);

    expect(attached).toEqual([query.id]);
  });

  it('language_followsTheConnectionsEngine', () => {
    const query: DatabaseQuery = workspace.addQuery(postgres().id, undefined);
    build(query);

    expect(panel().language()).toBe('pgsql');
  });

  it('canRun_withoutAConnection_isFalse', () => {
    build(workspace.addQuery(null, undefined, 'select 1'));

    expect(panel().canRun()).toBe(false);
  });

  it('execute_runsTheWholeQueryAndShowsItsResult', async () => {
    const query: DatabaseQuery = workspace.addQuery(postgres().id, 'shop', 'select * from users');
    build(query);
    expect(panel().resultsVisible()).toBe(false);

    component.execute();
    await settle();
    fixture.detectChanges();

    expect(client.executes).toHaveLength(1);
    expect(client.executes[0]).toMatchObject({
      text: 'select * from users',
      firstLine: 1,
      database: 'shop',
    });
    expect(panel().resultsVisible()).toBe(true);
    expect(panel().tab()).toBe('results');
    expect(
      panel()
        .columns()
        .map((column: TableColumn): string => column.header),
    ).toEqual(['', 'id', 'name']);
    expect(panel().gridRows()).toHaveLength(2);
    expect(JSON.parse(panel().rawJson())).toEqual([
      { id: 1, name: 'Ada' },
      { id: 2, name: null },
    ]);
  });

  it('execute_asksFirstAboutADestructiveStatement_andRunsNothingWhenRefused', async () => {
    const connection: DatabaseConnection = postgres();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'drop table a');
    build(query);
    const prompts: DatabasePrompts = TestBed.inject(DatabasePrompts);

    component.execute();
    await settle();
    expect(prompts.destructive()).toEqual(['drop table a']);
    prompts.settleDestructive(false);
    await settle();

    expect(client.executes).toHaveLength(0);
  });

  it('execute_runsADestructiveStatementOnceConfirmed', async () => {
    const connection: DatabaseConnection = postgres();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'drop table a');
    build(query);
    const prompts: DatabasePrompts = TestBed.inject(DatabasePrompts);

    component.execute();
    await settle();
    prompts.settleDestructive(true);
    await settle();

    expect(client.executes).toHaveLength(1);
  });

  it('execute_asksNothing_whenTheSettingIsOff', async () => {
    TestBed.inject(Settings).set('databaseExplorer.confirmDestructive', false);
    const connection: DatabaseConnection = postgres();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'drop table a');
    build(query);

    component.execute();
    await settle();

    expect(client.executes).toHaveLength(1);
  });

  it('execute_aFailureWithNoResult_opensOnMessages', async () => {
    client.outcome = {
      resultSets: [],
      messages: [{ severity: 'error', text: 'syntax error at "selec"', line: 1 }],
      elapsedMs: 1,
      failed: true,
      cancelled: false,
    };
    build(workspace.addQuery(postgres().id, undefined, 'selec 1'));

    component.execute();
    await settle();
    fixture.detectChanges();

    expect(panel().tab()).toBe('messages');
    expect(panel().errorCount()).toBe(1);
  });

  it('execute_whileRunning_cancelsWhenTheEngineCan', async () => {
    let release: () => void = (): void => undefined;
    client.gate = new Promise<void>((resolve: () => void): void => {
      release = resolve;
    });
    const query: DatabaseQuery = workspace.addQuery(postgres().id, undefined, 'select pg_sleep(9)');
    build(query);

    component.execute();
    await settle();
    expect(panel().running()).toBe(true);
    expect(panel().canRun()).toBe(true);

    component.execute();
    expect(client.cancels).toEqual([client.executes[0].id]);

    release();
    await settle();
    expect(panel().running()).toBe(false);
  });

  it('canRun_whileRunningOnAnEngineThatCannotCancel_isFalse', async () => {
    let release: () => void = (): void => undefined;
    client.gate = new Promise<void>((resolve: () => void): void => {
      release = resolve;
    });
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    build(workspace.addQuery(connection.id, undefined, 'select 1'));

    component.execute();
    await settle();

    expect(panel().canRun()).toBe(false);
    release();
    await settle();
  });

  it('onText_writesTheQueryAndMarksTheDocumentDirty', () => {
    const query: DatabaseQuery = workspace.addQuery(null, undefined);
    build(query);

    panel().onText('select 42');

    expect(workspace.query(query.id)?.text).toBe('select 42');
    expect(workspace.dirty()).toBe(true);
  });

  it('connectionOptions_listTheDocumentsConnections', () => {
    postgres();
    workspace.addConnection('Local', 'sqlite', {});
    build(workspace.addQuery(null, undefined));

    expect(
      panel()
        .connectionOptions()
        .map((option: DropdownOption): string => option.label),
    ).toEqual(['Production', 'Local']);
  });

  it('setConnection_pointsTheQueryElsewhereAndDropsItsDatabase', async () => {
    const query: DatabaseQuery = workspace.addQuery(postgres().id, 'shop');
    const local: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    build(query);

    panel().setConnection(local.id);
    await settle();

    expect(workspace.query(query.id)?.connectionId).toBe(local.id);
    expect(workspace.query(query.id)?.database).toBeUndefined();
    // Choosing a connection opens it, so its databases can be offered.
    expect(workspace.sessions().has(local.id)).toBe(true);
  });

  it('databaseOptions_offerTheConnectionsDatabasesForAMultiDatabaseEngine', async () => {
    const connection: DatabaseConnection = postgres();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined);
    await workspace.connect(connection.id);
    build(query);

    expect(
      panel()
        .databaseOptions()
        .map((option: DropdownOption): string => option.value),
    ).toEqual(['', 'shop', 'hr']);

    panel().setDatabase('hr');
    expect(workspace.query(query.id)?.database).toBe('hr');
    panel().setDatabase('');
    expect(workspace.query(query.id)?.database).toBeUndefined();
  });

  it('databaseOptions_forASingleDatabaseEngine_areEmpty', () => {
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    build(workspace.addQuery(connection.id, undefined));

    expect(panel().databaseOptions()).toEqual([]);
  });

  it('onRowClick_showsTheRowInProperties', async () => {
    build(workspace.addQuery(postgres().id, undefined, 'select 1'));
    component.execute();
    await settle();

    panel().onRowClick({ id: '0', data: {} });

    expect(workspace.selection()).toEqual({
      kind: 'graph',
      title: 'Row 1',
      properties: [
        { name: 'id', value: '1' },
        { name: 'name', value: 'Ada' },
      ],
    });
  });
  /**
   * Builds the panel for a query against PostgreSQL and runs it, so a result shows.
   * @returns Returns the query.
   */
  async function ranQuery(): Promise<DatabaseQuery> {
    const query: DatabaseQuery = workspace.addQuery(postgres().id, undefined, 'select 1', 'Users');
    build(query);
    component.execute();
    await settle();
    return query;
  }

  /**
   * Runs a query whose result has a short, keyed column and a long one.
   * @returns Returns the result's columns, the row number's first.
   */
  async function ranKeyedQuery(): Promise<readonly TableColumn[]> {
    client.outcome = {
      ...client.outcome,
      resultSets: [
        {
          id: 'rs',
          columns: [
            {
              name: 'id',
              type: 'int4',
              keys: [
                { kind: 'primary', name: 'lines_pkey' },
                { kind: 'foreign', name: 'lines_order_fkey' },
              ],
            },
            { name: 'description' },
          ],
          rows: [[1, 'x'.repeat(100)]],
          totalRows: 1,
          line: 1,
        },
      ],
    };
    await ranQuery();
    return panel().columns();
  }

  it('columns_markEachKey_thePrimaryBold_andNameThemInTheTooltip', async () => {
    const [, id, description] = await ranKeyedQuery();

    expect(id.headerIcons).toEqual([Icon.DATABASE_PRIMARY_KEY, Icon.DATABASE_SECONDARY_KEY]);
    expect(id.headerTooltip).toBe(
      'id — int4 · Primary key lines_pkey · Foreign key lines_order_fkey',
    );
    expect(description.headerIcons).toEqual([]);
  });

  it('columns_fitToData_sizeEachToItsLongestValueOrItsHeaderWithItsKeys', async () => {
    await ranKeyedQuery();
    panel().columnFit.set('data');

    const [, id, description] = panel().columns();
    // "id" is two characters, but its two stacked keys make its header wider than its values.
    expect(id.width).toBe('calc(6ch + 1.25rem + 1px)');
    expect(description.width).toBe('calc(100ch + 1.25rem + 1px)');
  });

  it('columns_fitToView_keepAShortColumnsNaturalWidth_andShareTheRestOut', async () => {
    await ranKeyedQuery();
    panel().gridWidth.set(600);

    const [index, id, description] = panel().columns();
    expect(index.width).toBe('3.25rem');
    // 6 characters of 0.48rem and the cell's inset, at 16px to the rem.
    expect(id.width).toBe('68px');
    // Wider than what is left, so it takes what is left.
    expect(description.width).toBeUndefined();
  });

  it('columns_fitToView_growEveryColumnInProportion_whenAllFit', async () => {
    await ranKeyedQuery();
    panel().gridWidth.set(2000);

    const [, id, description] = panel().columns();
    expect(id.width).toBe('152px');
    // The last takes the rounding, and the grid is filled edge to edge.
    expect(description.width).toBeUndefined();
  });

  it('columns_fitToView_stateNoWidths_beforeTheGridIsMeasured', async () => {
    const [, id, description] = await ranKeyedQuery();

    expect(id.width).toBeUndefined();
    expect(description.width).toBeUndefined();
  });

  it('moreItems_withoutAResult_offerTheExportsDisabled', () => {
    build(workspace.addQuery(postgres().id, undefined, 'select 1'));

    expect(
      panel()
        .moreItems()
        .map((item: MenuItem): readonly [string, boolean | undefined] => [
          item.label,
          item.disabled,
        ]),
    ).toEqual([
      ['Export to CSV', true],
      ['Export to XLSX', true],
      ['Export to JSON', true],
      ['Export to Markdown', true],
      ['Copy Selected Rows', true],
    ]);
  });

  it('moreItems_withAResult_offerTheExports_andCopyOnlyOnceARowIsSelected', async () => {
    await ranQuery();
    const enabled: () => readonly string[] = (): readonly string[] =>
      panel()
        .moreItems()
        .filter((item: MenuItem): boolean => item.disabled === false)
        .map((item: MenuItem): string => item.label);

    expect(enabled()).toEqual([
      'Export to CSV',
      'Export to XLSX',
      'Export to JSON',
      'Export to Markdown',
    ]);

    panel().onRowSelect({ row: { id: '0', data: {} }, toggle: false, range: false });

    expect(enabled()).toContain('Copy Selected Rows');
  });

  it('exportToMarkdown_writesATable', async () => {
    await ranQuery();

    panel().onMoreAction('export-markdown');
    await vi.waitFor((): void => {
      expect(notes).toHaveLength(1);
    });

    expect(files.dialogs).toEqual(['Users.md']);
    expect(files.writes[0]?.content).toBe('| id | name |\n| --- | --- |\n| 1 | Ada |\n| 2 |  |\n');
    expect(notes[0]).toMatchObject({ severity: 'info', title: 'Exported 2 rows to Markdown' });
  });

  it('rowSelect_withCmdOrCtrl_addsAndRemovesRows_andShiftExtendsARange', async () => {
    await ranQuery();
    const pick: (id: string, toggle: boolean, range: boolean) => void = (
      id: string,
      toggle: boolean,
      range: boolean,
    ): void => panel().onRowSelect({ row: { id, data: {} }, toggle, range });

    pick('0', false, false);
    pick('1', false, true);
    expect([...panel().selectedRows()].sort()).toEqual(['0', '1']);

    pick('0', true, false);
    expect([...panel().selectedRows()]).toEqual(['1']);

    pick('0', true, false);
    expect([...panel().selectedRows()].sort()).toEqual(['0', '1']);

    pick('1', false, false);
    expect([...panel().selectedRows()]).toEqual(['1']);
  });

  it('copySelectedRows_putsThemOnTheClipboardAsTabSeparatedText_inGridOrder', async () => {
    await ranQuery();
    const writeText: ReturnType<typeof vi.fn> = vi.fn((): Promise<void> => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    panel().onRowSelect({ row: { id: '1', data: {} }, toggle: false, range: false });
    panel().onRowSelect({ row: { id: '0', data: {} }, toggle: true, range: false });

    panel().onMoreAction('copy-rows');
    await vi.waitFor((): void => {
      expect(writeText).toHaveBeenCalled();
    });

    expect(writeText).toHaveBeenCalledWith('id\tname\n1\tAda\n2\t\n');
  });

  it('exportToCsv_writesEveryRowWithAByteOrderMarkAndSaysSo', async () => {
    await ranQuery();

    panel().onMoreAction('export-csv');
    await vi.waitFor((): void => {
      expect(notes).toHaveLength(1);
    });

    expect(files.dialogs).toEqual(['Users.csv']);
    expect(files.writes).toEqual([
      { path: '/exports/out', content: 'id,name\r\n1,Ada\r\n2,\r\n', hasBom: true },
    ]);
    expect(notes[0]).toMatchObject({
      severity: 'info',
      title: 'Exported 2 rows to CSV',
      detail: '/exports/out',
    });
  });

  it('exportToXlsx_writesAWorkbooksBytes', async () => {
    // jsdom's Blob cannot stream, as the renderer's can; stand in one that does.
    vi.stubGlobal(
      'Blob',
      class {
        public constructor(private readonly parts: readonly Uint8Array[]) {}

        /**
         * Streams the parts.
         * @returns Returns the stream.
         */
        public stream(): ReadableStream<Uint8Array> {
          const parts: readonly Uint8Array[] = this.parts;
          return new ReadableStream<Uint8Array>({
            start(controller: ReadableStreamDefaultController<Uint8Array>): void {
              parts.forEach((part: Uint8Array): void => controller.enqueue(part));
              controller.close();
            },
          });
        }
      },
    );
    await ranQuery();

    panel().onMoreAction('export-xlsx');
    await vi.waitFor((): void => {
      expect(notes).toHaveLength(1);
    });

    expect(files.dialogs).toEqual(['Users.xlsx']);
    expect(files.writes).toEqual([]);
    expect(files.byteWrites).toHaveLength(1);
    // A zip archive's local file header.
    expect([...files.byteWrites[0].bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(notes[0]).toMatchObject({ severity: 'info', title: 'Exported 2 rows to XLSX' });
  });

  it('export_whenTheSaveDialogIsCancelled_writesNothing', async () => {
    await ranQuery();
    files.chosen = null;

    panel().onMoreAction('export-csv');
    await settle();

    expect(files.dialogs).toHaveLength(1);
    expect(files.writes).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('export_whenTheWriteFails_saysWhy', async () => {
    await ranQuery();
    files.result = { success: false, error: 'Disk full' };

    panel().onMoreAction('export-csv');
    await vi.waitFor((): void => {
      expect(notes).toHaveLength(1);
    });

    expect(notes[0]).toMatchObject({
      severity: 'error',
      title: 'The export to CSV failed',
      detail: 'Disk full',
    });
  });

  it('export_whenTheRestOfTheRowsAreGone_warnsItHasOnlyThoseLoaded', async () => {
    client.outcome = {
      ...client.outcome,
      resultSets: [{ ...client.outcome.resultSets[0], totalRows: 5 }],
    };
    await ranQuery();

    panel().onMoreAction('export-csv');
    await vi.waitFor((): void => {
      expect(notes).toHaveLength(1);
    });

    expect(notes[0].severity).toBe('warning');
    expect(notes[0].detail).toContain('only the rows already loaded');
  });

  it('onMoreAction_anUnknownItem_doesNothing', async () => {
    await ranQuery();

    panel().onMoreAction('something-else');
    await settle();

    expect(files.dialogs).toEqual([]);
  });

  /**
   * Stands in for the editor the template would render, over a model of the given line, and tells the
   * panel it is ready.
   * @param text The editor's line.
   * @returns Returns the editor's model.
   */
  function ready(text: string): MonacoApi.editor.ITextModel {
    const model: MonacoApi.editor.ITextModel = lineModel(text);
    const editor: object = { onKeyDown: (): void => undefined, getModel: () => model };
    (component as unknown as { editor: () => object }).editor = (): object => ({
      getEditor: () => editor,
      getModel: () => model,
    });
    (component as unknown as { onEditorReady(): void }).onEditorReady();
    return model;
  }

  /**
   * Asks a registered provider for completions at a column of a model.
   * @param registered The provider.
   * @param model The model.
   * @param column The caret's column.
   * @returns Returns the provider's answer.
   */
  async function provide(
    registered: Registered,
    model: MonacoApi.editor.ITextModel,
    column: number,
  ): Promise<MonacoApi.languages.CompletionList | null | undefined> {
    return registered.provider.provideCompletionItems(
      model,
      { lineNumber: 1, column } as MonacoApi.Position,
      {} as MonacoApi.languages.CompletionContext,
      {} as MonacoApi.CancellationToken,
    );
  }

  it('onEditorReady_registersAStudioCompletionProviderPerQueryLanguage_disposedWithThePanel', () => {
    build(workspace.addQuery(postgres().id, undefined, 'select '));
    ready('select ');
    // Ready again (the editor rebuilt): nothing more is registered.
    (component as unknown as { onEditorReady(): void }).onEditorReady();

    expect(monacoApi.registered.map((entry: Registered): string => entry.language)).toEqual([
      'sql',
      'pgsql',
      'cypher',
    ]);
    for (const entry of monacoApi.registered) {
      expect(isStudioProvider(entry.provider)).toBe(true);
      expect(entry.provider.triggerCharacters).toEqual(['.', ':']);
    }
    expect(monacoApi.registered.some((entry: Registered): boolean => entry.disposed)).toBe(false);

    fixture.destroy();

    expect(monacoApi.registered.every((entry: Registered): boolean => entry.disposed)).toBe(true);
  });

  it('completionProvider_answersForThisPanelsModel_inTheEnginesOrder', async () => {
    const query: DatabaseQuery = workspace.addQuery(postgres().id, undefined, 'select o.pl');
    build(query);
    const model: MonacoApi.editor.ITextModel = ready('select o.pl');
    completions.items = [
      { label: 'placed', kind: 'column', detail: 'date', insertText: 'placed' },
      { label: 'Plan', kind: 'table', insertText: '"Plan"' },
    ];

    const list: MonacoApi.languages.CompletionList | null | undefined = await provide(
      monacoApi.registered[1],
      model,
      12,
    );

    expect(completions.asked).toEqual([{ queryId: query.id, text: 'select o.pl', offset: 11 }]);
    const range: MonacoApi.IRange = {
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 10,
      endColumn: 12,
    };
    expect(list?.suggestions).toEqual([
      {
        label: { label: 'placed', description: 'date' },
        kind: 3,
        insertText: 'placed',
        filterText: 'placed',
        sortText: '000000',
        range,
      },
      {
        label: { label: 'Plan' },
        kind: 6,
        insertText: '"Plan"',
        filterText: 'Plan',
        sortText: '000001',
        range,
      },
    ]);
  });

  it('completionProvider_answersNothing_forAnotherPanelsModel_orWhenThereIsNothingToOffer', async () => {
    build(workspace.addQuery(postgres().id, undefined, 'select '));
    const model: MonacoApi.editor.ITextModel = ready('select ');
    completions.items = [{ label: 'orders', kind: 'table', insertText: 'orders' }];

    expect(await provide(monacoApi.registered[0], lineModel('select '), 8)).toBeUndefined();
    expect(completions.asked).toEqual([]);

    completions.items = [];
    expect(await provide(monacoApi.registered[0], model, 8)).toBeUndefined();
    expect(completions.asked).toHaveLength(1);
  });

  describe('with its editor', () => {
    /**
     * What a stand-in editor recorded.
     */
    interface Stand {
      readonly revealed: number[];
      readonly focuses: () => number;
      readonly pressKey: (event: KeyboardEvent) => void;
    }

    /**
     * Stands in the editor the template would render.
     * @param text The editor's text.
     * @param place Where the selection and caret are.
     * @returns Returns what it recorded.
     */
    function mount(
      text: string,
      place: { selection?: object | null; position?: object | null } = {},
    ): Stand {
      const revealed: number[] = [];
      let focused: number = 0;
      let onKey: (event: { browserEvent: KeyboardEvent }) => void = (): void => undefined;
      const model: object = {
        getValue: (): string => text,
        getValueInRange: (): string => 'select 2',
        getOffsetAt: (position: { column: number }): number => position.column - 1,
        getLineCount: (): number => 3,
        getLineFirstNonWhitespaceColumn: (): number => 0,
        getLineMaxColumn: (): number => 9,
      };
      const editor: object = {
        getModel: (): object => model,
        getSelection: (): object | null => place.selection ?? null,
        getPosition: (): object | null => place.position ?? null,
        onKeyDown: (listener: (event: { browserEvent: KeyboardEvent }) => void): void => {
          onKey = listener;
        },
      };
      (component as unknown as { editor: () => object }).editor = (): object => ({
        getEditor: (): object => editor,
        getModel: (): object => model,
        reveal: (line: number): void => void revealed.push(line),
        focus: (): void => void (focused += 1),
      });
      panel().onEditorReady();
      return {
        revealed,
        focuses: (): number => focused,
        pressKey: (event: KeyboardEvent): void =>
          onKey({
            browserEvent: event,
            preventDefault: (): void => event.preventDefault(),
            stopPropagation: (): void => undefined,
          } as { browserEvent: KeyboardEvent }),
      };
    }

    it('execute_withASelection_runsOnlyThat_fromItsLine', async () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1\nselect 2'));
      mount('select 1\nselect 2', {
        selection: { isEmpty: (): boolean => false, startLineNumber: 2 },
      });

      component.execute();
      await settle();

      expect(client.executes[0]).toMatchObject({ text: 'select 2', firstLine: 2 });
    });

    it('execute_withACaretOnly_runsTheWholeQuery', async () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));
      mount('select 1', { selection: { isEmpty: (): boolean => true, startLineNumber: 1 } });

      component.execute();
      await settle();

      expect(client.executes[0]).toMatchObject({ text: 'select 1', firstLine: 1 });
    });

    it('executeStatement_runsTheStatementUnderTheCaret', async () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1; select 2'));
      mount('select 1; select 2', { position: { lineNumber: 1, column: 15 } });

      component.executeStatement();
      await settle();

      expect(client.executes).toHaveLength(1);
      expect(client.executes[0]?.text).toBe('select 2');
    });

    it('executeStatement_withNothingUnderTheCaret_runsNothing', async () => {
      build(workspace.addQuery(postgres().id, undefined, '   '));
      mount('   ', { position: { lineNumber: 1, column: 2 } });

      component.executeStatement();
      await settle();

      expect(client.executes).toEqual([]);
    });

    it('executeStatement_withoutAnEditor_runsNothing', async () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));

      component.executeStatement();
      await settle();

      expect(client.executes).toEqual([]);
    });

    it('executeStatement_whileRunning_doesNotRunASecond', async () => {
      let release: () => void = (): void => undefined;
      client.gate = new Promise<void>((resolve: () => void): void => {
        release = resolve;
      });
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));
      mount('select 1', { position: { lineNumber: 1, column: 2 } });
      component.execute();
      await settle();

      component.executeStatement();
      release();
      await settle();

      expect(client.executes).toHaveLength(1);
    });

    it('keys_runTheQueryOrTheStatement_aheadOfTheEditor', async () => {
      const chord: { held: string } = { held: 'database.execute' };
      vi.spyOn(TestBed.inject(Keybindings), 'matches').mockImplementation(
        (_event: KeyboardEvent, command: string): boolean => command === chord.held,
      );
      build(workspace.addQuery(postgres().id, undefined, 'select 1; select 2'));
      const stand: Stand = mount('select 1; select 2', { position: { lineNumber: 1, column: 15 } });

      const whole: KeyboardEvent = new KeyboardEvent('keydown', { cancelable: true });
      stand.pressKey(whole);
      await settle();
      chord.held = 'database.executeStatement';
      stand.pressKey(new KeyboardEvent('keydown', { cancelable: true }));
      await settle();
      chord.held = 'something.else';
      const other: KeyboardEvent = new KeyboardEvent('keydown', { cancelable: true });
      stand.pressKey(other);
      await settle();

      expect(whole.defaultPrevented).toBe(true);
      expect(other.defaultPrevented).toBe(false);
      expect(client.executes.map((request: ExecuteRequest): string => request.text)).toEqual([
        'select 1; select 2',
        'select 2',
      ]);
    });

    it('onEditorReady_twice_registersOnce', () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));
      mount('select 1');
      const registered: number = monacoApi.registered.length;

      panel().onEditorReady();

      expect(monacoApi.registered).toHaveLength(registered);
    });

    it('reveal_goesToTheMessagesLine', () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));
      const stand: Stand = mount('select 1');

      panel().reveal({ severity: 'error', text: 'bad', line: 2 });

      expect(stand.revealed).toEqual([2]);
      expect(stand.focuses()).toBe(1);
    });

    it('reveal_ofAMessageWithNoLine_staysPut', () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));
      const stand: Stand = mount('select 1');

      panel().reveal({ severity: 'info', text: 'done' });

      expect(stand.revealed).toEqual([]);
    });

    it('errors_markTheirLines_keepingAnEngineLineInsideTheDocument', async () => {
      client.outcome = {
        ...client.outcome,
        resultSets: [],
        failed: true,
        messages: [
          { severity: 'error', text: 'too far', line: 40 },
          { severity: 'error', text: 'before the start', line: 0 },
          { severity: 'error', text: 'nowhere' },
          { severity: 'warning', text: 'mild', line: 2 },
        ],
      };
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));
      mount('select 1');
      fixture.detectChanges();

      component.execute();
      await settle();
      TestBed.tick();

      expect(
        monacoApi.markers
          .at(-1)
          ?.map((marker: MonacoApi.editor.IMarkerData): string =>
            [marker.message, marker.startLineNumber, marker.startColumn].join(':'),
          ),
      ).toEqual(['too far:3:1', 'before the start:1:1']);
    });
  });

  describe('its status', () => {
    /**
     * Brings the query to the front of its well and runs it.
     * @returns Returns a promise that resolves once it has run.
     */
    async function ranInFront(): Promise<void> {
      const query: DatabaseQuery = workspace.addQuery(postgres().id, undefined, 'select 1');
      vi.spyOn(TestBed.inject(DockState), 'layout').mockReturnValue({
        kind: 'stack',
        id: 'well',
        panels: [query.id],
        active: query.id,
      } as unknown as DockNode);
      build(query);
      component.execute();
      await settle();
      TestBed.tick();
    }

    /**
     * Reads what the status strip was told.
     * @returns Returns the info.
     */
    function status(): DocumentStatusInfo | null {
      TestBed.tick();
      return TestBed.inject(DocumentStatus).info();
    }

    /**
     * Reads the status strip's details.
     * @returns Returns their text.
     */
    function details(): readonly string[] {
      return (status()?.details ?? []).map((detail: { text: string }): string => detail.text);
    }

    it('saysItCompleted_withItsRowsColumnsAndTime', async () => {
      await ranInFront();

      expect(status()?.chip?.text).toBe('Completed');
      expect(details()).toEqual(['2 rows', '2 columns', '3 ms']);
    });

    it('saysWhenItFailed', async () => {
      client.outcome = { ...client.outcome, failed: true, resultSets: [] };

      await ranInFront();

      expect(status()?.chip?.text).toBe('Failed');
      expect(details()).toEqual(['3 ms']);
    });

    it('saysWhenItWasCancelled', async () => {
      client.outcome = { ...client.outcome, cancelled: true };

      await ranInFront();

      expect(status()?.chip?.text).toBe('Cancelled');
    });

    it('saysItIsRunning_andHoldsItsDetails', async () => {
      client.gate = new Promise<void>((): void => undefined);

      await ranInFront();

      expect(status()?.chip?.text).toBe('Running');
      expect(details()).toEqual([]);
    });

    it('countsLoadedRowsAgainstTheTotal_andSaysWhichSetShows', async () => {
      const first: ResultSet = {
        id: 'a',
        columns: [{ name: 'one' }],
        rows: [[1]],
        totalRows: 1200,
        line: 1,
      };
      client.outcome = {
        ...client.outcome,
        resultSets: [first, { ...first, id: 'b', totalRows: 1 }],
      };

      await ranInFront();

      expect(details().slice(0, 3)).toEqual([
        'Result 1 of 2',
        `1 of ${(1200).toLocaleString()} rows`,
        '1 column',
      ]);

      panel().chooseResult(1);

      expect(details().slice(0, 2)).toEqual(['Result 2 of 2', '1 row']);
    });

    it('showsTimesInSeconds_fromASecondUp', async () => {
      client.outcome = { ...client.outcome, elapsedMs: 1500 };

      await ranInFront();

      expect(details().at(-1)).toBe('1.50 s');
    });

    it('neverShowsZeroMilliseconds', async () => {
      client.outcome = { ...client.outcome, elapsedMs: 0.1 };

      await ranInFront();

      expect(details().at(-1)).toBe('1 ms');
    });

    it('carriesTheCaret', async () => {
      await ranInFront();

      panel().onCursor({ line: 4, column: 9 });

      expect(status()).toMatchObject({ line: 4, column: 9 });
    });

    it('goesAway_whenThePanelCloses', async () => {
      await ranInFront();
      expect(status()).not.toBeNull();

      fixture.destroy();

      expect(status()).toBeNull();
    });
  });

  describe('its results', () => {
    const NODE: DatabaseValue = { type: 'node', id: '1', labels: ['Person'], properties: {} };

    it('tabs_countResultSetsAndErrors', async () => {
      client.outcome = {
        ...client.outcome,
        messages: [
          { severity: 'error', text: 'one' },
          { severity: 'info', text: 'two' },
        ],
      };

      await ranQuery();

      expect(panel().resultTabs()).toMatchObject([
        { value: 'results', badge: 1 },
        { value: 'messages', badge: 1 },
      ]);
    });

    it('tabs_withNothingToCount_carryNoBadge', async () => {
      await ranQuery();
      client.outcome = { ...client.outcome, resultSets: [], messages: [] };
      component.execute();
      await settle();

      expect(
        panel()
          .resultTabs()
          .map((tab: { badge?: number }): number | undefined => tab.badge),
      ).toEqual([undefined, undefined]);
    });

    it('aGraphResult_opensAsAGraph_untilAnotherViewIsChosen', async () => {
      client.outcome = {
        ...client.outcome,
        resultSets: [{ id: 'g', columns: [{ name: 'n' }], rows: [[NODE]], totalRows: 1, line: 1 }],
      };

      await ranQuery();
      expect(panel().resultView()).toBe('graph');

      panel().chooseView('table');

      expect(panel().resultView()).toBe('table');
    });

    it('aChosenGraph_ofAResultWithNoGraphInIt_fallsBackToTheTable', async () => {
      await ranQuery();

      panel().chooseView('graph');

      expect(panel().resultView()).toBe('table');
    });

    it('chooseResult_dropsTheSelectedRow', async () => {
      await ranQuery();
      panel().onRowClick({ id: '0', data: {} });
      expect(panel().selectedRows().size).toBe(1);

      panel().chooseResult(0);

      expect(panel().selectedRows().size).toBe(0);
    });

    it('anewRun_dropsTheSelectedRow', async () => {
      await ranQuery();
      panel().onRowClick({ id: '0', data: {} });

      component.execute();
      await settle();
      TestBed.tick();

      expect(panel().selectedRows().size).toBe(0);
    });

    it('onRowClick_ofARowThatIsNoLongerThere_showsNothing', async () => {
      await ranQuery();

      panel().onRowClick({ id: '99', data: {} });

      expect(workspace.selection()).toBeNull();
    });

    it('onGraphPick_showsThePickInProperties', async () => {
      await ranQuery();

      panel().onGraphPick({ title: 'Ada', properties: [] });

      expect(workspace.selection()).toEqual({ kind: 'graph', title: 'Ada', properties: [] });
    });

    it('loadMore_appendsTheNextPage', async () => {
      client.outcome = {
        ...client.outcome,
        resultSets: [{ id: 'rs', columns: [{ name: 'n' }], rows: [[1]], totalRows: 2, line: 1 }],
      };
      vi.spyOn(client, 'fetch').mockResolvedValue([[2]]);
      await ranQuery();

      panel().loadMore();
      await settle();

      expect(panel().gridRows()).toHaveLength(2);
    });

    it('loadMore_withNoResult_asksForNothing', () => {
      const fetching: MockInstance = vi.spyOn(client, 'fetch');
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));

      panel().loadMore();

      expect(fetching).not.toHaveBeenCalled();
    });

    it('labels_nameTheRowCount', async () => {
      await ranQuery();
      const set: ResultSet = { id: 'a', columns: [], rows: [], totalRows: 1, line: 1 };

      expect(panel().resultLabel(set, 0)).toBe('Result 1 · 1 row');
      expect(panel().resultLabel({ ...set, totalRows: 2 }, 1)).toBe('Result 2 · 2 rows');
    });

    it('icons_followTheSeverity', () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));

      expect(panel().messageIcon({ severity: 'error', text: '' })).toBe(Icon.ERROR);
      expect(panel().messageIcon({ severity: 'warning', text: '' })).toBe(Icon.WARNING);
      expect(panel().messageIcon({ severity: 'info', text: '' })).toBe(Icon.INFO);
    });
  });

  describe('its pickers', () => {
    it('databaseOptions_keepADatabaseTheServerNoLongerLists', () => {
      build(workspace.addQuery(postgres().id, 'archived', 'select 1'));

      expect(
        panel()
          .databaseOptions()
          .map((option: DropdownOption): string => option.value),
      ).toContain('archived');
    });

    it('setDatabase_toTheDefault_dropsIt', () => {
      const query: DatabaseQuery = workspace.addQuery(postgres().id, 'shop', 'select 1');
      build(query);

      panel().setDatabase('');

      expect(panel().query()?.database).toBeUndefined();
    });

    it('setConnection_toNone_clearsItAndConnectsNothing', () => {
      const connecting: MockInstance = vi.spyOn(client, 'connect');
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));

      panel().setConnection('');

      expect(panel().query()?.connectionId).toBeNull();
      expect(connecting).not.toHaveBeenCalled();
    });

    it('executeTooltip_saysWhatItRuns', () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));

      expect(panel().executeTooltip()).toContain('Run the selection, or the whole query');
    });

    it('resultsDefaultSize_beforeThePanelIsMeasured_isUnset', () => {
      build(workspace.addQuery(postgres().id, undefined, 'select 1'));

      expect(panel().resultsDefaultSize()).toBeNull();
    });
  });
});
