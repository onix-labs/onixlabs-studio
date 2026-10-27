import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MonacoApi from 'monaco-editor';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
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
  public readonly editor: { setModelMarkers: () => void } = {
    setModelMarkers: (): void => undefined,
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
    ]);
  });

  it('moreItems_withAResult_offerTheExports', async () => {
    await ranQuery();

    expect(
      panel()
        .moreItems()
        .every((item: MenuItem): boolean => item.disabled === false),
    ).toBe(true);
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
    const editor: object = { addCommand: (): void => undefined, getModel: () => model };
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
});
