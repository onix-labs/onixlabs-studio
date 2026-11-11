import { Connection, ConnectionConfiguration, Request } from 'tedious';
import { describeError } from '../../protocol/database/engine';

/**
 * A message the server sent while a batch ran: `PRINT` and `RAISERROR` at severity 10 or below are
 * informational, anything above is an error.
 */
export interface ServerMessage {
  /**
   * Gets how serious it is.
   */
  readonly severity: 'info' | 'error';

  /**
   * Gets its text.
   */
  readonly text: string;

  /**
   * Gets the line within the batch it refers to, counting from 1; 0 when it names none.
   */
  readonly lineNumber: number;
}

/**
 * One column of a result set, as `tedious` describes it.
 */
export interface LinkColumn {
  /**
   * Gets the column's name.
   */
  readonly colName: string;

  /**
   * Gets its type, and its size.
   */
  readonly type: { readonly name: string };

  /**
   * Gets its byte length.
   */
  readonly dataLength?: number;
}

/**
 * One cell of a row, as `tedious` hands it over.
 */
export interface LinkCell {
  /**
   * Gets the cell's value.
   */
  readonly value: unknown;
}

/**
 * What a batch reports as it runs.
 */
export interface BatchEvents {
  /**
   * A result set begins, with its columns.
   */
  readonly onColumns?: (columns: readonly LinkColumn[]) => void;

  /**
   * A row of the current result set arrives.
   */
  readonly onRow?: (cells: readonly LinkCell[]) => void;

  /**
   * A statement finished, with the rows it returned or affected when it says.
   */
  readonly onDone?: (rowCount: number | undefined) => void;

  /**
   * The server sent a message.
   */
  readonly onMessage?: (message: ServerMessage) => void;
}

/**
 * The informational messages a batch's own housekeeping produces, which say nothing the user asked:
 * the database and language changes every `USE` and login reports.
 */
const HOUSEKEEPING_MESSAGES: ReadonlySet<number> = new Set<number>([5701, 5703]);

/**
 * Words a failure to connect for the user. Node's advice on a certificate it cannot verify (`try running
 * Node.js with --use-system-ca`) is no use inside Studio, so a certificate failure says what is: trust
 * the server's certificate in the connection's settings, or install it.
 * @param message The failure, as `tedious` words it.
 * @returns Returns the message to show.
 */
export function connectFailure(message: string): string {
  if (!/certificate/i.test(message)) {
    return message;
  }
  const reason: string = message.replace(/;\s*if the root CA is installed locally.*$/i, '');
  return `${reason}. Turn on Trust server certificate for this connection, or install the server's certificate on this machine.`;
}

/**
 * One connection to a SQL Server, which runs one request at a time: requests are queued, so a tree
 * expand that arrives while another is reading waits its turn rather than failing.
 */
export class SqlServerLink {
  /**
   * Holds the tail of the request queue.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Holds where the running request's messages go; the server sends them on the connection.
   */
  private sink: ((message: ServerMessage) => void) | null = null;

  /**
   * Gets whether the connection has ended, after which it can run nothing.
   */
  public ended: boolean = false;

  /**
   * Wraps an open connection.
   * @param connection The connection, logged in.
   */
  private constructor(private readonly connection: Connection) {
    connection.on(
      'infoMessage',
      (message: { number: number; message: string; lineNumber: number }) => {
        if (!HOUSEKEEPING_MESSAGES.has(message.number)) {
          this.sink?.({ severity: 'info', text: message.message, lineNumber: message.lineNumber });
        }
      },
    );
    connection.on('errorMessage', (message: { message: string; lineNumber: number }) => {
      this.sink?.({ severity: 'error', text: message.message, lineNumber: message.lineNumber });
    });
    connection.on('end', (): void => {
      this.ended = true;
    });
    // A dropped connection is reported by the request it fails; with no listener, Node would throw.
    connection.on('error', (): void => {
      this.ended = true;
    });
  }

  /**
   * Opens a connection and logs in.
   * @param config The connection's configuration.
   * @param create Makes the connection; injected so the link is testable without a server.
   * @returns Returns a promise resolving the link; it rejects with a message fit to show.
   */
  public static open(
    config: ConnectionConfiguration,
    create: (config: ConnectionConfiguration) => Connection = (
      settings: ConnectionConfiguration,
    ): Connection => new Connection(settings),
  ): Promise<SqlServerLink> {
    return new Promise<SqlServerLink>(
      (resolve: (link: SqlServerLink) => void, reject: (error: Error) => void): void => {
        const connection: Connection = create(config);
        connection.connect((error?: Error): void => {
          if (error === undefined || error === null) {
            resolve(new SqlServerLink(connection));
          } else {
            connection.close();
            reject(new Error(connectFailure(describeError(error))));
          }
        });
      },
    );
  }

  /**
   * Runs a batch once the requests before it have finished.
   * @param sql The batch.
   * @param events What to report as it runs.
   * @param timeoutMs How long it may run, in milliseconds; undefined or 0 for no limit.
   * @returns Returns a promise resolving the error the batch ended with, or null; it never rejects.
   */
  public batch(sql: string, events: BatchEvents, timeoutMs?: number): Promise<Error | null> {
    const run: () => Promise<Error | null> = (): Promise<Error | null> =>
      new Promise<Error | null>((resolve: (error: Error | null) => void): void => {
        if (this.ended) {
          resolve(new Error('The connection to the server has closed.'));
          return;
        }
        this.sink = events.onMessage ?? null;
        const request: Request = new Request(sql, (error?: Error | null): void => {
          this.sink = null;
          resolve(error ?? null);
        });
        if (timeoutMs !== undefined && timeoutMs > 0) {
          request.setTimeout(timeoutMs);
        }
        request.on('columnMetadata', (columns: unknown): void => {
          events.onColumns?.(
            (Array.isArray(columns) ? columns : Object.values(columns as object)) as LinkColumn[],
          );
        });
        request.on('row', (cells: unknown): void => {
          events.onRow?.(cells as LinkCell[]);
        });
        request.on('done', (rowCount: number | undefined): void => events.onDone?.(rowCount));
        request.on('doneInProc', (rowCount: number | undefined): void => events.onDone?.(rowCount));
        try {
          this.connection.execSqlBatch(request);
        } catch (error: unknown) {
          this.sink = null;
          resolve(error instanceof Error ? error : new Error(describeError(error)));
        }
      });
    const next: Promise<Error | null> = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  /**
   * Runs a metadata query and gathers its rows.
   * @param sql The query.
   * @returns Returns a promise resolving the rows' values; it rejects with the server's error.
   */
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
      throw new Error(errors[0] ?? describeError(error));
    }
    return rows;
  }

  /**
   * Cancels the running request, which then ends with a cancellation error.
   */
  public cancel(): void {
    this.connection.cancel();
  }

  /**
   * Closes the connection.
   */
  public close(): void {
    this.ended = true;
    this.connection.close();
  }
}
