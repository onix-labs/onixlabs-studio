import { EventEmitter } from 'node:events';
import type { Connection, ConnectionConfiguration, Request } from 'tedious';
import { describe, expect, it } from 'vitest';
import { connectFailure, ServerMessage, SqlServerLink } from './sqlserver-link';

/**
 * A stand-in for a `tedious` connection: it logs in as told and holds each request it is handed until
 * the test finishes it.
 */
class FakeConnection extends EventEmitter {
  public readonly requests: Request[] = [];
  public cancels: number = 0;
  public closed: number = 0;

  public constructor(private readonly loginError: Error | null = null) {
    super();
  }

  public connect(done: (error?: Error) => void): void {
    queueMicrotask((): void => done(this.loginError ?? undefined));
  }

  public execSqlBatch(request: Request): void {
    this.requests.push(request);
  }

  public cancel(): boolean {
    this.cancels += 1;
    return true;
  }

  public close(): void {
    this.closed += 1;
  }
}

/**
 * Finishes a request as `tedious` does, through its completion callback.
 * @param request The request.
 * @param error The error it ended with, or null.
 */
function finish(request: Request, error: Error | null = null): void {
  (request as unknown as { callback: (error: Error | null) => void }).callback(error);
}

/**
 * Opens a link over a fake connection.
 * @param connection The fake.
 * @returns Returns a promise resolving the link.
 */
function open(connection: FakeConnection): Promise<SqlServerLink> {
  return SqlServerLink.open(
    {} as ConnectionConfiguration,
    (): Connection => connection as unknown as Connection,
  );
}

/**
 * Lets queued work run.
 * @returns Returns a promise resolving once it has.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('connectFailure', () => {
  it('pointsACertificateFailure_atTheSettingThatFixesIt', () => {
    expect(
      connectFailure(
        'Failed to connect to db:1433 - self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca',
      ),
    ).toBe(
      "Failed to connect to db:1433 - self-signed certificate. Turn on Trust server certificate for this connection, or install the server's certificate on this machine.",
    );
  });

  it('leavesAnyOtherFailureAsItIs', () => {
    expect(connectFailure("Login failed for user 'sa'.")).toBe("Login failed for user 'sa'.");
  });
});

describe('SqlServerLink', () => {
  it('open_rejectsWithTheLoginFailure_andClosesTheConnection', async () => {
    const connection: FakeConnection = new FakeConnection(new Error("Login failed for user 'sa'."));

    await expect(open(connection)).rejects.toThrow("Login failed for user 'sa'.");
    expect(connection.closed).toBe(1);
  });

  it('batch_runsOneRequestAtATime_inTheOrderAsked', async () => {
    const connection: FakeConnection = new FakeConnection();
    const link: SqlServerLink = await open(connection);

    const first: Promise<Error | null> = link.batch('select 1', {});
    const second: Promise<Error | null> = link.batch('select 2', {});
    await settle();

    // The second waits: a connection runs one request at a time.
    expect(connection.requests).toHaveLength(1);
    finish(connection.requests[0]);
    expect(await first).toBeNull();
    await settle();
    expect(connection.requests).toHaveLength(2);
    finish(connection.requests[1], new Error('Canceled.'));
    expect((await second)?.message).toBe('Canceled.');
  });

  it('batch_routesTheServersMessagesToTheRunningRequest_leavingOutUsesHousekeeping', async () => {
    const connection: FakeConnection = new FakeConnection();
    const link: SqlServerLink = await open(connection);
    const messages: ServerMessage[] = [];

    const running: Promise<Error | null> = link.batch('use shop; print 1', {
      onMessage: (message: ServerMessage): void => void messages.push(message),
    });
    await settle();
    connection.emit('infoMessage', {
      number: 5701,
      message: "Changed database context to 'shop'.",
      lineNumber: 1,
    });
    connection.emit('infoMessage', { number: 0, message: '1', lineNumber: 1 });
    connection.emit('errorMessage', {
      number: 207,
      message: 'Invalid column name.',
      lineNumber: 2,
    });
    finish(connection.requests[0]);
    await running;
    // A message after the request has finished belongs to no one.
    connection.emit('infoMessage', { number: 0, message: 'late', lineNumber: 1 });

    expect(messages).toEqual([
      { severity: 'info', text: '1', lineNumber: 1 },
      { severity: 'error', text: 'Invalid column name.', lineNumber: 2 },
    ]);
  });

  it('batch_reportsColumnsRowsAndDone_asTheyArrive', async () => {
    const connection: FakeConnection = new FakeConnection();
    const link: SqlServerLink = await open(connection);
    const seen: string[] = [];

    const running: Promise<Error | null> = link.batch('select 1 as one', {
      onColumns: (columns): void => void seen.push(`columns ${columns[0]?.colName}`),
      onRow: (cells): void => void seen.push(`row ${String(cells[0]?.value)}`),
      onDone: (count): void => void seen.push(`done ${count}`),
    });
    await settle();
    const request: EventEmitter = connection.requests[0];
    request.emit('columnMetadata', [{ colName: 'one', type: { name: 'Int' } }]);
    request.emit('row', [{ value: 1 }]);
    request.emit('done', 1);
    finish(connection.requests[0]);
    await running;

    expect(seen).toEqual(['columns one', 'row 1', 'done 1']);
  });

  it('rows_gathersTheValues_andRejectsWithTheServersError', async () => {
    const connection: FakeConnection = new FakeConnection();
    const link: SqlServerLink = await open(connection);

    const read: Promise<readonly (readonly unknown[])[]> = link.rows('select 1');
    await settle();
    connection.requests[0].emit('row', [{ value: 1 }, { value: 'a' }]);
    finish(connection.requests[0]);
    expect(await read).toEqual([[1, 'a']]);

    const failing: Promise<readonly (readonly unknown[])[]> = link.rows('select nope');
    await settle();
    connection.emit('errorMessage', {
      number: 207,
      message: "Invalid column name 'nope'.",
      lineNumber: 1,
    });
    finish(connection.requests[1], new Error('Request failed.'));
    await expect(failing).rejects.toThrow("Invalid column name 'nope'.");
  });

  it('batch_onAnEndedConnection_failsAtOnce', async () => {
    const connection: FakeConnection = new FakeConnection();
    const link: SqlServerLink = await open(connection);
    connection.emit('end');

    expect((await link.batch('select 1', {}))?.message).toBe(
      'The connection to the server has closed.',
    );
    expect(connection.requests).toEqual([]);
  });
});
