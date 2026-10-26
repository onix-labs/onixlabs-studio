import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import {
  ConnectionValues,
  ConnectOutcome,
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseValue,
  ExecuteOutcome,
  ExecuteRequest,
  ExpandOutcome,
  FetchRequest,
  NodeActionOutcome,
} from '@shared/api/database-engine-protocol';
import {
  DATABASE_DOCUMENT_KIND,
  DATABASE_DOCUMENT_VERSION,
  DatabaseConnection,
  DatabaseDocument,
  DatabaseQuery,
  parseDatabaseDocument,
} from '@shared/api/database-document';
import { FileWriteResult } from '@shared/api/file-channels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { DatabaseEnginePrompt } from '@shared/angular/services/plugins/database-engine-prompt';
import { Settings } from '@shared/angular/services/settings/settings';
import { DatabaseSelectAction } from '@shared/angular/services/settings/settings-registry';
import { DatabaseClient } from '../database-client/database-client';
import { DatabaseWorkspace, NodeChildren, nodeKey } from './database-workspace';

/**
 * An engine with a secret password field, as a server engine has.
 */
const POSTGRES: DatabaseEngineInfo = {
  id: 'postgres',
  displayName: 'PostgreSQL',
  language: 'pgsql',
  queryExtension: 'sql',
  capabilities: ['cancel', 'multipleDatabases', 'script'],
  connectionFields: [
    { id: 'host', label: 'Host', kind: 'text' },
    { id: 'user', label: 'User', kind: 'text' },
    { id: 'password', label: 'Password', kind: 'password', secret: true },
  ],
};

/**
 * An engine with no secret field at all, as a file engine has.
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
 * The values a PostgreSQL connection is added with, its password included.
 */
const PG_VALUES: ConnectionValues = { host: 'db.test', user: 'admin', password: 'hunter2' };

/**
 * A stand-in for the engine client, recording what the workspace asked of main.
 */
class FakeClient {
  /**
   * Holds what the next engines call resolves with.
   */
  public available: readonly DatabaseEngineInfo[] = [POSTGRES, SQLITE];

  /**
   * Holds how many times the engines were asked for.
   */
  public enginesCalls: number = 0;

  /**
   * Holds every connect call's engine and values.
   */
  public readonly connects: { engine: string; values: ConnectionValues }[] = [];

  /**
   * Holds what the next connect resolves with.
   */
  public connectOutcome: ConnectOutcome = {
    kind: 'connected',
    session: 'session-1',
    serverVersion: 'PostgreSQL 17',
  };

  /**
   * Holds the sessions asked to disconnect.
   */
  public readonly disconnects: string[] = [];

  /**
   * Holds every expand call.
   */
  public readonly expands: { session: string; path: string | null }[] = [];

  /**
   * Holds what expand resolves with.
   */
  public expandOutcome: ExpandOutcome = { kind: 'nodes', nodes: [] };

  /**
   * Holds every execute request.
   */
  public readonly executes: ExecuteRequest[] = [];

  /**
   * Holds how an execute resolves, or null to resolve it with a default outcome at once.
   */
  public executeGate: Promise<void> | null = null;

  /**
   * Holds the execution ids asked to cancel.
   */
  public readonly cancels: string[] = [];

  /**
   * Holds every fetch request.
   */
  public readonly fetches: FetchRequest[] = [];

  /**
   * Holds every action call.
   */
  public readonly actions: { session: string; path: string; action: string }[] = [];

  /**
   * Holds what an action resolves with.
   */
  public actionOutcome: NodeActionOutcome = { kind: 'failure', message: 'nope' };

  /**
   * Resolves the configured engines.
   * @returns Returns the engines.
   */
  public engines(): Promise<readonly DatabaseEngineInfo[]> {
    this.enginesCalls += 1;
    return Promise.resolve(this.available);
  }

  /**
   * Records a connect.
   * @param engine The engine.
   * @param values The values.
   * @returns Returns the configured outcome.
   */
  public connect(engine: string, values: ConnectionValues): Promise<ConnectOutcome> {
    this.connects.push({ engine, values });
    return Promise.resolve(this.connectOutcome);
  }

  /**
   * Resolves a test as a success.
   * @returns Returns the outcome.
   */
  public test(): Promise<ConnectOutcome> {
    return Promise.resolve({ kind: 'connected', session: 'test', serverVersion: 'x' });
  }

  /**
   * Records a disconnect.
   * @param session The session.
   * @returns Returns once recorded.
   */
  public disconnect(session: string): Promise<void> {
    this.disconnects.push(session);
    return Promise.resolve();
  }

  /**
   * Records an expand.
   * @param session The session.
   * @param path The path.
   * @returns Returns the configured outcome.
   */
  public expand(session: string, path: string | null): Promise<ExpandOutcome> {
    this.expands.push({ session, path });
    return Promise.resolve(this.expandOutcome);
  }

  /**
   * Records an execute.
   * @param request The request.
   * @returns Returns an outcome with one result set.
   */
  public async execute(request: ExecuteRequest): Promise<ExecuteOutcome> {
    this.executes.push(request);
    if (this.executeGate !== null) {
      await this.executeGate;
    }
    return {
      id: request.id,
      resultSets: [{ id: 'rs-1', columns: [{ name: 'n' }], rows: [[1]], totalRows: 3, line: 1 }],
      messages: [],
      elapsedMs: 5,
      failed: false,
      cancelled: false,
    };
  }

  /**
   * Records a cancel.
   * @param id The execution id.
   */
  public cancel(id: string): void {
    this.cancels.push(id);
  }

  /**
   * Records a fetch.
   * @param request The request.
   * @returns Returns two more rows.
   */
  public fetch(request: FetchRequest): Promise<readonly (readonly DatabaseValue[])[]> {
    this.fetches.push(request);
    return Promise.resolve([[2], [3]]);
  }

  /**
   * Records an action.
   * @param session The session.
   * @param path The path.
   * @param action The action.
   * @returns Returns the configured outcome.
   */
  public action(session: string, path: string, action: string): Promise<NodeActionOutcome> {
    this.actions.push({ session, path, action });
    return Promise.resolve(this.actionOutcome);
  }
}

/**
 * Lets queued promise callbacks run.
 * @returns Returns a promise resolving after the microtask queue drains.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('DatabaseWorkspace', () => {
  let workspace: DatabaseWorkspace;
  let client: FakeClient;
  let installedKey: WritableSignal<string>;
  let selectAction: WritableSignal<DatabaseSelectAction>;
  let written: { path: string; content: string }[];
  let chosenPath: string | null;
  let writeSucceeds: boolean;

  beforeEach(async () => {
    client = new FakeClient();
    installedKey = signal<string>('postgres\nsqlite');
    selectAction = signal<DatabaseSelectAction>('open');
    written = [];
    chosenPath = null;
    writeSucceeds = true;
    const fileSystem: Partial<FileSystem> = {
      write: (path: string, content: string): Promise<FileWriteResult> => {
        if (writeSucceeds) {
          written.push({ path, content });
        }
        return Promise.resolve(
          writeSucceeds ? { success: true } : { success: false, message: 'denied' },
        );
      },
      saveDialog: (): Promise<string | null> => Promise.resolve(chosenPath),
    };
    TestBed.configureTestingModule({
      providers: [
        DatabaseWorkspace,
        { provide: DatabaseClient, useValue: client },
        { provide: FileSystem, useValue: fileSystem },
        { provide: Settings, useValue: { databaseSelectAction: selectAction } },
        { provide: DatabaseEnginePrompt, useValue: { installedKey } },
      ],
    });
    workspace = TestBed.inject(DatabaseWorkspace);
    TestBed.tick();
    await settle();
  });

  /**
   * Adds a PostgreSQL connection with a password.
   * @returns Returns the connection.
   */
  function addPostgres(): DatabaseConnection {
    return workspace.addConnection('Production', 'postgres', PG_VALUES);
  }

  // --- Engines ---

  it('constructor_asksMainForTheEnginesAndMarksThemKnown', () => {
    expect(client.enginesCalls).toBe(1);
    expect(workspace.enginesKnown()).toBe(true);
    expect(workspace.engines().map((engine: DatabaseEngineInfo): string => engine.id)).toEqual([
      'postgres',
      'sqlite',
    ]);
  });

  it('enginesKnown_beforeMainAnswers_isFalse', () => {
    // "No engine is installed" must not be said while the question is still being asked.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DatabaseWorkspace,
        { provide: DatabaseClient, useValue: new FakeClient() },
        { provide: FileSystem, useValue: {} },
        { provide: Settings, useValue: { databaseSelectAction: selectAction } },
        { provide: DatabaseEnginePrompt, useValue: { installedKey } },
      ],
    });
    const fresh: DatabaseWorkspace = TestBed.inject(DatabaseWorkspace);

    expect(fresh.enginesKnown()).toBe(false);
    expect(fresh.engines()).toEqual([]);
  });

  it('engines_whenTheInstalledEnginesChange_areFetchedAgain', async () => {
    // Installing an engine from the empty state is all it takes: the tab does not need reopening.
    client.available = [POSTGRES, SQLITE, { ...SQLITE, id: 'neo4j', displayName: 'Neo4j' }];
    installedKey.set('neo4j\npostgres\nsqlite');
    TestBed.tick();
    await settle();

    expect(client.enginesCalls).toBe(2);
    expect(workspace.engine('neo4j')?.displayName).toBe('Neo4j');
  });

  it('engines_whenTheKeyIsUnchanged_areNotFetchedAgain', async () => {
    TestBed.tick();
    await settle();

    expect(client.enginesCalls).toBe(1);
  });

  // --- The document ---

  it('constructor_startsAnUntitledCleanDocument', () => {
    expect(workspace.filePath()).toBeNull();
    expect(workspace.documentName()).toBe('Untitled');
    expect(workspace.dirty()).toBe(false);
    expect(workspace.connections()).toEqual([]);
    expect(workspace.queries()).toEqual([]);
  });

  it('load_bindsTheFileAndIsClean', () => {
    const document: DatabaseDocument = {
      kind: DATABASE_DOCUMENT_KIND,
      version: DATABASE_DOCUMENT_VERSION,
      connections: [{ id: 'c1', name: 'Local', engine: 'sqlite', values: { file: '/a.db' } }],
      queries: [{ id: 'q1', title: 'Query 1', connectionId: 'c1', text: 'select 1' }],
    };
    workspace.addConnection('Discarded', 'sqlite', {});

    workspace.load(document, '/docs/shop.database.json');

    expect(workspace.connections()).toEqual(document.connections);
    expect(workspace.queries()).toEqual(document.queries);
    expect(workspace.documentName()).toBe('shop.database.json');
    expect(workspace.dirty()).toBe(false);
  });

  it('save_writesADocumentTheParserReadsBack', async () => {
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {
      file: '/a.db',
    });
    workspace.addQuery(connection.id, undefined, 'select 1');
    chosenPath = '/docs/shop.database.json';

    expect(await workspace.save()).toBe(true);

    expect(written).toHaveLength(1);
    expect(written[0].path).toBe('/docs/shop.database.json');
    const parsed: DatabaseDocument | null = parseDatabaseDocument(written[0].content);
    expect(parsed).toEqual(workspace.toDocument());
    expect(workspace.dirty()).toBe(false);
    expect(workspace.filePath()).toBe('/docs/shop.database.json');
  });

  it('save_whenBound_writesWithoutAsking', async () => {
    workspace.load(
      { kind: DATABASE_DOCUMENT_KIND, version: 1, connections: [], queries: [] },
      '/docs/bound.database.json',
    );
    workspace.addQuery(null, undefined);
    chosenPath = '/elsewhere.database.json';

    await workspace.save();

    expect(written.map((entry: { path: string }): string => entry.path)).toEqual([
      '/docs/bound.database.json',
    ]);
  });

  it('saveAs_whenTheDialogIsCancelled_writesNothing', async () => {
    workspace.addQuery(null, undefined);
    chosenPath = null;

    expect(await workspace.saveAs()).toBe(false);
    expect(written).toEqual([]);
    expect(workspace.dirty()).toBe(true);
  });

  it('saveAs_addsTheDatabaseSuffix', async () => {
    chosenPath = '/docs/shop.json';
    await workspace.saveAs();
    chosenPath = '/docs/other';
    await workspace.saveAs();
    chosenPath = '/docs/KEEP.DATABASE.JSON';
    await workspace.saveAs();

    expect(written.map((entry: { path: string }): string => entry.path)).toEqual([
      '/docs/shop.database.json',
      '/docs/other.database.json',
      '/docs/KEEP.DATABASE.JSON',
    ]);
  });

  it('save_whenTheWriteFails_staysDirtyAndUnbound', async () => {
    workspace.addQuery(null, undefined);
    chosenPath = '/docs/shop.database.json';
    writeSucceeds = false;

    expect(await workspace.save()).toBe(false);
    expect(workspace.dirty()).toBe(true);
    expect(workspace.filePath()).toBeNull();
  });

  // --- Secrets ---

  it('addConnection_neverPutsASecretInTheDocument', async () => {
    addPostgres();
    chosenPath = '/docs/prod.database.json';
    await workspace.save();

    expect(workspace.connections()[0].values).toEqual({ host: 'db.test', user: 'admin' });
    expect(JSON.stringify(workspace.toDocument())).not.toContain('hunter2');
    expect(written[0].content).not.toContain('hunter2');
    expect(written[0].content).not.toContain('"password"');
  });

  it('valuesFor_givesTheDialogTheSecretsForThisSession', () => {
    const connection: DatabaseConnection = addPostgres();

    expect(workspace.valuesFor(connection.id)).toEqual(PG_VALUES);
  });

  it('updateConnection_keepsTheNewSecretOutOfTheDocument', async () => {
    const connection: DatabaseConnection = addPostgres();

    await workspace.updateConnection(connection.id, 'Renamed', {
      ...PG_VALUES,
      password: 'swordfish',
    });

    expect(workspace.connection(connection.id)?.name).toBe('Renamed');
    expect(JSON.stringify(workspace.toDocument())).not.toContain('swordfish');
    expect(workspace.valuesFor(connection.id)['password']).toBe('swordfish');
  });

  it('needsSecrets_afterLoad_asksForThePassword', () => {
    // A loaded document never carries the password, so the session has to be told it.
    workspace.load(
      {
        kind: DATABASE_DOCUMENT_KIND,
        version: 1,
        connections: [{ id: 'c1', name: 'Prod', engine: 'postgres', values: { host: 'h' } }],
        queries: [],
      },
      '/docs/prod.database.json',
    );

    expect(workspace.needsSecrets('c1')).toBe(true);
    workspace.provideSecrets('c1', { host: 'ignored', password: 'pw' });
    expect(workspace.needsSecrets('c1')).toBe(false);
    expect(workspace.valuesFor('c1')).toEqual({ host: 'h', password: 'pw' });
    expect(JSON.stringify(workspace.toDocument())).not.toContain('pw"');
  });

  it('needsSecrets_forAnEngineWithoutSecrets_isFalse', () => {
    const connection: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {
      file: '/a.db',
    });

    expect(workspace.needsSecrets(connection.id)).toBe(false);
  });

  // --- Connections and queries ---

  it('addConnection_marksTheDocumentDirty', () => {
    addPostgres();

    expect(workspace.dirty()).toBe(true);
    expect(workspace.connections()).toHaveLength(1);
  });

  it('removeConnection_takesItsQueriesWithIt', async () => {
    const first: DatabaseConnection = addPostgres();
    const second: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    workspace.addQuery(first.id, undefined, 'select 1');
    workspace.addQuery(first.id, undefined, 'select 2');
    const kept: DatabaseQuery = workspace.addQuery(second.id, undefined, 'select 3');
    const loose: DatabaseQuery = workspace.addQuery(null, undefined, 'select 4');

    await workspace.removeConnection(first.id);

    expect(workspace.connections().map((c: DatabaseConnection): string => c.id)).toEqual([
      second.id,
    ]);
    expect(workspace.queries().map((q: DatabaseQuery): string => q.id)).toEqual([
      kept.id,
      loose.id,
    ]);
    expect(workspace.valuesFor(first.id)).toEqual({});
  });

  it('removeConnection_closesItsSessionAndClearsTheSelection', async () => {
    const connection: DatabaseConnection = addPostgres();
    await workspace.connect(connection.id);
    workspace.select({ kind: 'connection', connectionId: connection.id });

    await workspace.removeConnection(connection.id);

    expect(client.disconnects).toEqual(['session-1']);
    expect(workspace.selection()).toBeNull();
  });

  it('addQuery_numbersAfterTheExistingQueries', () => {
    expect(workspace.addQuery(null, undefined).title).toBe('Query 1');
    expect(workspace.addQuery(null, undefined).title).toBe('Query 2');
    expect(workspace.addQuery(null, 'shop', 'x', 'Named').title).toBe('Named');
    expect(workspace.queries()[2].database).toBe('shop');
    expect('database' in workspace.queries()[0]).toBe(false);
  });

  it('updateQuery_renamesAndMarksDirty', async () => {
    const query: DatabaseQuery = workspace.addQuery(null, undefined);
    chosenPath = '/a.database.json';
    await workspace.save();

    workspace.updateQuery(query.id, { title: 'Renamed' });

    expect(workspace.query(query.id)?.title).toBe('Renamed');
    expect(workspace.dirty()).toBe(true);
  });

  it('removeQuery_dropsItAndMarksDirty', async () => {
    const query: DatabaseQuery = workspace.addQuery(null, undefined);
    chosenPath = '/a.database.json';
    await workspace.save();

    workspace.removeQuery(query.id);

    expect(workspace.queries()).toEqual([]);
    expect(workspace.dirty()).toBe(true);
  });

  // --- Sessions and the tree ---

  it('connect_handsMainEveryValueSecretsIncludedAndLoadsTheTop', async () => {
    const connection: DatabaseConnection = addPostgres();
    const nodes: readonly DatabaseNode[] = [
      { path: 'db/shop', label: 'shop', icon: 'database', leaf: false },
    ];
    client.expandOutcome = { kind: 'nodes', nodes };

    expect(await workspace.connect(connection.id)).toBe(true);

    expect(client.connects).toEqual([{ engine: 'postgres', values: PG_VALUES }]);
    expect(workspace.sessions().get(connection.id)).toEqual({
      session: 'session-1',
      serverVersion: 'PostgreSQL 17',
    });
    expect(workspace.connecting().has(connection.id)).toBe(false);
    expect(workspace.children().get(nodeKey(connection.id, null))).toEqual({
      state: 'loaded',
      nodes,
    });
  });

  it('connect_whenAlreadyOpen_doesNotConnectAgain', async () => {
    const connection: DatabaseConnection = addPostgres();
    await workspace.connect(connection.id);
    await workspace.connect(connection.id);

    expect(client.connects).toHaveLength(1);
  });

  it('connect_whenItFails_recordsWhyAndOpensNothing', async () => {
    const connection: DatabaseConnection = addPostgres();
    client.connectOutcome = { kind: 'failure', message: 'password authentication failed' };

    expect(await workspace.connect(connection.id)).toBe(false);

    expect(workspace.sessions().has(connection.id)).toBe(false);
    expect(workspace.connectionErrors().get(connection.id)).toBe('password authentication failed');
    expect(workspace.connecting().has(connection.id)).toBe(false);
  });

  it('connect_afterAFailure_clearsTheErrorOnSuccess', async () => {
    const connection: DatabaseConnection = addPostgres();
    client.connectOutcome = { kind: 'failure', message: 'down' };
    await workspace.connect(connection.id);
    client.connectOutcome = { kind: 'connected', session: 's2', serverVersion: 'v' };

    await workspace.connect(connection.id);

    expect(workspace.connectionErrors().has(connection.id)).toBe(false);
  });

  it('connect_forAnUnknownConnection_isFalse', async () => {
    expect(await workspace.connect('nope')).toBe(false);
    expect(client.connects).toEqual([]);
  });

  it('disconnect_closesTheSessionAndForgetsItsTree', async () => {
    const connection: DatabaseConnection = addPostgres();
    const other: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    await workspace.connect(connection.id);
    client.connectOutcome = { kind: 'connected', session: 'session-2', serverVersion: 'v' };
    await workspace.connect(other.id);

    await workspace.disconnect(connection.id);

    expect(client.disconnects).toEqual(['session-1']);
    expect(workspace.sessions().has(connection.id)).toBe(false);
    expect(workspace.children().has(nodeKey(connection.id, null))).toBe(false);
    expect(workspace.children().has(nodeKey(other.id, null))).toBe(true);
  });

  it('updateConnection_closesTheSessionSoTheNextUseReconnects', async () => {
    const connection: DatabaseConnection = addPostgres();
    await workspace.connect(connection.id);

    await workspace.updateConnection(connection.id, 'Production', PG_VALUES);

    expect(client.disconnects).toEqual(['session-1']);
    expect(workspace.sessions().has(connection.id)).toBe(false);
  });

  it('expand_loadsChildrenOnceAndCachesThem', async () => {
    const connection: DatabaseConnection = addPostgres();
    await workspace.connect(connection.id);

    await workspace.expand(connection.id, 'db/shop');
    await workspace.expand(connection.id, 'db/shop');

    expect(
      client.expands.filter((entry: { path: string | null }): boolean => entry.path === 'db/shop'),
    ).toHaveLength(1);
  });

  it('expand_whenItFailed_triesAgain', async () => {
    const connection: DatabaseConnection = addPostgres();
    await workspace.connect(connection.id);
    client.expandOutcome = { kind: 'failure', message: 'permission denied' };
    await workspace.expand(connection.id, 'db/shop');

    const failed: NodeChildren | undefined = workspace
      .children()
      .get(nodeKey(connection.id, 'db/shop'));
    expect(failed).toEqual({ state: 'failed', message: 'permission denied' });

    client.expandOutcome = { kind: 'nodes', nodes: [] };
    await workspace.expand(connection.id, 'db/shop');
    expect(workspace.children().get(nodeKey(connection.id, 'db/shop'))).toEqual({
      state: 'loaded',
      nodes: [],
    });
  });

  it('expand_withoutASession_doesNothing', async () => {
    const connection: DatabaseConnection = addPostgres();

    await workspace.expand(connection.id, null);

    expect(client.expands).toEqual([]);
  });

  it('refresh_reloadsEvenWhenLoaded', async () => {
    const connection: DatabaseConnection = addPostgres();
    await workspace.connect(connection.id);

    await workspace.refresh(connection.id, null);

    expect(client.expands).toHaveLength(2);
  });

  // --- Node actions ---

  it('runAction_aScriptOpensAsANewQuery', async () => {
    const connection: DatabaseConnection = addPostgres();
    await workspace.connect(connection.id);
    client.actionOutcome = {
      kind: 'script',
      title: 'Select Top 100',
      text: 'select * from t',
      reads: true,
    };
    const node: DatabaseNode = {
      path: 't',
      label: 't',
      icon: 'table',
      leaf: false,
      database: 'shop',
    };

    const query: DatabaseQuery | null = await workspace.runAction(connection.id, node, 'select');

    expect(query?.title).toBe('Select Top 100');
    expect(query?.database).toBe('shop');
    expect(query?.connectionId).toBe(connection.id);
    // Open only, by default: nothing ran.
    expect(client.executes).toEqual([]);
  });

  it('runAction_aReadingScriptRunsWhenTheUserAskedForThat', async () => {
    selectAction.set('open-and-run');
    const connection: DatabaseConnection = addPostgres();
    await workspace.connect(connection.id);
    client.actionOutcome = { kind: 'script', title: 'Top', text: 'select 1', reads: true };
    const node: DatabaseNode = { path: 't', label: 't', icon: 'table', leaf: false };

    await workspace.runAction(connection.id, node, 'select');
    await settle();

    expect(client.executes.map((request: ExecuteRequest): string => request.text)).toEqual([
      'select 1',
    ]);
  });

  it('runAction_aScriptThatChangesThingsIsOnlyEverOpened', async () => {
    selectAction.set('open-and-run');
    const connection: DatabaseConnection = addPostgres();
    await workspace.connect(connection.id);
    client.actionOutcome = { kind: 'script', title: 'Drop', text: 'drop table t' };
    const node: DatabaseNode = { path: 't', label: 't', icon: 'table', leaf: false };

    await workspace.runAction(connection.id, node, 'drop');
    await settle();

    expect(client.executes).toEqual([]);
  });

  it('script_withoutASession_failsWithoutAskingMain', async () => {
    const connection: DatabaseConnection = addPostgres();

    const outcome: NodeActionOutcome = await workspace.script(connection.id, 't', 'create');

    expect(outcome.kind).toBe('failure');
    expect(client.actions).toEqual([]);
  });

  // --- Executing ---

  it('execute_connectsFirstAndRecordsTheOutcome', async () => {
    const connection: DatabaseConnection = addPostgres();
    const query: DatabaseQuery = workspace.addQuery(connection.id, 'shop', 'select 1');

    const outcome: ExecuteOutcome | null = await workspace.execute(query.id, 'select 1', 3);

    expect(client.connects).toHaveLength(1);
    expect(client.executes).toHaveLength(1);
    expect(client.executes[0]).toMatchObject({
      session: 'session-1',
      text: 'select 1',
      firstLine: 3,
      database: 'shop',
    });
    expect(outcome?.failed).toBe(false);
    expect(workspace.outcome(query.id)).toEqual(outcome);
    expect(workspace.outcomes().get(query.id)).toEqual(outcome);
    expect(workspace.running().has(query.id)).toBe(false);
  });

  it('execute_withoutAConnection_doesNothing', async () => {
    const query: DatabaseQuery = workspace.addQuery(null, undefined, 'select 1');

    expect(await workspace.execute(query.id, 'select 1')).toBeNull();
    expect(client.executes).toEqual([]);
  });

  it('execute_whenTheConnectionFails_recordsAFailedOutcomeWithTheReason', async () => {
    const connection: DatabaseConnection = addPostgres();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'select 1');
    client.connectOutcome = { kind: 'failure', message: 'no route to host' };

    const outcome: ExecuteOutcome | null = await workspace.execute(query.id, 'select 1');

    expect(outcome?.failed).toBe(true);
    expect(outcome?.messages).toEqual([{ severity: 'error', text: 'no route to host' }]);
    expect(client.executes).toEqual([]);
  });

  it('execute_whileRunning_refusesASecondRunAndCancelGoesToMain', async () => {
    const connection: DatabaseConnection = addPostgres();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'select 1');
    await workspace.connect(connection.id);
    let release: () => void = (): void => undefined;
    client.executeGate = new Promise<void>((resolve: () => void): void => {
      release = resolve;
    });

    const first: Promise<ExecuteOutcome | null> = workspace.execute(query.id, 'select 1');
    await settle();
    expect(workspace.running().has(query.id)).toBe(true);
    expect(await workspace.execute(query.id, 'select 1')).toBeNull();

    workspace.cancel(query.id);
    expect(client.cancels).toEqual([client.executes[0].id]);

    release();
    await first;
    expect(workspace.running().has(query.id)).toBe(false);
    expect(client.executes).toHaveLength(1);
  });

  it('cancel_whenNothingIsRunning_sendsNothing', () => {
    workspace.cancel('nope');

    expect(client.cancels).toEqual([]);
  });

  it('fetchMore_appendsTheNextPageFromWhereTheRowsEnd', async () => {
    const connection: DatabaseConnection = addPostgres();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'select n');
    await workspace.execute(query.id, 'select n');

    await workspace.fetchMore(query.id, 'rs-1');

    expect(client.fetches).toEqual([
      { session: 'session-1', resultSet: 'rs-1', offset: 1, count: 1_000 },
    ]);
    expect(workspace.outcome(query.id)?.resultSets[0].rows).toEqual([[1], [2], [3]]);
  });

  it('outcomes_areNotPartOfTheDocument', async () => {
    const connection: DatabaseConnection = addPostgres();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'select 1');
    await workspace.execute(query.id, 'select 1');

    const document: DatabaseDocument = workspace.toDocument();

    expect(Object.keys(document).sort()).toEqual(['connections', 'kind', 'queries', 'version']);
    expect(JSON.stringify(document)).not.toContain('session-1');
  });

  it('closeAll_closesEverySession', async () => {
    const first: DatabaseConnection = addPostgres();
    const second: DatabaseConnection = workspace.addConnection('Local', 'sqlite', {});
    await workspace.connect(first.id);
    client.connectOutcome = { kind: 'connected', session: 'session-2', serverVersion: 'v' };
    await workspace.connect(second.id);

    await workspace.closeAll();

    expect([...client.disconnects].sort()).toEqual(['session-1', 'session-2']);
    expect(workspace.sessions().size).toBe(0);
  });
});
