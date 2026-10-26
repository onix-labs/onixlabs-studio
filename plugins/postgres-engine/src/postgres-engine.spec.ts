/**
 * The plugin runs under plain Node, and so does this spec: `pg` hands back Node's own `Buffer`, which
 * the DOM environment's `Uint8Array` would not recognise. `pg` itself is replaced by a fake client, so
 * no server is ever reached.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { CompletionName, DatabaseNode, NodeActionOutcome } from '../../protocol/database/protocol';
import {
  encodePath,
  EngineExecution,
  EngineSession,
  MAX_RESULT_ROWS,
} from '../../protocol/database/engine';
import { constraintKind, PostgresEngine, toValue } from './postgres-engine';

/**
 * One query a fake client was asked to run.
 */
interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
  readonly rowMode: string | undefined;
}

/**
 * The parts of a `pg` result the engine reads.
 */
interface FakeResult {
  readonly rows: unknown[][];
  readonly fields: readonly { readonly name: string; readonly dataTypeID: number }[];
  readonly command?: string;
  readonly rowCount?: number | null;
}

/**
 * Answers a query a fake client was asked to run.
 */
type Responder = (client: FakeClient, call: QueryCall) => FakeResult | Promise<FakeResult>;

/**
 * A stand-in for `pg.Client`.
 */
interface FakeClient {
  readonly config: Record<string, unknown>;
  readonly processID: number;
  readonly queries: QueryCall[];
  ended: boolean;
  connect(): Promise<void>;
  query(
    config: string | { text: string; values?: unknown[]; rowMode?: string },
    values?: unknown[],
  ): Promise<FakeResult>;
  on(event: string, listener: (payload: unknown) => void): void;
  removeListener(event: string, listener: (payload: unknown) => void): void;
  emit(event: string, payload: unknown): void;
  listenerCount(event: string): number;
  end(): Promise<void>;
}

/**
 * The state the fake `pg` module shares with the tests.
 */
interface PgMock {
  readonly clients: FakeClient[];
  respond: Responder | null;
  connectError: Error | null;
  versionError: Error | null;
  readonly getTypeParser: Mock<(oid: number, format?: string) => unknown>;
  readonly Client: new (config: Record<string, unknown>) => FakeClient;
}

const pgMock: PgMock = vi.hoisted((): PgMock => {
  let nextPid: number = 4000;
  const clients: FakeClient[] = [];

  class Client implements FakeClient {
    public readonly processID: number = nextPid++;
    public readonly queries: QueryCall[] = [];
    public ended: boolean = false;
    private readonly listeners: Map<string, ((payload: unknown) => void)[]> = new Map<
      string,
      ((payload: unknown) => void)[]
    >();

    public constructor(public readonly config: Record<string, unknown>) {
      clients.push(this);
    }

    public connect(): Promise<void> {
      return state.connectError === null ? Promise.resolve() : Promise.reject(state.connectError);
    }

    public async query(
      config: string | { text: string; values?: unknown[]; rowMode?: string },
      values?: unknown[],
    ): Promise<FakeResult> {
      const call: QueryCall =
        typeof config === 'string'
          ? { text: config, values, rowMode: undefined }
          : { text: config.text, values: config.values, rowMode: config.rowMode };
      this.queries.push(call);
      if (call.text === 'show server_version') {
        if (state.versionError !== null) {
          throw state.versionError;
        }
        return { rows: [['16.4']], fields: [] };
      }
      if (call.text.startsWith('select oid::int, typname from pg_type')) {
        return {
          rows: [
            [20, 'int8'],
            [23, 'int4'],
            [25, 'text'],
          ],
          fields: [],
        };
      }
      if (state.respond === null) {
        throw new Error(`Unexpected query: ${call.text}`);
      }
      return state.respond(this, call);
    }

    public on(event: string, listener: (payload: unknown) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }

    public removeListener(event: string, listener: (payload: unknown) => void): void {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter(
          (candidate: (payload: unknown) => void): boolean => candidate !== listener,
        ),
      );
    }

    public emit(event: string, payload: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(payload);
      }
    }

    public listenerCount(event: string): number {
      return (this.listeners.get(event) ?? []).length;
    }

    public end(): Promise<void> {
      this.ended = true;
      return Promise.resolve();
    }
  }

  const state: PgMock = {
    clients,
    respond: null,
    connectError: null,
    versionError: null,
    getTypeParser: vi.fn((): unknown => 'the default parser'),
    Client,
  };
  return state;
});

vi.mock('pg', (): Record<string, unknown> => ({
  default: { Client: pgMock.Client, types: { getTypeParser: pgMock.getTypeParser } },
}));

/**
 * Builds a row-returning result whose columns are all of one type.
 * @param rows The rows.
 * @param columns The column names.
 * @param oid The columns' type oid.
 * @returns Returns the result.
 */
function rowsResult(rows: unknown[][], columns: readonly string[], oid: number = 23): FakeResult {
  return {
    rows,
    fields: columns.map((name: string): { name: string; dataTypeID: number } => ({
      name,
      dataTypeID: oid,
    })),
    command: 'SELECT',
    rowCount: rows.length,
  };
}

/**
 * Builds a metadata result: rows, no interest in the fields.
 * @param rows The rows.
 * @returns Returns the result.
 */
function metadata(rows: unknown[][]): FakeResult {
  return { rows, fields: [] };
}

describe('constraintKind', (): void => {
  it('namesEachConstraintCode_andPassesAnUnknownOneThrough', (): void => {
    expect(['p', 'f', 'u', 'c', 'x', 't'].map(constraintKind)).toEqual([
      'primary key',
      'foreign key',
      'unique',
      'check',
      'exclusion',
      't',
    ]);
  });
});

describe('toValue', (): void => {
  it('typesTheItemsOfAnArray_byItsElementType', (): void => {
    // int8[]: an item beyond a double's range stays exact.
    expect(toValue(['1', '9007199254740993'], 1016)).toEqual({
      type: 'list',
      items: [1, { type: 'bigint', value: '9007199254740993' }],
    });
    // timestamptz[]: read as text, so each item keeps its microseconds and zone.
    expect(toValue(['2026-01-01 21:34:05.123456+00'], 1185)).toEqual({
      type: 'list',
      items: [{ type: 'temporal', value: '2026-01-01 21:34:05.123456+00' }],
    });
    // A two-dimensional int8[] types its innermost items too.
    expect(toValue([['1'], ['2']], 1016)).toEqual({
      type: 'list',
      items: [
        { type: 'list', items: [1] },
        { type: 'list', items: [2] },
      ],
    });
    // An array of another type keeps what pg parsed.
    expect(toValue([1, 2], 1007)).toEqual({ type: 'list', items: [1, 2] });
  });

  it('readsNullAndUndefinedAsNull', (): void => {
    expect(toValue(null, 23)).toBeNull();
    expect(toValue(undefined, 23)).toBeNull();
  });

  it('keepsTheTextOfEveryTemporalType_asWritten', (): void => {
    const temporal: readonly [number, string][] = [
      [1082, '2026-10-26'],
      [1083, '12:34:56.123456'],
      [1266, '12:34:56.123456+01'],
      [1114, '2026-10-26 12:34:56.123456'],
      [1184, '2026-10-26 12:34:56.123456+00'],
      [1186, '1 day 02:03:04'],
    ];

    for (const [oid, value] of temporal) {
      expect(toValue(value, oid)).toEqual({ type: 'temporal', value });
    }
  });

  it('readsAnInt8AsANumber_whenItFitsExactly', (): void => {
    expect(toValue('42', 20)).toBe(42);
    expect(toValue('-9007199254740991', 20)).toBe(-9007199254740991);
  });

  it('readsAnInt8AsDigits_whenANumberWouldRoundIt', (): void => {
    expect(toValue('9007199254740993', 20)).toEqual({ type: 'bigint', value: '9007199254740993' });
    expect(toValue('-9223372036854775808', 20)).toEqual({
      type: 'bigint',
      value: '-9223372036854775808',
    });
  });

  it('passesStringsNumbersAndBooleansThrough', (): void => {
    // numeric (1700) arrives as a string so no digit is lost, and stays one.
    expect(toValue('123.4500', 1700)).toBe('123.4500');
    expect(toValue(7, 23)).toBe(7);
    expect(toValue(1.5, 701)).toBe(1.5);
    expect(toValue(true, 16)).toBe(true);
  });

  it('readsABigintByWhetherItFits', (): void => {
    expect(toValue(5n, 0)).toBe(5);
    expect(toValue(2n ** 63n, 0)).toEqual({ type: 'bigint', value: '9223372036854775808' });
  });

  it('describesByteaByItsSizeAndAHexPreview', (): void => {
    const bytes: Buffer = Buffer.from(
      Array.from({ length: 20 }, (_: unknown, i: number): number => i),
    );

    expect(toValue(bytes, 17)).toEqual({
      type: 'bytes',
      size: 20,
      preview: '000102030405060708090a0b0c0d0e0f',
    });
  });

  it('readsADateAsAnIsoTemporal', (): void => {
    expect(toValue(new Date(Date.UTC(2026, 9, 26, 12, 0, 0)), 0)).toEqual({
      type: 'temporal',
      value: '2026-10-26T12:00:00.000Z',
    });
  });

  it('readsAnArrayAsAList_convertingEachItem', (): void => {
    expect(toValue([1, 'two', null, [true]], 1007)).toEqual({
      type: 'list',
      items: [1, 'two', null, { type: 'list', items: [true] }],
    });
  });

  it('readsAnythingElseAsJson', (): void => {
    const value: { a: number; b: string[] } = { a: 1, b: ['x'] };

    expect(toValue(value, 3802)).toEqual({ type: 'json', value });
  });
});

describe('PostgresEngine', (): void => {
  let sessions: EngineSession[];

  beforeEach((): void => {
    pgMock.clients.length = 0;
    pgMock.respond = null;
    pgMock.connectError = null;
    pgMock.versionError = null;
    pgMock.getTypeParser.mockClear();
    sessions = [];
  });

  afterEach(async (): Promise<void> => {
    for (const session of sessions) {
      await session.close();
    }
  });

  /**
   * Connects with the given values.
   * @param values The connection's field values.
   * @returns Returns the session.
   */
  async function open(values: Record<string, string> = {}): Promise<EngineSession> {
    const session: EngineSession = await new PostgresEngine().connect({
      host: 'db.example',
      user: 'alice',
      database: 'shop',
      ...values,
    });
    sessions.push(session);
    return session;
  }

  /**
   * Lists the children of a path given as segments.
   * @param session The session.
   * @param segments The path's segments.
   * @returns Returns the children.
   */
  function expand(session: EngineSession, ...segments: string[]): Promise<readonly DatabaseNode[]> {
    return session.expand(encodePath(...segments));
  }

  /**
   * Runs a script.
   * @param session The session.
   * @param script The script.
   * @param firstLine The line it starts on.
   * @param id The execution's identifier.
   * @returns Returns what it produced.
   */
  function run(
    session: EngineSession,
    script: string,
    firstLine: number = 1,
    id: string = 'run-1',
  ): Promise<EngineExecution> {
    return session.execute({ id, session: 's1', text: script, firstLine });
  }

  it('info_describesPostgresAndItsConnectionFields', (): void => {
    const engine: PostgresEngine = new PostgresEngine();

    expect(engine.info).toMatchObject({
      id: 'postgres',
      displayName: 'PostgreSQL',
      language: 'pgsql',
      queryExtension: 'sql',
      capabilities: ['cancel', 'multipleDatabases', 'script', 'completion'],
    });
    expect(engine.info.connectionFields.map((field: { id: string }): string => field.id)).toEqual([
      'host',
      'port',
      'database',
      'user',
      'password',
      'ssl',
    ]);
    expect(engine.info.connectionFields[4]).toMatchObject({ kind: 'password', secret: true });
    expect(
      engine.info.connectionFields[5].options?.map(
        (option: { value: string }): string => option.value,
      ),
    ).toEqual(['disable', 'require', 'no-verify']);
  });

  it('connect_fallsBackToTheDefaults_andReportsTheServerVersion', async (): Promise<void> => {
    const session: EngineSession = await new PostgresEngine().connect({});
    sessions.push(session);

    expect(pgMock.clients).toHaveLength(1);
    expect(pgMock.clients[0].config).toMatchObject({
      host: 'localhost',
      port: 5432,
      user: '',
      password: '',
      database: 'postgres',
      ssl: false,
      connectionTimeoutMillis: 10_000,
    });
    expect(session.serverVersion).toBe('PostgreSQL 16.4');
  });

  it('connect_trimsTheValues_andParsesThePort', async (): Promise<void> => {
    await open({
      host: '  pg.local ',
      port: '6543',
      user: ' bob ',
      password: ' secret ',
      database: ' ',
    });

    expect(pgMock.clients[0].config).toMatchObject({
      host: 'pg.local',
      port: 6543,
      user: 'bob',
      // A password is taken as typed.
      password: ' secret ',
      database: 'postgres',
    });
  });

  it('connect_fallsBackToTheDefaultPort_forOneThatIsNotANumber', async (): Promise<void> => {
    await open({ port: 'abc', host: '   ' });

    expect(pgMock.clients[0].config).toMatchObject({ host: 'localhost', port: 5432 });
  });

  it('connect_mapsEachSslMode', async (): Promise<void> => {
    await open({ ssl: 'disable' });
    await open({ ssl: 'require' });
    await open({ ssl: 'no-verify' });

    expect(pgMock.clients.map((client: FakeClient): unknown => client.config['ssl'])).toEqual([
      false,
      { rejectUnauthorized: true },
      { rejectUnauthorized: false },
    ]);
  });

  it('connect_keepsTemporalTextAsWritten_andLeavesOtherTypesToPg', async (): Promise<void> => {
    await open();
    const getTypeParser: (oid: number, format?: string) => unknown = (
      pgMock.clients[0].config['types'] as {
        getTypeParser: (oid: number, format?: string) => unknown;
      }
    ).getTypeParser;

    const temporal: (raw: string) => unknown = getTypeParser(1184, 'text') as (
      raw: string,
    ) => unknown;
    expect(temporal('2026-10-26 12:34:56.123456+00')).toBe('2026-10-26 12:34:56.123456+00');
    expect(pgMock.getTypeParser).not.toHaveBeenCalled();
    expect(getTypeParser(23, 'text')).toBe('the default parser');
    expect(pgMock.getTypeParser).toHaveBeenCalledWith(23, 'text');
  });

  it('connect_rejectsWithTheServersMessage_whenItCannotConnect', async (): Promise<void> => {
    pgMock.connectError = new Error('connect ECONNREFUSED 127.0.0.1:5432');

    await expect(new PostgresEngine().connect({})).rejects.toThrow(
      'connect ECONNREFUSED 127.0.0.1:5432',
    );
  });

  it('connect_rejects_whenTheVersionCannotBeRead', async (): Promise<void> => {
    pgMock.versionError = new Error('permission denied for parameter server_version');

    await expect(open()).rejects.toThrow('permission denied for parameter server_version');
    // A session that never opened is never handed out, so its client is closed here or not at all.
    expect(pgMock.clients[0].ended).toBe(true);
  });

  it('expand_listsTheDatabases_throughTheConnectionsOwnDatabase', async (): Promise<void> => {
    pgMock.respond = (_: FakeClient, call: QueryCall): FakeResult => {
      expect(call.text).toContain('from pg_database');
      return metadata([
        ['postgres', '7 MB', 'postgres'],
        ['shop', '12 MB', 'alice'],
      ]);
    };

    const nodes: readonly DatabaseNode[] = await (await open()).expand(null);

    expect(pgMock.clients).toHaveLength(1);
    expect(nodes.map((node: DatabaseNode): string => node.label)).toEqual(['postgres', 'shop']);
    expect(nodes[1]).toEqual({
      path: encodePath('db', 'shop'),
      label: 'shop',
      detail: '12 MB',
      icon: 'database',
      leaf: false,
      database: 'shop',
      properties: [
        { name: 'Database', value: 'shop' },
        { name: 'Size', value: '12 MB' },
        { name: 'Owner', value: 'alice' },
      ],
    });
  });

  it('expand_listsADatabasesSchemas_overAClientOfItsOwn', async (): Promise<void> => {
    pgMock.respond = (client: FakeClient, call: QueryCall): FakeResult => {
      expect(call.text).toContain('from pg_namespace');
      expect(client.config['database']).toBe('reports');
      return metadata([['public', 'alice']]);
    };
    const session: EngineSession = await open();

    const nodes: readonly DatabaseNode[] = await expand(session, 'db', 'reports');
    // The second expand reuses the client it opened.
    await expand(session, 'db', 'reports');

    expect(pgMock.clients.map((client: FakeClient): unknown => client.config['database'])).toEqual([
      'shop',
      'reports',
    ]);
    expect(nodes).toEqual([
      {
        path: encodePath('db', 'reports', 'schema', 'public'),
        label: 'public',
        icon: 'schema',
        leaf: false,
        database: 'reports',
        properties: [
          { name: 'Schema', value: 'public' },
          { name: 'Owner', value: 'alice' },
        ],
      },
    ]);
  });

  it('expand_listsASchemasFoldersWithTheirCounts_markingAnEmptyOneALeaf', async (): Promise<void> => {
    let values: readonly unknown[] | undefined;
    pgMock.respond = (_: FakeClient, call: QueryCall): FakeResult => {
      values = call.values;
      // count(*) is an int8, which pg hands back as a string.
      return metadata([['3', '1', '0', '2']]);
    };

    const nodes: readonly DatabaseNode[] = await expand(
      await open(),
      'db',
      'shop',
      'schema',
      'sales',
    );

    expect(values).toEqual(['sales']);
    expect(
      nodes.map((node: DatabaseNode): [string, string, string | undefined, boolean] => [
        node.path,
        node.label,
        node.detail,
        node.leaf,
      ]),
    ).toEqual([
      [encodePath('db', 'shop', 'schema', 'sales', 'tables'), 'Tables', '3', false],
      [encodePath('db', 'shop', 'schema', 'sales', 'views'), 'Views', '1', false],
      [encodePath('db', 'shop', 'schema', 'sales', 'functions'), 'Functions', '0', true],
      [encodePath('db', 'shop', 'schema', 'sales', 'sequences'), 'Sequences', '2', false],
    ]);
  });

  it('expand_listsAFoldersTables_withTheirActionsAndEstimates', async (): Promise<void> => {
    pgMock.respond = (_: FakeClient, call: QueryCall): FakeResult => {
      expect(call.text).toContain(`c.relkind in ('r', 'p')`);
      return metadata([
        ['orders', '1200', '96 kB', 'alice', 'r', 'Every order'],
        ['fresh', '-1', '8 kB', 'alice', 'r', ''],
      ]);
    };

    const nodes: readonly DatabaseNode[] = await expand(
      await open(),
      'db',
      'shop',
      'schema',
      'public',
      'tables',
    );

    expect(nodes[0]).toMatchObject({
      path: encodePath('db', 'shop', 'schema', 'public', 'tables', 'orders'),
      label: 'orders',
      icon: 'table',
      leaf: false,
    });
    expect(nodes[0].actions?.map((action: { id: string }): string => action.id)).toEqual([
      'select-top',
      'script-create',
      'script-select',
    ]);
    expect(nodes[0].properties).toContainEqual({ name: 'Comment', value: 'Every order' });
    expect(nodes[1].properties).toContainEqual({
      name: 'Rows (estimate)',
      value: 'Not yet analysed',
    });
    expect(
      nodes[1].properties?.some(
        (property: { name: string }): boolean => property.name === 'Comment',
      ),
    ).toBe(false);
  });

  it('expand_givesATableColumnsIndexesAndConstraints_butAViewOnlyColumns', async (): Promise<void> => {
    const session: EngineSession = await open();

    expect(
      (await expand(session, 'db', 'shop', 'schema', 'public', 'tables', 'orders')).map(
        (node: DatabaseNode): string => node.label,
      ),
    ).toEqual(['Columns', 'Indexes', 'Constraints']);
    expect(
      (await expand(session, 'db', 'shop', 'schema', 'public', 'views', 'recent')).map(
        (node: DatabaseNode): string => node.label,
      ),
    ).toEqual(['Columns']);
  });

  it('expand_namesATablesConstraintsByKind', async (): Promise<void> => {
    let values: readonly unknown[] | undefined;
    pgMock.respond = (_: FakeClient, call: QueryCall): FakeResult => {
      values = call.values;
      return metadata([
        ['orders_pkey', 'p', 'PRIMARY KEY (id)'],
        ['orders_total_check', 'c', 'CHECK (total >= 0)'],
      ]);
    };

    const nodes: readonly DatabaseNode[] = await expand(
      await open(),
      'db',
      'shop',
      'schema',
      'public',
      'tables',
      'Orders "2"',
      'constraints',
    );

    expect(values).toEqual(['"public"."Orders ""2"""']);
    expect(
      nodes.map((node: DatabaseNode): [string, string | undefined, string] => [
        node.label,
        node.detail,
        node.icon,
      ]),
    ).toEqual([
      ['orders_pkey', 'primary key', 'key'],
      ['orders_total_check', 'check', 'constraint'],
    ]);
  });

  it('execute_runsEachStatement_withResultSetsAndMessagesOnTheirLines', async (): Promise<void> => {
    pgMock.respond = (_: FakeClient, call: QueryCall): FakeResult => {
      expect(call.rowMode).toBe('array');
      if (call.text === 'select id, name from customers') {
        return {
          rows: [
            ['9007199254740993', 'Ada'],
            ['2', 'Grace'],
          ],
          fields: [
            { name: 'id', dataTypeID: 20 },
            { name: 'name', dataTypeID: 25 },
          ],
          command: 'SELECT',
          rowCount: 2,
        };
      }
      if (call.text.startsWith('insert')) {
        return { rows: [], fields: [], command: 'INSERT', rowCount: 3 };
      }
      if (call.text === 'select 1 as one') {
        return rowsResult([[1]], ['one']);
      }
      return { rows: [], fields: [], command: 'CREATE TABLE', rowCount: null };
    };
    const session: EngineSession = await open();

    const execution: EngineExecution = await run(
      session,
      'select id, name from customers;\ninsert into t values (1), (2), (3);\n\nselect 1 as one;\ncreate table x ()',
      10,
    );

    expect(execution.failed).toBe(false);
    expect(execution.cancelled).toBe(false);
    expect(execution.resultSets).toEqual([
      {
        columns: [
          { name: 'id', type: 'int8' },
          { name: 'name', type: 'text' },
        ],
        rows: [
          [{ type: 'bigint', value: '9007199254740993' }, 'Ada'],
          [2, 'Grace'],
        ],
        line: 10,
      },
      { columns: [{ name: 'one', type: 'int4' }], rows: [[1]], line: 13 },
    ]);
    expect(execution.messages).toEqual([
      { severity: 'info', text: '2 rows returned', line: 10 },
      { severity: 'info', text: 'INSERT 3', line: 11 },
      { severity: 'info', text: '1 row returned', line: 13 },
      { severity: 'info', text: 'CREATE TABLE', line: 14 },
    ]);
  });

  it('execute_readsTheTypeNamesOnlyOnce', async (): Promise<void> => {
    pgMock.respond = (): FakeResult => rowsResult([[1]], ['one']);
    const session: EngineSession = await open();

    await run(session, 'select 1 as one');
    await run(session, 'select 1 as one', 1, 'run-2');

    expect(
      pgMock.clients[0].queries.filter((call: QueryCall): boolean => call.text.includes('pg_type')),
    ).toHaveLength(1);
  });

  it('execute_keepsTheFirstMaxResultRows_andSaysSo', async (): Promise<void> => {
    const rows: unknown[][] = Array.from({ length: MAX_RESULT_ROWS + 5 }, (): unknown[] => [1]);
    pgMock.respond = (): FakeResult => rowsResult(rows, ['n']);

    const execution: EngineExecution = await run(await open(), 'select n from big');

    expect(execution.resultSets[0].rows).toHaveLength(MAX_RESULT_ROWS);
    expect(execution.messages).toEqual([
      {
        severity: 'warning',
        text: `${MAX_RESULT_ROWS + 5} rows returned; the first ${MAX_RESULT_ROWS} are kept`,
        line: 1,
      },
    ]);
  });

  it('execute_reportsServerNotices_andStopsListeningAfterwards', async (): Promise<void> => {
    pgMock.respond = (client: FakeClient): FakeResult => {
      client.emit('notice', { severity: 'NOTICE', message: 'table "x" does not exist, skipping' });
      client.emit('notice', {
        severity: 'WARNING',
        message: 'there is no transaction in progress',
      });
      return { rows: [], fields: [], command: 'DROP TABLE', rowCount: null };
    };
    const session: EngineSession = await open();

    const execution: EngineExecution = await run(session, 'drop table if exists x');

    expect(execution.messages).toEqual([
      { severity: 'info', text: 'NOTICE: table "x" does not exist, skipping' },
      { severity: 'warning', text: 'WARNING: there is no transaction in progress' },
      { severity: 'info', text: 'DROP TABLE', line: 1 },
    ]);
    expect(pgMock.clients[0].listenerCount('notice')).toBe(0);
  });

  it('execute_mapsAnErrorsPositionToItsLine_andStopsThere', async (): Promise<void> => {
    pgMock.respond = (_: FakeClient, call: QueryCall): FakeResult => {
      if (call.text.includes('nope')) {
        const error: Error & { position?: string } = new Error('column "nope" does not exist');
        // 1-based, into the statement's text: the "n" of "nope" on the statement's second line.
        error.position = String(call.text.indexOf('nope') + 1);
        throw error;
      }
      return rowsResult([[1]], ['one']);
    };
    const session: EngineSession = await open();

    const execution: EngineExecution = await run(
      session,
      'select 1 as one;\nselect 1,\n  nope\nfrom t;\nselect 1 as one;',
      5,
    );

    expect(execution.failed).toBe(true);
    expect(execution.cancelled).toBe(false);
    expect(execution.resultSets).toHaveLength(1);
    expect(execution.messages.at(-1)).toEqual({
      severity: 'error',
      text: 'column "nope" does not exist',
      line: 7,
    });
    // The statement after the failing one never ran.
    expect(
      pgMock.clients[0].queries.filter(
        (call: QueryCall): boolean => call.text === 'select 1 as one',
      ),
    ).toHaveLength(1);
  });

  it('execute_reportsAnErrorWithoutAPosition_onItsStatementsLine', async (): Promise<void> => {
    pgMock.respond = (): never => {
      throw new Error('permission denied for table secrets');
    };

    const execution: EngineExecution = await run(await open(), '\n\nselect * from secrets', 1);

    expect(execution.failed).toBe(true);
    expect(execution.messages).toEqual([
      { severity: 'error', text: 'permission denied for table secrets', line: 3 },
    ]);
  });

  it('execute_answersAFailure_ratherThanRejecting_whenItsDatabaseCannotBeReached', async (): Promise<void> => {
    const session: EngineSession = await open();
    pgMock.connectError = new Error('database "gone" does not exist');

    const execution: EngineExecution = await session.execute({
      id: 'run-1',
      session: 's1',
      text: 'select 1',
      firstLine: 1,
      database: 'gone',
    });

    expect(execution).toEqual({
      resultSets: [],
      messages: [{ severity: 'error', text: 'database "gone" does not exist' }],
      failed: true,
      cancelled: false,
    });
  });

  it('cancel_cancelsTheBackend_andTheOutcomeReadsAsCancelledNotFailed', async (): Promise<void> => {
    let fail: (error: Error) => void = (): void => undefined;
    let started: () => void = (): void => undefined;
    const running: Promise<void> = new Promise<void>((resolve: () => void): void => {
      started = resolve;
    });
    pgMock.respond = (client: FakeClient, call: QueryCall): FakeResult | Promise<FakeResult> => {
      if (call.text.startsWith('select pg_cancel_backend')) {
        fail(new Error('canceling statement due to user request'));
        return metadata([[true]]);
      }
      if (call.text === 'select pg_sleep(60)') {
        started();
        return new Promise<FakeResult>((_: unknown, reject: (error: Error) => void): void => {
          fail = reject;
        });
      }
      return rowsResult([[1]], ['one']);
    };
    const session: EngineSession = await open();
    const worker: FakeClient = pgMock.clients[0];

    const execution: Promise<EngineExecution> = run(
      session,
      'select pg_sleep(60);\nselect 1 as one;',
      1,
      'run-9',
    );
    await running;
    session.cancel('run-9');
    const outcome: EngineExecution = await execution;

    expect(outcome).toEqual({
      resultSets: [],
      messages: [{ severity: 'warning', text: 'The query was cancelled.', line: 1 }],
      failed: false,
      cancelled: true,
    });
    // The cancel went over a short-lived connection of its own, to the same database, naming the
    // worker's backend.
    const canceller: FakeClient = pgMock.clients[1];
    expect(canceller.config['database']).toBe('shop');
    expect(canceller.queries).toEqual([
      { text: 'select pg_cancel_backend($1)', values: [worker.processID], rowMode: undefined },
    ]);
    await vi.waitFor((): void => {
      expect(canceller.ended).toBe(true);
    });
    expect(worker.ended).toBe(false);
  });

  it('cancel_whoseConnectionFails_leavesTheWorkingConnectionInUse', async (): Promise<void> => {
    pgMock.respond = (): FakeResult => rowsResult([[1]], ['one']);
    const session: EngineSession = await open();
    const worker: FakeClient = pgMock.clients[0];
    let release: () => void = (): void => undefined;
    pgMock.respond = (_: FakeClient, call: QueryCall): FakeResult | Promise<FakeResult> =>
      call.text === 'select pg_sleep(60)'
        ? new Promise<FakeResult>((resolve: (result: FakeResult) => void): void => {
            release = (): void => resolve(rowsResult([[1]], ['one']));
          })
        : rowsResult([[1]], ['one']);
    const execution: Promise<EngineExecution> = run(session, 'select pg_sleep(60);', 1, 'run-3');
    await vi.waitFor((): void => {
      expect(
        worker.queries.some((call: QueryCall): boolean => call.text === 'select pg_sleep(60)'),
      ).toBe(true);
    });

    session.cancel('run-3');
    await vi.waitFor((): void => {
      expect(pgMock.clients).toHaveLength(2);
    });
    // The cancel's own connection drops; that says nothing about the worker's.
    pgMock.clients[1].emit('error', new Error('Connection terminated unexpectedly'));
    release();
    await execution;
    await run(session, 'select 1 as one;', 1, 'run-4');

    expect(worker.queries.map((call: QueryCall): string => call.text)).toContain('select 1 as one');
    expect(
      pgMock.clients.filter((client: FakeClient): boolean => client.config['database'] === 'shop'),
    ).toHaveLength(2);
  });

  it('cancel_ignoresAnExecutionThatIsNotRunning', async (): Promise<void> => {
    const session: EngineSession = await open();

    session.cancel('nothing');

    expect(pgMock.clients).toHaveLength(1);
  });

  it('execute_afterACancel_isNotCancelled', async (): Promise<void> => {
    pgMock.respond = (): FakeResult => rowsResult([[1]], ['one']);
    const session: EngineSession = await open();
    // A cancel for an execution that has finished leaves nothing behind for the next with its id.
    session.cancel('run-1');

    expect((await run(session, 'select 1 as one')).cancelled).toBe(false);
  });

  it('action_scriptsASelectTop_andRefusesAnUnknownActionOrPath', async (): Promise<void> => {
    const session: EngineSession = await open();
    const orders: string = encodePath('db', 'shop', 'schema', 'public', 'tables', 'orders');

    expect(await session.action(orders, 'select-top')).toEqual({
      kind: 'script',
      title: 'orders',
      text: 'SELECT *\nFROM "public"."orders"\nLIMIT 1000;\n',
      database: 'shop',
      reads: true,
    });
    expect(await session.action(orders, 'drop')).toEqual({
      kind: 'failure',
      message: "Unknown action 'drop'.",
    });
    const nothing: NodeActionOutcome = await session.action('garbage', 'select-top');
    expect(nothing).toEqual({ kind: 'failure', message: 'Nothing to act on.' });
  });

  it('names_runsTheThreeCatalogueQueriesOneAfterAnother_andMapsThemToNames', async (): Promise<void> => {
    let running: number = 0;
    let most: number = 0;
    const order: string[] = [];
    pgMock.respond = async (_: FakeClient, call: QueryCall): Promise<FakeResult> => {
      running += 1;
      most = Math.max(most, running);
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
      running -= 1;
      expect(call.rowMode).toBe('array');
      if (call.text.includes('from pg_namespace')) {
        order.push('schemas');
        expect(call.text).not.toContain('from pg_class');
        return metadata([['public'], ['sales']]);
      }
      if (call.text.includes('from pg_class')) {
        order.push('relations');
        expect(call.text).toContain('current_schemas(false)');
        return metadata([
          ['orders', 'r', 'public'],
          ['parts', 'p', 'public'],
          ['totals', 'v', 'public'],
          ['rollup', 'm', 'sales'],
          ['remote', 'f', 'public'],
        ]);
      }
      order.push('functions');
      expect(call.text).toContain('from pg_proc');
      return metadata([['count'], ['now']]);
    };
    const session: EngineSession = await open();

    const names: readonly CompletionName[] = (await session.names?.({ kind: 'objects' })) ?? [];

    expect(most).toBe(1);
    expect(order).toEqual(['schemas', 'relations', 'functions']);
    expect(names).toEqual([
      { name: 'public', kind: 'schema' },
      { name: 'sales', kind: 'schema' },
      { name: 'orders', kind: 'table', detail: 'public' },
      { name: 'parts', kind: 'table', detail: 'public' },
      { name: 'totals', kind: 'view', detail: 'public' },
      { name: 'rollup', kind: 'view', detail: 'sales' },
      { name: 'remote', kind: 'table', detail: 'public' },
      { name: 'count', kind: 'function' },
      { name: 'now', kind: 'function' },
    ]);
  });

  it('names_readsTheCatalogueOfTheQuerysDatabase_overAClientOfItsOwn', async (): Promise<void> => {
    const databases: unknown[] = [];
    pgMock.respond = (client: FakeClient): FakeResult => {
      databases.push(client.config['database']);
      return metadata([]);
    };
    const session: EngineSession = await open();

    expect(await session.names?.({ kind: 'objects' }, 'reports')).toEqual([]);

    expect(databases).toEqual(['reports', 'reports', 'reports']);
  });

  it('names_listsAMembersColumns_resolvingTheNameByToRegclass_asAParameter', async (): Promise<void> => {
    const calls: QueryCall[] = [];
    pgMock.respond = (_: FakeClient, call: QueryCall): FakeResult => {
      calls.push(call);
      return metadata([
        ['id', 'integer'],
        ['placed', 'timestamp with time zone'],
      ]);
    };
    const session: EngineSession = await open();

    const names: readonly CompletionName[] | undefined = await session.names?.({
      kind: 'members',
      of: 'public."Order\'s"',
    });

    expect(names).toEqual([
      { name: 'id', kind: 'column', detail: 'integer' },
      { name: 'placed', kind: 'column', detail: 'timestamp with time zone' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('to_regclass($1)');
    expect(calls[0].text).not.toContain('Order');
    expect(calls[0].values).toEqual(['public."Order\'s"']);
  });

  it('names_listsNoMembers_whenTheColumnsQueryFails', async (): Promise<void> => {
    pgMock.respond = (): FakeResult => {
      throw new Error('invalid name syntax');
    };
    const session: EngineSession = await open();

    expect(await session.names?.({ kind: 'members', of: '"unclosed' })).toEqual([]);
  });

  it('close_endsEveryClientTheSessionOpened', async (): Promise<void> => {
    pgMock.respond = (): FakeResult => metadata([]);
    const session: EngineSession = await new PostgresEngine().connect({});
    await expand(session, 'db', 'other');

    await session.close();

    expect(pgMock.clients.map((client: FakeClient): boolean => client.ended)).toEqual([true, true]);
  });
});
