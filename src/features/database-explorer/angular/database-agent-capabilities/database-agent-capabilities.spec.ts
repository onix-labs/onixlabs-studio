import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  CREATE_DATABASE_QUERY,
  LIST_DATABASE_CONNECTIONS,
  LIST_DATABASE_OBJECTS,
  LIST_DATABASE_QUERIES,
  RUN_DATABASE_QUERY,
  SCRIPT_DATABASE_OBJECT,
  UPDATE_DATABASE_QUERY,
} from '@shared/api/ai-types';
import { AiBridgeScope } from '@shared/api/ai/ai-bridge-types';
import {
  ConnectionValues,
  ConnectOutcome,
  DatabaseEngineInfo,
  DatabaseValue,
  ExecuteOutcome,
  ExecuteRequest,
  ExpandOutcome,
  NodeActionOutcome,
} from '@shared/api/database-engine-protocol';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { DatabaseEnginePrompt } from '@shared/angular/services/plugins/database-engine-prompt';
import { Settings } from '@shared/angular/services/settings/settings';
import { DatabaseClient } from '../database-client/database-client';
import { DatabasePrompts } from '../database-prompts/database-prompts';
import { DatabaseQueryOpener } from '../database-query-opener/database-query-opener';
import { DatabaseWorkspace } from '../database-workspace/database-workspace';
import { DatabaseAgentCapabilities } from './database-agent-capabilities';

/**
 * The tab the capabilities under test belong to.
 */
const TAB: string = 'tab-db';

/**
 * The scope main stamps on a request from the agent docked in {@link TAB}.
 */
const SCOPE: AiBridgeScope = { owningTabId: TAB, surface: 'database', workspaceRoot: null };

/**
 * The password every test connection is added with — it must never reach the agent.
 */
const PASSWORD: string = 'hunter2-very-secret';

/**
 * An engine with a secret password field.
 */
const POSTGRES: DatabaseEngineInfo = {
  id: 'postgres',
  displayName: 'PostgreSQL',
  language: 'pgsql',
  queryExtension: 'sql',
  capabilities: ['cancel', 'multipleDatabases', 'script'],
  connectionFields: [
    { id: 'host', label: 'Host', kind: 'text' },
    { id: 'password', label: 'Password', kind: 'password', secret: true },
  ],
};

/**
 * A stand-in runtime capturing the capabilities registered against it.
 */
class FakeRuntime {
  /**
   * Holds the registered handlers, keyed by name.
   */
  public readonly capabilities: Map<string, (input: unknown, scope: AiBridgeScope) => unknown> =
    new Map<string, (input: unknown, scope: AiBridgeScope) => unknown>();

  /**
   * Holds the names released.
   */
  public readonly released: string[] = [];

  /**
   * Records a capability and returns its release.
   * @param name The capability's name.
   * @param handler The handler.
   * @returns Returns the release function.
   */
  public registerCapability(
    name: string,
    handler: (input: unknown, scope: AiBridgeScope) => unknown,
  ): () => void {
    this.capabilities.set(name, handler);
    return (): void => {
      this.released.push(name);
    };
  }
}

/**
 * A stand-in engine client.
 */
class FakeClient {
  /**
   * Holds every connect's values.
   */
  public readonly connects: ConnectionValues[] = [];

  /**
   * Holds every execute.
   */
  public readonly executes: ExecuteRequest[] = [];

  /**
   * Holds how many rows each execute returns.
   */
  public rowCount: number = 3;

  /**
   * Resolves the engines.
   * @returns Returns the engines.
   */
  public engines(): Promise<readonly DatabaseEngineInfo[]> {
    return Promise.resolve([POSTGRES]);
  }

  /**
   * Records a connect.
   * @param engine The engine.
   * @param values The values.
   * @returns Returns a connected outcome.
   */
  public connect(engine: string, values: ConnectionValues): Promise<ConnectOutcome> {
    this.connects.push(values);
    return Promise.resolve({ kind: 'connected', session: 's1', serverVersion: 'PostgreSQL 17' });
  }

  /**
   * Resolves once closed.
   * @returns Returns once closed.
   */
  public disconnect(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Answers the tree.
   * @param session The session.
   * @param path The path.
   * @returns Returns the children.
   */
  public expand(session: string, path: string | null): Promise<ExpandOutcome> {
    return Promise.resolve({
      kind: 'nodes',
      nodes:
        path === null
          ? [
              {
                path: 'db/shop',
                label: 'shop',
                icon: 'database',
                leaf: false,
                database: 'shop',
                actions: [{ id: 'create', label: 'Script as CREATE' }],
                properties: [{ name: 'Owner', value: 'admin' }],
              },
            ]
          : [],
    });
  }

  /**
   * Records an execute.
   * @param request The request.
   * @returns Returns an outcome with {@link rowCount} rows.
   */
  public execute(request: ExecuteRequest): Promise<ExecuteOutcome> {
    this.executes.push(request);
    const rows: (readonly DatabaseValue[])[] = Array.from(
      { length: this.rowCount },
      (_: unknown, index: number): readonly DatabaseValue[] => [index],
    );
    return Promise.resolve({
      id: request.id,
      resultSets: [
        {
          id: 'rs',
          columns: [{ name: 'n', type: 'int4' }],
          rows,
          totalRows: this.rowCount,
          line: 1,
        },
      ],
      messages: [{ severity: 'info', text: `${this.rowCount} rows` }],
      elapsedMs: 4,
      failed: false,
      cancelled: false,
    });
  }

  /**
   * Answers an action with a script.
   * @returns Returns the script.
   */
  public action(): Promise<NodeActionOutcome> {
    return Promise.resolve({ kind: 'script', title: 'CREATE shop', text: 'CREATE DATABASE shop;' });
  }
}

describe('DatabaseAgentCapabilities', () => {
  let runtime: FakeRuntime;
  let client: FakeClient;
  let workspace: DatabaseWorkspace;
  let opened: { id: string; background: boolean | undefined }[];
  let connectPrompts: string[];

  /**
   * Invokes a registered capability as the agent docked in the tab would.
   * @param name The capability.
   * @param input The tool input.
   * @param scope The scope main stamped.
   * @returns Returns the answer.
   */
  async function invoke(
    name: string,
    input: unknown = {},
    scope: AiBridgeScope = SCOPE,
  ): Promise<Record<string, unknown>> {
    const handler: ((value: unknown, at: AiBridgeScope) => unknown) | undefined =
      runtime.capabilities.get(name);
    if (handler === undefined) {
      throw new Error(`${name} is not registered`);
    }
    return (await handler(input, scope)) as Record<string, unknown>;
  }

  /**
   * Adds a connection holding a password for the session.
   * @returns Returns the connection.
   */
  function addConnection(): DatabaseConnection {
    return workspace.addConnection('Production', 'postgres', {
      host: 'db.test',
      password: PASSWORD,
    });
  }

  beforeEach(async () => {
    runtime = new FakeRuntime();
    client = new FakeClient();
    opened = [];
    connectPrompts = [];
    TestBed.configureTestingModule({
      providers: [
        DatabaseWorkspace,
        DatabaseAgentCapabilities,
        DockTabContext,
        { provide: AiRuntime, useValue: runtime },
        { provide: DatabaseClient, useValue: client },
        { provide: FileSystem, useValue: {} },
        { provide: Settings, useValue: { databaseSelectAction: signal<string>('open') } },
        { provide: DatabaseEnginePrompt, useValue: { installedKey: signal<string>('postgres') } },
        {
          provide: DatabasePrompts,
          useValue: {
            connect: (id: string): void => {
              connectPrompts.push(id);
            },
          },
        },
        {
          provide: DatabaseQueryOpener,
          useValue: {
            open: (id: string, options?: { background?: boolean }): void => {
              opened.push({ id, background: options?.background });
            },
            retitle: (): void => undefined,
          },
        },
      ],
    });
    TestBed.inject(DockTabContext).setTabId(TAB);
    workspace = TestBed.inject(DatabaseWorkspace);
    TestBed.inject(DatabaseAgentCapabilities);
    TestBed.tick();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });

  it('constructor_registersEveryDatabaseCapabilityOnce', () => {
    expect([...runtime.capabilities.keys()].sort()).toEqual(
      [
        LIST_DATABASE_CONNECTIONS,
        LIST_DATABASE_OBJECTS,
        SCRIPT_DATABASE_OBJECT,
        LIST_DATABASE_QUERIES,
        CREATE_DATABASE_QUERY,
        UPDATE_DATABASE_QUERY,
        RUN_DATABASE_QUERY,
      ].sort(),
    );
  });

  // --- Scope ---

  it('dispatch_fromAnotherSurface_isUnavailable', async () => {
    addConnection();

    const answer: Record<string, unknown> = await invoke(
      LIST_DATABASE_CONNECTIONS,
      {},
      { ...SCOPE, surface: 'project' },
    );

    expect(answer).toEqual({ available: false });
  });

  it('dispatch_fromAnotherTab_isUnavailable', async () => {
    // An agent docked in one Database Explorer tab never acts on another tab's document.
    addConnection();

    const answer: Record<string, unknown> = await invoke(
      LIST_DATABASE_CONNECTIONS,
      {},
      { ...SCOPE, owningTabId: 'other-tab' },
    );

    expect(answer).toEqual({ available: false });
  });

  it('destroy_releasesTheRegistrationsWhenTheLastTabCloses', () => {
    TestBed.resetTestingModule();

    expect(runtime.released.sort()).toEqual([...runtime.capabilities.keys()].sort());
  });

  // --- Secrets ---

  it('listConnections_neverHandsTheAgentAPassword', async () => {
    const connection: DatabaseConnection = addConnection();
    await workspace.connect(connection.id);

    const answer: Record<string, unknown> = await invoke(LIST_DATABASE_CONNECTIONS);

    expect(JSON.stringify(answer)).not.toContain(PASSWORD);
    expect(answer).toEqual({
      ok: true,
      connections: [
        {
          id: connection.id,
          name: 'Production',
          engine: 'PostgreSQL',
          language: 'pgsql',
          multiple_databases: true,
          connected: true,
          server: 'PostgreSQL 17',
          last_error: undefined,
          settings: { host: 'db.test' },
        },
      ],
    });
  });

  it('everyAnswer_isFreeOfThePassword', async () => {
    const connection: DatabaseConnection = addConnection();
    const created: Record<string, unknown> = await invoke(CREATE_DATABASE_QUERY, {
      connection_id: connection.id,
      title: 'Orders',
      text: 'select 1',
    });

    const answers: Record<string, unknown>[] = [
      await invoke(LIST_DATABASE_CONNECTIONS),
      await invoke(LIST_DATABASE_OBJECTS, { connection_id: connection.id }),
      await invoke(SCRIPT_DATABASE_OBJECT, {
        connection_id: connection.id,
        path: 'db/shop',
        action: 'create',
      }),
      await invoke(LIST_DATABASE_QUERIES),
      await invoke(RUN_DATABASE_QUERY, { id: created['id'] }),
    ];

    for (const answer of answers) {
      expect(answer['ok']).toBe(true);
      expect(JSON.stringify(answer)).not.toContain(PASSWORD);
    }
  });

  it('listObjects_whenThePasswordIsNotKnown_asksTheUserNotTheAgent', async () => {
    workspace.load(
      {
        kind: 'onixlabs.studio.database',
        version: 1,
        connections: [{ id: 'c1', name: 'Prod', engine: 'postgres', values: { host: 'h' } }],
        queries: [],
      },
      '/docs/prod.database.json',
    );

    const answer: Record<string, unknown> = await invoke(LIST_DATABASE_OBJECTS, {
      connection_id: 'c1',
    });

    expect(answer['ok']).toBe(false);
    expect(String(answer['error'])).toContain('the user has been asked');
    expect(connectPrompts).toEqual(['c1']);
    expect(client.connects).toEqual([]);
  });

  // --- Structure ---

  it('listObjects_connectsAndDescribesTheTop', async () => {
    const connection: DatabaseConnection = addConnection();

    const answer: Record<string, unknown> = await invoke(LIST_DATABASE_OBJECTS, {
      connection_id: connection.id,
    });

    expect(answer).toEqual({
      ok: true,
      nodes: [
        {
          path: 'db/shop',
          name: 'shop',
          kind: 'database',
          expandable: true,
          database: 'shop',
          actions: [{ id: 'create', label: 'Script as CREATE' }],
          properties: { Owner: 'admin' },
        },
      ],
    });
  });

  it('listObjects_forAnUnknownConnection_refuses', async () => {
    const answer: Record<string, unknown> = await invoke(LIST_DATABASE_OBJECTS, {
      connection_id: 'nope',
    });

    expect(answer['ok']).toBe(false);
  });

  it('script_returnsTheTextWithoutOpeningAQuery', async () => {
    const connection: DatabaseConnection = addConnection();

    const answer: Record<string, unknown> = await invoke(SCRIPT_DATABASE_OBJECT, {
      connection_id: connection.id,
      path: 'db/shop',
      action: 'create',
    });

    expect(answer).toEqual({ ok: true, title: 'CREATE shop', text: 'CREATE DATABASE shop;' });
    expect(workspace.queries()).toEqual([]);
    expect(opened).toEqual([]);
  });

  // --- Queries ---

  it('create_writesAQueryAndOpensItInTheBackground', async () => {
    // An agent never takes the user away from what they are looking at.
    const connection: DatabaseConnection = addConnection();

    const answer: Record<string, unknown> = await invoke(CREATE_DATABASE_QUERY, {
      connection_id: connection.id,
      database: 'shop',
      title: 'Orders',
      text: 'select * from orders',
    });

    const query: DatabaseQuery | undefined = workspace.query(String(answer['id']));
    expect(query).toMatchObject({
      title: 'Orders',
      connectionId: connection.id,
      database: 'shop',
      text: 'select * from orders',
    });
    expect(opened).toEqual([{ id: query?.id, background: true }]);
    expect(client.executes).toEqual([]);
  });

  it('create_forAnUnknownConnection_refuses', async () => {
    const answer: Record<string, unknown> = await invoke(CREATE_DATABASE_QUERY, {
      connection_id: 'nope',
      text: 'x',
    });

    expect(answer['ok']).toBe(false);
    expect(workspace.queries()).toEqual([]);
  });

  it('update_changesOnlyWhatItNames', async () => {
    const connection: DatabaseConnection = addConnection();
    const query: DatabaseQuery = workspace.addQuery(connection.id, 'shop', 'select 1', 'Orders');

    const answer: Record<string, unknown> = await invoke(UPDATE_DATABASE_QUERY, {
      id: query.id,
      text: 'select 2',
    });

    expect(answer).toEqual({ ok: true });
    expect(workspace.query(query.id)).toMatchObject({
      title: 'Orders',
      database: 'shop',
      text: 'select 2',
    });
  });

  it('listQueries_namesEachQuerysConnection', async () => {
    const connection: DatabaseConnection = addConnection();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'select 1', 'Q');

    expect(await invoke(LIST_DATABASE_QUERIES)).toEqual({
      ok: true,
      queries: [
        {
          id: query.id,
          title: 'Q',
          connection_id: connection.id,
          connection: 'Production',
          text: 'select 1',
        },
      ],
    });
  });

  // --- Running ---

  it('run_runsTheSavedTextNeverTextTheAgentPassesAlongside', async () => {
    // What the user was asked to permit is the saved query's text; nothing in the request can swap it.
    const connection: DatabaseConnection = addConnection();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'select 1', 'Q');

    const answer: Record<string, unknown> = await invoke(RUN_DATABASE_QUERY, {
      id: query.id,
      text: 'drop table orders',
    });

    expect(answer['ok']).toBe(true);
    expect(client.executes.map((request: ExecuteRequest): string => request.text)).toEqual([
      'select 1',
    ]);
    expect(opened).toEqual([{ id: query.id, background: true }]);
  });

  it('run_handsBackASampleOfTheRows', async () => {
    const connection: DatabaseConnection = addConnection();
    const query: DatabaseQuery = workspace.addQuery(connection.id, undefined, 'select n', 'Q');
    client.rowCount = 120;

    const answer: Record<string, unknown> = await invoke(RUN_DATABASE_QUERY, { id: query.id });

    const sets: { columns: string[]; rows: unknown[]; total_rows: number; rows_shown?: number }[] =
      answer['resultSets'] as {
        columns: string[];
        rows: unknown[];
        total_rows: number;
        rows_shown?: number;
      }[];
    expect(sets[0].columns).toEqual(['n (int4)']);
    expect(sets[0].rows).toHaveLength(50);
    expect(sets[0].total_rows).toBe(120);
    expect(sets[0].rows_shown).toBe(50);
    // The whole result is the user's, in the grid.
    expect(workspace.outcome(query.id)?.resultSets[0].rows).toHaveLength(120);
  });

  it('run_aQueryWithNoConnection_refusesWithoutRunning', async () => {
    const query: DatabaseQuery = workspace.addQuery(null, undefined, 'select 1');

    const answer: Record<string, unknown> = await invoke(RUN_DATABASE_QUERY, { id: query.id });

    expect(answer['ok']).toBe(false);
    expect(client.executes).toEqual([]);
  });

  it('run_anUnknownQuery_refuses', async () => {
    const answer: Record<string, unknown> = await invoke(RUN_DATABASE_QUERY, { id: 'nope' });

    expect(answer['ok']).toBe(false);
    expect(client.executes).toEqual([]);
  });
});
