import type { ConnectionConfiguration } from 'tedious';
import { describe, expect, it } from 'vitest';
import {
  ConnectionField,
  DatabaseNode,
  ExecuteRequest,
  NodeActionOutcome,
} from '../../protocol/database/protocol';
import { encodePath, EngineExecution, EngineSession } from '../../protocol/database/engine';
import {
  connectionConfig,
  settingsFrom,
  SqlServerEngine,
  SqlServerSettings,
} from './sqlserver-engine';
import { BatchEvents, LinkCell, ServerMessage, SqlServerLink } from './sqlserver-link';

/**
 * Answers one batch a fake connection was asked to run, reporting through its events.
 */
type Responder = (sql: string, events: BatchEvents) => Error | null | Promise<Error | null>;

/**
 * A stand-in for a connection to SQL Server, which records what it is asked and answers from a
 * responder.
 */
class FakeLink {
  public ended: boolean = false;
  public closed: number = 0;
  public cancels: number = 0;
  public readonly batches: string[] = [];

  public constructor(
    public readonly database: string,
    private readonly respond: Responder,
  ) {}

  public batch(sql: string, events: BatchEvents): Promise<Error | null> {
    this.batches.push(sql);
    return Promise.resolve(this.respond(sql, events));
  }

  public async rows(sql: string): Promise<readonly (readonly unknown[])[]> {
    const rows: (readonly unknown[])[] = [];
    const errors: string[] = [];
    const error: Error | null = await this.batch(sql, {
      onRow: (cells: readonly LinkCell[]): void => {
        rows.push(cells.map((cell: LinkCell): unknown => cell.value));
      },
      onMessage: (message: ServerMessage): void => {
        if (message.severity === 'error') {
          errors.push(message.text);
        }
      },
    });
    if (error !== null || errors.length > 0) {
      throw new Error(errors[0] ?? error?.message);
    }
    return rows;
  }

  public cancel(): void {
    this.cancels += 1;
  }

  public close(): void {
    this.closed += 1;
    this.ended = true;
  }
}

/**
 * Sends one row of values.
 * @param events The batch's events.
 * @param values The row's values.
 */
function row(events: BatchEvents, ...values: unknown[]): void {
  events.onRow?.(values.map((value: unknown): LinkCell => ({ value })));
}

/**
 * The version `select @@version` answers with.
 */
const VERSION: string =
  'Microsoft SQL Server 2022 (RTM-CU16) (KB5048033) - 16.0.4165.4 (X64)\n\tNov  6 2024\n\tCopyright';

/**
 * Builds an engine over fake connections, answering `select @@version` and anything the test's own
 * responder leaves unanswered with nothing.
 * @param respond The test's responder.
 * @returns Returns the engine and the connections it opened, in order.
 */
function fakes(respond: Responder = (): null => null): {
  engine: SqlServerEngine;
  links: FakeLink[];
} {
  const links: FakeLink[] = [];
  const engine: SqlServerEngine = new SqlServerEngine(
    (_settings: SqlServerSettings, database: string): Promise<SqlServerLink> => {
      const link: FakeLink = new FakeLink(database, (sql: string, events: BatchEvents) => {
        if (sql === 'select @@version') {
          row(events, VERSION);
          return null;
        }
        return respond(sql, events);
      });
      links.push(link);
      return Promise.resolve(link as unknown as SqlServerLink);
    },
  );
  return { engine, links };
}

/**
 * The values a SQL login to a database named `shop` connects with.
 */
const LOGIN: Readonly<Record<string, string>> = {
  host: 'db.example',
  user: 'sa',
  password: 'secret',
  database: 'shop',
};

/**
 * Runs a script.
 * @param session The session.
 * @param text The script.
 * @param options The execution's options.
 * @returns Returns what it produced.
 */
function run(
  session: EngineSession,
  text: string,
  options: ExecuteRequest['options'] = {},
): Promise<EngineExecution> {
  return session.execute({ id: 'run-1', session: 's', text, firstLine: 1, options });
}

describe('SqlServerEngine', () => {
  it('info_offersALoginAndEncryption_withThePasswordASecret', () => {
    const engine: SqlServerEngine = new SqlServerEngine();

    expect(engine.info.capabilities).toEqual([
      'cancel',
      'multipleDatabases',
      'script',
      'completion',
      'transactions',
    ]);
    expect(engine.info.connectionFields.map((field: ConnectionField): string => field.id)).toEqual([
      'host',
      'port',
      'authentication',
      'user',
      'password',
      'database',
      'encrypt',
      'trustServerCertificate',
    ]);
    expect(
      engine.info.connectionFields.find((field: ConnectionField) => field.id === 'password')
        ?.secret,
    ).toBe(true);
  });

  it('settingsFrom_readsEncryptionAndSignIn', () => {
    expect(settingsFrom({})).toMatchObject({
      host: 'localhost',
      port: 1433,
      database: 'master',
      authentication: 'sql',
      encrypt: true,
      trustServerCertificate: false,
    });
    expect(settingsFrom({ encrypt: 'optional' }).encrypt).toBe(false);
    expect(settingsFrom({ encrypt: 'strict' }).encrypt).toBe('strict');
    expect(settingsFrom({ authentication: 'entra-default' }).authentication).toBe('entra-default');
    expect(settingsFrom({}, { timeoutMs: 5000 }).connectTimeoutMs).toBe(5000);
  });

  it('connectionConfig_leavesRequestsUntimed_andSignsInAsAsked', () => {
    // tedious would otherwise stop every request after fifteen seconds.
    const sql: ConnectionConfiguration = connectionConfig(settingsFrom(LOGIN), 'shop');
    expect(sql.options).toMatchObject({ database: 'shop', requestTimeout: 0, encrypt: true });
    expect(sql.authentication).toEqual({
      type: 'default',
      options: { userName: 'sa', password: 'secret' },
    });
    expect(
      connectionConfig(settingsFrom({ authentication: 'entra-default' }), 'master').authentication,
    ).toEqual({ type: 'azure-active-directory-default', options: {} });
  });

  it('connect_withASqlLogin_needsAUser', async () => {
    await expect(fakes().engine.connect({ ...LOGIN, user: ' ' })).rejects.toThrow(
      'Enter the user to sign in as.',
    );
  });

  it('connect_readsTheServersVersion_firstLineOnly', async () => {
    const session: EngineSession = await fakes().engine.connect(LOGIN);

    expect(session.serverVersion).toBe(
      'Microsoft SQL Server 2022 (RTM-CU16) (KB5048033) - 16.0.4165.4 (X64)',
    );
  });

  it('expand_listsTheDatabases_leavingTheSystemOnesOutUnlessAsked', async () => {
    const { engine, links } = fakes((sql: string, events: BatchEvents) => {
      if (sql.includes('sys.databases')) {
        row(events, 'shop', 'ONLINE', 160, 'FULL');
      }
      return null;
    });
    const session: EngineSession = await engine.connect(LOGIN);

    const nodes: readonly DatabaseNode[] = await session.expand(null);
    await session.expand(null, { systemObjects: true });

    expect(nodes[0]).toMatchObject({ label: 'shop', icon: 'database', database: 'shop' });
    const asked: readonly string[] = links[0].batches.filter((sql: string) =>
      sql.includes('sys.databases'),
    );
    expect(asked[0]).toContain('database_id > 4');
    expect(asked[1]).not.toContain('database_id > 4');
  });

  it('expand_aDatabase_listsItsFoldersAsSsmsDoes', async () => {
    const session: EngineSession = await fakes().engine.connect(LOGIN);

    expect(
      (await session.expand(encodePath('db', 'shop'))).map((node: DatabaseNode) => node.label),
    ).toEqual(['Tables', 'Views', 'Programmability', 'Security']);
  });

  it('execute_splitsAtGo_switchesToTheDatabaseFirst_andPlacesEachMessageOnItsLine', async () => {
    const { engine, links } = fakes((sql: string, events: BatchEvents) => {
      if (sql === 'select 1 as one') {
        events.onColumns?.([{ colName: 'one', type: { name: 'IntN' }, dataLength: 4 }]);
        row(events, 1);
        events.onDone?.(1);
      } else if (sql === "\nprint 'hi'") {
        events.onMessage?.({ severity: 'info', text: 'hi', lineNumber: 2 });
        events.onDone?.(undefined);
      }
      return null;
    });
    const session: EngineSession = await engine.connect(LOGIN);

    const outcome: EngineExecution = await run(session, "select 1 as one\nGO\n\nprint 'hi'");

    // The query runs on a connection of its own, which begins by switching to the asked database.
    expect(links[1].batches).toEqual(['use [shop]', 'select 1 as one', "\nprint 'hi'"]);
    expect(outcome.resultSets).toEqual([
      { columns: [{ name: 'one', type: 'int' }], rows: [[1]], line: 1 },
    ]);
    expect(outcome.messages).toEqual([
      { severity: 'info', text: '1 row returned', line: 1 },
      { severity: 'info', text: 'hi', line: 4 },
    ]);
    expect(outcome.failed).toBe(false);
  });

  it('execute_reportsRowsAffected_byAStatementWithNoResult', async () => {
    const { engine } = fakes((sql: string, events: BatchEvents) => {
      if (sql.startsWith('update')) {
        events.onDone?.(3);
      }
      return null;
    });
    const session: EngineSession = await engine.connect(LOGIN);

    expect((await run(session, 'update t set x = 1')).messages).toEqual([
      { severity: 'info', text: '(3 rows affected)', line: 1 },
    ]);
  });

  it('execute_stopsAfterTheFirstBatchThatFails_unlessAskedToCarryOn', async () => {
    const respond: Responder = (sql: string, events: BatchEvents) => {
      if (sql === 'select nope\nfrom t') {
        events.onMessage?.({
          severity: 'error',
          text: "Invalid column name 'nope'.",
          lineNumber: 2,
        });
      }
      return null;
    };
    const stopping: { engine: SqlServerEngine; links: FakeLink[] } = fakes(respond);
    const session: EngineSession = await stopping.engine.connect(LOGIN);

    const outcome: EngineExecution = await run(session, 'select nope\nfrom t\nGO\nselect 2');

    expect(outcome.failed).toBe(true);
    expect(outcome.messages).toEqual([
      { severity: 'error', text: "Invalid column name 'nope'.", line: 2 },
    ]);
    expect(stopping.links[1].batches).not.toContain('select 2');

    const carrying: { engine: SqlServerEngine; links: FakeLink[] } = fakes(respond);
    await run(await carrying.engine.connect(LOGIN), 'select nope\nfrom t\nGO\nselect 2', {
      continueOnError: true,
    });
    expect(carrying.links[1].batches).toContain('select 2');
  });

  it('execute_runsABatchAsManyTimesAsGoAsks', async () => {
    const { engine, links } = fakes();
    const session: EngineSession = await engine.connect(LOGIN);

    await run(session, 'insert t default values\nGO 3');

    expect(links[1].batches.filter((sql: string) => sql.startsWith('insert'))).toHaveLength(3);
  });

  it('execute_keepsOnlyTheRowsAskedFor_andSaysSo', async () => {
    const { engine } = fakes((sql: string, events: BatchEvents) => {
      if (sql === 'select n from t') {
        events.onColumns?.([{ colName: 'n', type: { name: 'Int' } }]);
        row(events, 1);
        row(events, 2);
        events.onDone?.(2);
      }
      return null;
    });
    const session: EngineSession = await engine.connect(LOGIN);

    const outcome: EngineExecution = await run(session, 'select n from t', { maxRows: 1 });

    expect(outcome.resultSets[0]?.rows).toEqual([[1]]);
    expect(outcome.messages[0]).toEqual({
      severity: 'warning',
      text: '2 rows returned; the first 1 are kept',
      line: 1,
    });
  });

  it('cancel_stopsTheRequestOnTheServer_andTheRunReadsAsCancelled', async () => {
    let finish: (error: Error | null) => void = (): void => undefined;
    const { engine, links } = fakes((sql: string) =>
      sql.startsWith('waitfor')
        ? new Promise<Error | null>((resolve: (error: Error | null) => void): void => {
            finish = resolve;
          })
        : null,
    );
    const session: EngineSession = await engine.connect(LOGIN);

    const execution: Promise<EngineExecution> = run(session, "waitfor delay '00:01'\nGO\nselect 2");
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    session.cancel('run-1');
    finish(new Error('Canceled.'));
    const outcome: EngineExecution = await execution;

    expect(links[1].cancels).toBe(1);
    expect(outcome).toMatchObject({ cancelled: true, failed: false });
    expect(outcome.messages).toEqual([
      { severity: 'warning', text: 'The query was cancelled.', line: 1 },
    ]);
    expect(links[1].batches).not.toContain('select 2');
  });

  it('execute_inAManualTransaction_beginsOneOnAConnectionOfItsOwn_andSaysItIsOpen', async () => {
    const { engine, links } = fakes((sql: string, events: BatchEvents) => {
      if (sql === 'select @@trancount') {
        row(events, 1);
      }
      return null;
    });
    const session: EngineSession = await engine.connect(LOGIN);

    const outcome: EngineExecution = await run(session, 'delete from t', {
      manualTransaction: true,
    });

    expect(links[1].batches).toEqual([
      'begin transaction',
      'use [shop]',
      'delete from t',
      'select @@trancount',
    ]);
    expect(outcome.transactionOpen).toBe(true);

    expect(await session.transaction!('commit')).toEqual({
      failed: false,
      message: 'Transaction committed.',
    });
    expect(links[1].batches.at(-1)).toBe('if @@trancount > 0 commit transaction');
    expect(links[1].closed).toBe(1);
  });

  it('execute_inAManualTransactionTheScriptEnded_forgetsIt', async () => {
    const { engine, links } = fakes((sql: string, events: BatchEvents) => {
      if (sql === 'select @@trancount') {
        row(events, 0);
      }
      return null;
    });
    const session: EngineSession = await engine.connect(LOGIN);

    const outcome: EngineExecution = await run(session, 'commit', { manualTransaction: true });

    expect(outcome.transactionOpen).toBe(false);
    expect(links[1].closed).toBe(1);
    expect(await session.transaction!('rollback')).toEqual({
      failed: false,
      message: 'No transaction is open.',
    });
  });

  it('action_scriptsASelectTop_andATablesCreate_fromItsColumns', async () => {
    const { engine } = fakes((sql: string, events: BatchEvents) => {
      if (sql.includes('from sys.columns')) {
        row(events, 'id', 'int', 4, 10, 0, false, true, 1);
        row(events, 'name', 'nvarchar', 200, 0, 0, true, false, 0);
      }
      return null;
    });
    const session: EngineSession = await engine.connect(LOGIN);
    const orders: string = encodePath('db', 'shop', 'tables', 'dbo', 'Orders');

    expect(await session.action(orders, 'select-top')).toEqual({
      kind: 'script',
      reads: true,
      title: 'Orders',
      database: 'shop',
      text: 'SELECT TOP (1000) *\nFROM [dbo].[Orders];\n',
    });
    const created: NodeActionOutcome = await session.action(orders, 'script-create');
    expect(created.kind === 'script' && created.text).toContain(
      '    [id] int IDENTITY NOT NULL,\n    [name] nvarchar(100) NULL,\n    CONSTRAINT [PK_Orders] PRIMARY KEY ([id])',
    );
    expect(await session.action(orders, 'drop')).toMatchObject({ kind: 'failure' });
  });

  it('names_ofATable_listsItsColumnsWithTheirTypes', async () => {
    const { engine } = fakes((sql: string, events: BatchEvents) => {
      if (sql.includes('from sys.columns')) {
        row(events, 'total', 'decimal', 9, 18, 2, false, false, 0);
      }
      return null;
    });
    const session: EngineSession = await engine.connect(LOGIN);

    expect(await session.names!({ kind: 'members', of: '[sales].[Orders]' })).toEqual([
      { name: 'total', kind: 'column', detail: 'decimal(18, 2)' },
    ]);
  });

  it('close_closesEveryConnection', async () => {
    const { engine, links } = fakes();
    const session: EngineSession = await engine.connect(LOGIN);
    await run(session, 'select 1');

    await session.close();

    expect(links.map((link: FakeLink) => link.closed)).toEqual([1, 1]);
  });
});
