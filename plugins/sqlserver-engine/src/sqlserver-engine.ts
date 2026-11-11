import type { ConnectionConfiguration } from 'tedious';
import {
  CompletionName,
  ConnectionValues,
  ConnectOptions,
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseNodeAction,
  DatabaseValue,
  ExecuteRequest,
  NamesScope,
  NodeActionOutcome,
  QueryMessage,
  ResultColumn,
  TransactionAction,
  TransactionOutcome,
  TreeOptions,
} from '../../protocol/database/protocol';
import {
  DatabaseEngine,
  decodePath,
  describeError,
  encodePath,
  EngineExecution,
  EngineResultSet,
  EngineSession,
  maxResultRows,
  splitQualifiedName,
  text,
} from '../../protocol/database/engine';
import { splitBatches, SqlServerBatch } from './sqlserver-batches';
import { LinkCell, LinkColumn, ServerMessage, SqlServerLink } from './sqlserver-link';
import { bracket, cellValue, declaredType, nstring, sqlTypeName } from './sqlserver-values';

/**
 * How long a connection waits for the server when Studio does not say, in milliseconds.
 */
const DEFAULT_CONNECT_TIMEOUT_MS: number = 15_000;

/**
 * The actions a table or view offers.
 */
const RELATION_ACTIONS: readonly DatabaseNodeAction[] = [
  { id: 'select-top', label: 'Select Top 1000 Rows' },
  { id: 'script-create', label: 'Script as CREATE' },
];

/**
 * The actions a stored procedure or function offers.
 */
const MODULE_ACTIONS: readonly DatabaseNodeAction[] = [
  { id: 'script-create', label: 'Script as CREATE' },
];

/**
 * The folders under a database, in the order SSMS lists them.
 */
const DATABASE_FOLDERS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'tables', label: 'Tables' },
  { id: 'views', label: 'Views' },
  { id: 'programmability', label: 'Programmability' },
  { id: 'security', label: 'Security' },
];

/**
 * The connection's settings, read from its fields.
 */
export interface SqlServerSettings {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly authentication: 'sql' | 'entra-default';
  readonly user: string;
  readonly password: string;
  readonly encrypt: boolean | 'strict';
  readonly trustServerCertificate: boolean;
  readonly connectTimeoutMs: number;
}

/**
 * Opens a connection to a database with the session's settings; injected so the session is testable
 * without a server.
 */
export type LinkOpener = (settings: SqlServerSettings, database: string) => Promise<SqlServerLink>;

/**
 * Builds `tedious`'s configuration for a connection to one database. Requests have no time limit of
 * their own (`tedious` would otherwise stop each after fifteen seconds): an execution's limit is set
 * per request, and the host keeps its own.
 * @param settings The connection's settings.
 * @param database The database to connect to.
 * @returns Returns the configuration.
 */
export function connectionConfig(
  settings: SqlServerSettings,
  database: string,
): ConnectionConfiguration {
  return {
    server: settings.host,
    authentication:
      settings.authentication === 'entra-default'
        ? { type: 'azure-active-directory-default', options: {} }
        : { type: 'default', options: { userName: settings.user, password: settings.password } },
    options: {
      port: settings.port,
      database,
      encrypt: settings.encrypt,
      trustServerCertificate: settings.trustServerCertificate,
      connectTimeout: settings.connectTimeoutMs,
      requestTimeout: 0,
      appName: 'ONIXLabs Studio',
      useColumnNames: false,
      rowCollectionOnRequestCompletion: false,
    },
  };
}

/**
 * SQL Server and Azure SQL through `tedious`, the pure-JavaScript TDS client: no native code and
 * nothing installed beside it. Scripts are split into batches at their `GO` lines as SSMS splits
 * them, `PRINT` and `RAISERROR` reach the Messages tab, and the tree is laid out as SSMS's is.
 */
export class SqlServerEngine implements DatabaseEngine {
  /**
   * Initializes a new instance of the {@link SqlServerEngine} class.
   * @param openLink Opens a connection; defaults to a real one.
   */
  public constructor(
    private readonly openLink: LinkOpener = (
      settings: SqlServerSettings,
      database: string,
    ): Promise<SqlServerLink> => SqlServerLink.open(connectionConfig(settings, database)),
  ) {}

  /**
   * Gets what the engine says about itself.
   */
  public readonly info: DatabaseEngineInfo = {
    id: 'sqlserver',
    displayName: 'SQL Server',
    language: 'sql',
    queryExtension: 'sql',
    capabilities: ['cancel', 'multipleDatabases', 'script', 'completion', 'transactions'],
    connectionFields: [
      {
        id: 'host',
        label: 'Server',
        kind: 'text',
        required: true,
        defaultValue: 'localhost',
        section: 'server',
      },
      {
        id: 'port',
        label: 'Port',
        kind: 'number',
        required: true,
        defaultValue: '1433',
        section: 'server',
        inline: true,
      },
      {
        id: 'authentication',
        label: 'Authentication',
        kind: 'choice',
        defaultValue: 'sql',
        section: 'authentication',
        options: [
          { value: 'sql', label: 'SQL Server Authentication' },
          { value: 'entra-default', label: 'Microsoft Entra (Default Credential)' },
        ],
      },
      {
        id: 'user',
        label: 'User',
        kind: 'text',
        defaultValue: 'sa',
        section: 'authentication',
      },
      {
        id: 'password',
        label: 'Password',
        kind: 'password',
        secret: true,
        section: 'authentication',
      },
      {
        id: 'database',
        label: 'Database',
        kind: 'text',
        required: true,
        defaultValue: 'master',
        section: 'database',
      },
      {
        id: 'encrypt',
        label: 'Encryption',
        kind: 'choice',
        defaultValue: 'mandatory',
        section: 'security',
        options: [
          { value: 'mandatory', label: 'Mandatory' },
          { value: 'optional', label: 'Optional' },
          { value: 'strict', label: 'Strict (TDS 8.0)' },
        ],
      },
      {
        id: 'trustServerCertificate',
        label: 'Trust server certificate',
        kind: 'boolean',
        defaultValue: 'false',
        section: 'security',
      },
    ],
  };

  /**
   * Opens a connection to the named database.
   * @param values The connection's field values.
   * @param options How Studio wants it opened.
   * @returns Returns a promise resolving the session; it rejects with a message fit to show.
   */
  public async connect(values: ConnectionValues, options?: ConnectOptions): Promise<EngineSession> {
    const settings: SqlServerSettings = settingsFrom(values, options);
    if (settings.authentication === 'sql' && settings.user === '') {
      throw new Error('Enter the user to sign in as.');
    }
    const session: SqlServerSession = new SqlServerSession(settings, this.openLink);
    await session.open();
    return session;
  }
}

/**
 * Reads a connection's settings from its field values.
 * @param values The field values.
 * @param options How Studio wants it opened.
 * @returns Returns the settings.
 */
export function settingsFrom(
  values: ConnectionValues,
  options?: ConnectOptions,
): SqlServerSettings {
  const encrypt: string = values['encrypt'] ?? 'mandatory';
  return {
    host: (values['host'] ?? 'localhost').trim() || 'localhost',
    port: Number(values['port'] ?? '1433') || 1433,
    database: (values['database'] ?? 'master').trim() || 'master',
    authentication: values['authentication'] === 'entra-default' ? 'entra-default' : 'sql',
    user: (values['user'] ?? '').trim(),
    password: values['password'] ?? '',
    encrypt: encrypt === 'strict' ? 'strict' : encrypt !== 'optional',
    trustServerCertificate: values['trustServerCertificate'] === 'true',
    connectTimeoutMs: options?.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  };
}

/**
 * A result set while its rows arrive.
 */
interface GrowingResultSet {
  readonly columns: readonly ResultColumn[];
  readonly typeNames: readonly string[];
  readonly rows: (readonly DatabaseValue[])[];
  readonly line: number;
  total: number;
}

/**
 * One connection to a SQL Server. A connection is bound to one database at a time, so the session
 * keeps one per database for the tree and one for queries, and a query's own `USE` cannot carry over
 * to the next run: each run begins by switching back to the database it was asked for.
 */
class SqlServerSession implements EngineSession {
  /**
   * Gets the server's version, read on open.
   */
  public serverVersion: string = 'SQL Server';

  /**
   * Holds the connections the tree and completion read through, by database.
   */
  private readonly metaLinks: Map<string, Promise<SqlServerLink>> = new Map<
    string,
    Promise<SqlServerLink>
  >();

  /**
   * Holds the connections queries run on, by database.
   */
  private readonly queryLinks: Map<string, Promise<SqlServerLink>> = new Map<
    string,
    Promise<SqlServerLink>
  >();

  /**
   * Holds the connections with a manual transaction open, by database.
   */
  private readonly transactions: Map<string, SqlServerLink> = new Map<string, SqlServerLink>();

  /**
   * Holds the connection each running execution is using, so a cancel can reach it.
   */
  private readonly running: Map<string, SqlServerLink> = new Map<string, SqlServerLink>();

  /**
   * Holds the executions a cancel has been asked for.
   */
  private readonly cancelled: Set<string> = new Set<string>();

  /**
   * Creates the session.
   * @param settings The connection's settings.
   * @param openLink Opens a connection.
   */
  public constructor(
    private readonly settings: SqlServerSettings,
    private readonly openLink: LinkOpener,
  ) {}

  /**
   * Connects to the connection's own database and reads the server's version.
   */
  public async open(): Promise<void> {
    try {
      const link: SqlServerLink = await this.link(this.metaLinks, this.settings.database);
      const rows: readonly (readonly unknown[])[] = await link.rows('select @@version');
      this.serverVersion = text(rows[0]?.[0] ?? 'SQL Server')
        .split('\n')[0]
        .trim();
    } catch (error: unknown) {
      await this.close();
      throw error;
    }
  }

  /**
   * Gets a database's connection from a pool, opening it on first use or after it has dropped.
   * @param pool The pool.
   * @param database The database.
   * @returns Returns a promise resolving the connection.
   */
  private async link(
    pool: Map<string, Promise<SqlServerLink>>,
    database: string,
  ): Promise<SqlServerLink> {
    const existing: Promise<SqlServerLink> | undefined = pool.get(database);
    if (existing !== undefined) {
      const link: SqlServerLink | null = await existing.catch((): null => null);
      if (link !== null && !link.ended) {
        return link;
      }
    }
    const opening: Promise<SqlServerLink> = this.openLink(this.settings, database);
    pool.set(database, opening);
    opening.catch((): void => {
      if (pool.get(database) === opening) {
        pool.delete(database);
      }
    });
    return opening;
  }

  /**
   * Lists a node's children.
   * @param path The node's path, or null for the top of the tree.
   * @param options How Studio wants the tree described.
   * @returns Returns a promise resolving the children.
   */
  public async expand(
    path: string | null,
    options?: TreeOptions,
  ): Promise<readonly DatabaseNode[]> {
    const segments: readonly string[] = path === null ? [] : decodePath(path);
    const system: boolean = options?.systemObjects === true;
    const [, database, folder, ...rest] = segments;
    if (database === undefined) {
      return this.databases(system);
    }
    if (folder === undefined) {
      return DATABASE_FOLDERS.map(
        (entry: { readonly id: string; readonly label: string }): DatabaseNode => ({
          path: encodePath('db', database, entry.id),
          label: entry.label,
          icon: 'folder',
          leaf: false,
          database,
        }),
      );
    }
    const link: SqlServerLink = await this.link(this.metaLinks, database);
    switch (folder) {
      case 'tables':
      case 'views':
        return rest.length === 0
          ? this.relations(link, database, folder, system)
          : this.columns(link, database, rest[0] ?? '', rest[1] ?? '');
      case 'programmability':
        return rest.length === 0
          ? [
              folderNode(database, 'programmability', 'procedures', 'Stored Procedures'),
              folderNode(database, 'programmability', 'functions', 'Functions'),
            ]
          : this.modules(
              link,
              database,
              rest[0] === 'functions' ? 'functions' : 'procedures',
              system,
            );
      case 'security':
        return rest.length === 0
          ? [
              folderNode(database, 'security', 'users', 'Users'),
              folderNode(database, 'security', 'roles', 'Roles'),
              folderNode(database, 'security', 'schemas', 'Schemas'),
            ]
          : this.principals(link, database, rest[0] ?? '', system);
      default:
        return [];
    }
  }

  /**
   * Lists the server's databases; its four system databases only when asked for.
   * @param system Whether to list the system databases.
   * @returns Returns a promise resolving the nodes.
   */
  private async databases(system: boolean): Promise<readonly DatabaseNode[]> {
    const link: SqlServerLink = await this.link(this.metaLinks, this.settings.database);
    const rows: readonly (readonly unknown[])[] = await link.rows(
      `select name, state_desc, compatibility_level, recovery_model_desc
       from sys.databases${system ? '' : ' where database_id > 4'} order by name`,
    );
    return rows.map((row: readonly unknown[]): DatabaseNode => ({
      path: encodePath('db', text(row[0])),
      label: text(row[0]),
      detail: text(row[1]) === 'ONLINE' ? undefined : text(row[1]).toLowerCase(),
      icon: 'database',
      leaf: false,
      database: text(row[0]),
      properties: [
        { name: 'State', value: text(row[1]) },
        { name: 'Compatibility Level', value: text(row[2]) },
        { name: 'Recovery Model', value: text(row[3]) },
      ],
    }));
  }

  /**
   * Lists a database's tables or views, as `schema.name`.
   * @param link The database's connection.
   * @param database The database.
   * @param folder Which.
   * @param system Whether to list Microsoft's own shipped objects.
   * @returns Returns a promise resolving the nodes.
   */
  private async relations(
    link: SqlServerLink,
    database: string,
    folder: 'tables' | 'views',
    system: boolean,
  ): Promise<readonly DatabaseNode[]> {
    const rows: readonly (readonly unknown[])[] = await link.rows(
      `select s.name, o.name from sys.${folder} o join sys.schemas s on s.schema_id = o.schema_id
       ${system ? '' : 'where o.is_ms_shipped = 0'} order by s.name, o.name`,
    );
    return rows.map((row: readonly unknown[]): DatabaseNode => ({
      path: encodePath('db', database, folder, text(row[0]), text(row[1])),
      label: `${text(row[0])}.${text(row[1])}`,
      icon: folder === 'tables' ? 'table' : 'view',
      leaf: false,
      database,
      actions: RELATION_ACTIONS,
      properties: [
        { name: 'Schema', value: text(row[0]) },
        { name: 'Name', value: text(row[1]) },
      ],
    }));
  }

  /**
   * Lists a table's or view's columns, its primary key's marked with a key.
   * @param link The database's connection.
   * @param database The database.
   * @param schema The object's schema.
   * @param name The object's name.
   * @returns Returns a promise resolving the nodes.
   */
  private async columns(
    link: SqlServerLink,
    database: string,
    schema: string,
    name: string,
  ): Promise<readonly DatabaseNode[]> {
    return (await this.columnRows(link, schema, name)).map((column: ColumnRow): DatabaseNode => ({
      path: encodePath('db', database, 'column', schema, name, column.name),
      label: column.name,
      detail: `${column.declared}${column.nullable ? '' : ', not null'}`,
      icon: column.primaryKey ? 'key' : 'column',
      leaf: true,
      database,
      properties: [
        { name: 'Type', value: column.declared },
        { name: 'Nullable', value: column.nullable ? 'Yes' : 'No' },
        { name: 'Identity', value: column.identity ? 'Yes' : 'No' },
        { name: 'Primary Key', value: column.primaryKey ? 'Yes' : 'No' },
      ],
    }));
  }

  /**
   * Reads an object's columns.
   * @param link The database's connection.
   * @param schema The object's schema.
   * @param name The object's name.
   * @returns Returns a promise resolving the columns, in order.
   */
  private async columnRows(
    link: SqlServerLink,
    schema: string,
    name: string,
  ): Promise<readonly ColumnRow[]> {
    const object: string = nstring(`${bracket(schema)}.${bracket(name)}`);
    const rows: readonly (readonly unknown[])[] = await link.rows(
      `select c.name, t.name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity,
         case when exists (
           select 1 from sys.indexes i join sys.index_columns ic
             on ic.object_id = i.object_id and ic.index_id = i.index_id
           where i.object_id = c.object_id and i.is_primary_key = 1 and ic.column_id = c.column_id
         ) then 1 else 0 end
       from sys.columns c join sys.types t on t.user_type_id = c.user_type_id
       where c.object_id = object_id(${object}) order by c.column_id`,
    );
    return rows.map((row: readonly unknown[]): ColumnRow => ({
      name: text(row[0]),
      declared: declaredType(text(row[1]), Number(row[2]), Number(row[3]), Number(row[4])),
      nullable: row[5] === true,
      identity: row[6] === true,
      primaryKey: Number(row[7]) === 1,
    }));
  }

  /**
   * Lists a database's stored procedures or functions, as `schema.name`.
   * @param link The database's connection.
   * @param database The database.
   * @param kind Which.
   * @param system Whether to list Microsoft's own shipped objects.
   * @returns Returns a promise resolving the nodes.
   */
  private async modules(
    link: SqlServerLink,
    database: string,
    kind: 'procedures' | 'functions',
    system: boolean,
  ): Promise<readonly DatabaseNode[]> {
    const types: string = kind === 'procedures' ? `'P', 'PC'` : `'FN', 'IF', 'TF', 'FS', 'FT'`;
    const rows: readonly (readonly unknown[])[] = await link.rows(
      `select s.name, o.name, o.type_desc from sys.objects o
       join sys.schemas s on s.schema_id = o.schema_id
       where o.type in (${types})${system ? '' : ' and o.is_ms_shipped = 0'}
       order by s.name, o.name`,
    );
    return rows.map((row: readonly unknown[]): DatabaseNode => ({
      path: encodePath('db', database, 'module', text(row[0]), text(row[1])),
      label: `${text(row[0])}.${text(row[1])}`,
      icon: 'function',
      leaf: true,
      database,
      actions: MODULE_ACTIONS,
      properties: [{ name: 'Type', value: text(row[2]).toLowerCase().replaceAll('_', ' ') }],
    }));
  }

  /**
   * Lists a database's users, roles or schemas.
   * @param link The database's connection.
   * @param database The database.
   * @param kind Which.
   * @param system Whether to list the built-in ones.
   * @returns Returns a promise resolving the nodes.
   */
  private async principals(
    link: SqlServerLink,
    database: string,
    kind: string,
    system: boolean,
  ): Promise<readonly DatabaseNode[]> {
    const query: string | undefined = {
      users: `select name, type_desc from sys.database_principals
              where type in ('S', 'U', 'G', 'E', 'X', 'C', 'K')${system ? '' : ' and principal_id > 4'}
              order by name`,
      roles: `select name, type_desc from sys.database_principals
              where type = 'R'${system ? '' : " and is_fixed_role = 0 and name <> N'public'"}
              order by name`,
      // `dbo` is the schema user objects go in by default, so it is listed with the user schemas.
      schemas: `select name, '' from sys.schemas${
        system ? '' : ' where schema_id = 1 or schema_id between 5 and 16383'
      } order by name`,
    }[kind];
    if (query === undefined) {
      return [];
    }
    const rows: readonly (readonly unknown[])[] = await link.rows(query);
    return rows.map((row: readonly unknown[]): DatabaseNode => ({
      path: encodePath('db', database, 'principal', kind, text(row[0])),
      label: text(row[0]),
      detail: text(row[1]).toLowerCase().replaceAll('_', ' ') || undefined,
      icon: kind === 'schemas' ? 'schema' : 'key',
      leaf: true,
      database,
    }));
  }

  /**
   * Runs a script batch by batch, splitting it at its `GO` lines, stopping after the first batch that
   * fails unless asked to carry on. Within a batch, SQL Server itself decides whether an error stops
   * it. `PRINT` and `RAISERROR` arrive as messages, at the line they came from.
   * @param request The execution.
   * @returns Returns a promise resolving what it produced.
   */
  public async execute(request: ExecuteRequest): Promise<EngineExecution> {
    const database: string = request.database ?? this.settings.database;
    const manual: boolean = request.options?.manualTransaction === true;
    const maxRows: number = maxResultRows(request);
    const resultSets: GrowingResultSet[] = [];
    const messages: QueryMessage[] = [];
    let link: SqlServerLink;
    try {
      link = manual
        ? await this.transactionLink(database)
        : await this.link(this.queryLinks, database);
    } catch (error: unknown) {
      return {
        resultSets: [],
        messages: [{ severity: 'error', text: describeError(error) }],
        failed: true,
        cancelled: false,
      };
    }
    this.running.set(request.id, link);
    let failed: boolean = false;
    try {
      // A script's own `USE` would otherwise carry over to the next run on this connection.
      const switched: Error | null = await link.batch(`use ${bracket(database)}`, {
        onMessage: (message: ServerMessage): void => {
          if (message.severity === 'error') {
            messages.push({ severity: 'error', text: message.text });
          }
        },
      });
      if (switched !== null || messages.length > 0) {
        if (messages.length === 0) {
          messages.push({ severity: 'error', text: describeError(switched) });
        }
        failed = true;
      }
      const batches: readonly SqlServerBatch[] = failed
        ? []
        : splitBatches(request.text, request.firstLine);
      run: for (const batch of batches) {
        for (let pass: number = 0; pass < batch.repeat; pass += 1) {
          if (this.cancelled.has(request.id)) {
            break run;
          }
          const ok: boolean = await this.runBatch(
            link,
            batch,
            request,
            maxRows,
            resultSets,
            messages,
          );
          if (this.cancelled.has(request.id)) {
            messages.push({
              severity: 'warning',
              text: 'The query was cancelled.',
              line: batch.line,
            });
            break run;
          }
          if (!ok) {
            failed = true;
            if (request.options?.continueOnError !== true) {
              break run;
            }
          }
        }
      }
    } finally {
      this.running.delete(request.id);
    }
    const cancelled: boolean = this.cancelled.delete(request.id);
    return {
      resultSets: resultSets.map((set: GrowingResultSet): EngineResultSet => ({
        columns: set.columns,
        rows: set.rows,
        line: set.line,
      })),
      messages,
      failed: failed && !cancelled,
      cancelled,
      ...(manual ? { transactionOpen: await this.transactionStillOpen(database) } : {}),
    };
  }

  /**
   * Runs one batch, gathering its result sets and messages.
   * @param link The connection.
   * @param batch The batch.
   * @param request The execution it belongs to.
   * @param maxRows The most rows a result set keeps.
   * @param resultSets Where its result sets go.
   * @param messages Where its messages go.
   * @returns Returns a promise resolving whether it ran without an error.
   */
  private async runBatch(
    link: SqlServerLink,
    batch: SqlServerBatch,
    request: ExecuteRequest,
    maxRows: number,
    resultSets: GrowingResultSet[],
    messages: QueryMessage[],
  ): Promise<boolean> {
    let current: GrowingResultSet | null = null;
    let errored: boolean = false;
    const lineOf: (lineNumber: number) => number = (lineNumber: number): number =>
      lineNumber > 0 ? batch.line + lineNumber - 1 : batch.line;
    const error: Error | null = await link.batch(
      batch.text,
      {
        onColumns: (columns: readonly LinkColumn[]): void => {
          const typeNames: readonly string[] = columns.map((column: LinkColumn): string =>
            sqlTypeName({ name: column.type.name, dataLength: column.dataLength }),
          );
          current = {
            columns: columns.map((column: LinkColumn, index: number): ResultColumn => ({
              name: column.colName,
              type: typeNames[index],
            })),
            typeNames,
            rows: [],
            line: batch.line,
            total: 0,
          };
          resultSets.push(current);
        },
        onRow: (cells: readonly LinkCell[]): void => {
          if (current === null) {
            return;
          }
          current.total += 1;
          if (current.rows.length < maxRows) {
            const set: GrowingResultSet = current;
            current.rows.push(
              cells.map((cell: LinkCell, index: number): DatabaseValue =>
                cellValue(cell.value, set.typeNames[index] ?? ''),
              ),
            );
          }
        },
        onDone: (rowCount: number | undefined): void => {
          if (current !== null) {
            messages.push(
              current.total > current.rows.length
                ? {
                    severity: 'warning',
                    text: `${current.total} rows returned; the first ${current.rows.length} are kept`,
                    line: batch.line,
                  }
                : {
                    severity: 'info',
                    text: `${current.total} row${current.total === 1 ? '' : 's'} returned`,
                    line: batch.line,
                  },
            );
            current = null;
          } else if (rowCount !== undefined) {
            messages.push({
              severity: 'info',
              text: `(${rowCount} row${rowCount === 1 ? '' : 's'} affected)`,
              line: batch.line,
            });
          }
        },
        onMessage: (message: ServerMessage): void => {
          messages.push({
            severity: message.severity,
            text: message.text,
            line: lineOf(message.lineNumber),
          });
          errored ||= message.severity === 'error';
        },
      },
      request.options?.timeoutMs,
    );
    if (error !== null && !errored && !this.cancelled.has(request.id)) {
      messages.push({ severity: 'error', text: describeError(error), line: batch.line });
      errored = true;
    }
    return !errored;
  }

  /**
   * Gets a database's manual-transaction connection, beginning a transaction on a fresh one when
   * there is none.
   * @param database The database.
   * @returns Returns a promise resolving the connection.
   */
  private async transactionLink(database: string): Promise<SqlServerLink> {
    const open: SqlServerLink | undefined = this.transactions.get(database);
    if (open !== undefined && !open.ended) {
      return open;
    }
    const link: SqlServerLink = await this.openLink(this.settings, database);
    try {
      await link.rows('begin transaction');
    } catch (error: unknown) {
      link.close();
      throw error;
    }
    this.transactions.set(database, link);
    return link;
  }

  /**
   * Asks whether a database's manual transaction is still open — a script may have ended it with its
   * own `COMMIT` or `ROLLBACK` — and forgets its connection when it is not.
   * @param database The database.
   * @returns Returns a promise resolving whether one is open.
   */
  private async transactionStillOpen(database: string): Promise<boolean> {
    const link: SqlServerLink | undefined = this.transactions.get(database);
    if (link === undefined) {
      return false;
    }
    try {
      const rows: readonly (readonly unknown[])[] = await link.rows('select @@trancount');
      if (Number(rows[0]?.[0] ?? 0) > 0) {
        return true;
      }
    } catch {
      // A connection that cannot answer has no transaction worth keeping.
    }
    this.endTransaction(database);
    return false;
  }

  /**
   * Forgets a database's manual transaction and closes its connection, which rolls back anything
   * still open on it.
   * @param database The database.
   */
  private endTransaction(database: string): void {
    const link: SqlServerLink | undefined = this.transactions.get(database);
    this.transactions.delete(database);
    link?.close();
  }

  /**
   * Commits or rolls back a database's manual transaction.
   * @param action What to do with it.
   * @param database The database, or the connection's own.
   * @returns Returns a promise resolving what it came to.
   */
  public async transaction(
    action: TransactionAction,
    database?: string,
  ): Promise<TransactionOutcome> {
    const target: string = database ?? this.settings.database;
    const link: SqlServerLink | undefined = this.transactions.get(target);
    if (link === undefined) {
      return { failed: false, message: 'No transaction is open.' };
    }
    try {
      await link.rows(`if @@trancount > 0 ${action} transaction`);
      return {
        failed: false,
        message: action === 'commit' ? 'Transaction committed.' : 'Transaction rolled back.',
      };
    } catch (error: unknown) {
      return { failed: true, message: describeError(error) };
    } finally {
      this.endTransaction(target);
    }
  }

  /**
   * Cancels a running execution on the server.
   * @param id The execution's identifier.
   */
  public cancel(id: string): void {
    const link: SqlServerLink | undefined = this.running.get(id);
    if (link !== undefined) {
      this.cancelled.add(id);
      link.cancel();
    }
  }

  /**
   * Builds the script a node action asks for.
   * @param path The node's path.
   * @param action The action.
   * @returns Returns a promise resolving the script.
   */
  public async action(path: string, action: string): Promise<NodeActionOutcome> {
    const [, database, kind, schema, name] = decodePath(path);
    if (database === undefined || schema === undefined || name === undefined) {
      return { kind: 'failure', message: 'Nothing to act on.' };
    }
    const qualified: string = `${bracket(schema)}.${bracket(name)}`;
    try {
      if (action === 'select-top' && (kind === 'tables' || kind === 'views')) {
        return {
          kind: 'script',
          reads: true,
          title: name,
          database,
          text: `SELECT TOP (1000) *\nFROM ${qualified};\n`,
        };
      }
      if (action !== 'script-create') {
        return { kind: 'failure', message: `Unknown action '${action}'.` };
      }
      const link: SqlServerLink = await this.link(this.metaLinks, database);
      if (kind === 'tables') {
        return {
          kind: 'script',
          title: `${name} (CREATE)`,
          database,
          text: createTable(qualified, schema, name, await this.columnRows(link, schema, name)),
        };
      }
      const rows: readonly (readonly unknown[])[] = await link.rows(
        `select definition from sys.sql_modules where object_id = object_id(${nstring(qualified)})`,
      );
      const definition: string = text(rows[0]?.[0] ?? '');
      return definition === ''
        ? { kind: 'failure', message: `${schema}.${name} has no definition to script.` }
        : {
            kind: 'script',
            title: `${name} (CREATE)`,
            database,
            text: `${definition.trim()}\nGO\n`,
          };
    } catch (error: unknown) {
      return { kind: 'failure', message: describeError(error) };
    }
  }

  /**
   * Lists names to complete with: a database's schemas, tables, views and functions; or one table's or
   * view's columns.
   * @param scope Which names.
   * @param database The database the query runs against, or the connection's own.
   * @returns Returns a promise resolving the names.
   */
  public async names(scope: NamesScope, database?: string): Promise<readonly CompletionName[]> {
    const link: SqlServerLink = await this.link(this.metaLinks, database ?? this.settings.database);
    if (scope.kind === 'members') {
      const parts: readonly string[] = splitQualifiedName(scope.of);
      const name: string = parts[parts.length - 1] ?? '';
      const schema: string = parts.length > 1 ? parts[parts.length - 2] : 'dbo';
      return (await this.columnRows(link, schema, name)).map(
        (column: ColumnRow): CompletionName => ({
          name: column.name,
          kind: 'column',
          detail: column.declared,
        }),
      );
    }
    const schemas: readonly (readonly unknown[])[] = await link.rows(
      "select name from sys.schemas where schema_id between 5 and 16383 or name = N'dbo' order by name",
    );
    const objects: readonly (readonly unknown[])[] = await link.rows(
      `select s.name, o.name, o.type from sys.objects o join sys.schemas s on s.schema_id = o.schema_id
       where o.type in ('U', 'V', 'FN', 'IF', 'TF') and o.is_ms_shipped = 0 order by o.name`,
    );
    return [
      ...schemas.map((row: readonly unknown[]): CompletionName => ({
        name: text(row[0]),
        kind: 'schema',
      })),
      ...objects.map((row: readonly unknown[]): CompletionName => ({
        name: text(row[1]),
        kind:
          text(row[2]).trim() === 'U' ? 'table' : text(row[2]).trim() === 'V' ? 'view' : 'function',
        detail: text(row[0]),
      })),
    ];
  }

  /**
   * Closes every connection; closing a manual transaction's rolls it back.
   */
  public async close(): Promise<void> {
    for (const database of [...this.transactions.keys()]) {
      this.endTransaction(database);
    }
    const pools: readonly Map<string, Promise<SqlServerLink>>[] = [this.metaLinks, this.queryLinks];
    for (const pool of pools) {
      const links: readonly Promise<SqlServerLink>[] = [...pool.values()];
      pool.clear();
      for (const opening of links) {
        const link: SqlServerLink | null = await opening.catch((): null => null);
        link?.close();
      }
    }
  }
}

/**
 * One column of a table or view, as the catalog describes it.
 */
interface ColumnRow {
  readonly name: string;
  readonly declared: string;
  readonly nullable: boolean;
  readonly identity: boolean;
  readonly primaryKey: boolean;
}

/**
 * Builds a folder node under a database.
 * @param database The database.
 * @param parent The parent folder's id.
 * @param id The folder's id.
 * @param label Its label.
 * @returns Returns the node.
 */
function folderNode(database: string, parent: string, id: string, label: string): DatabaseNode {
  return {
    path: encodePath('db', database, parent, id),
    label,
    icon: 'folder',
    leaf: false,
    database,
  };
}

/**
 * Scripts a table's `CREATE TABLE` from its columns and primary key. Only those: its indexes, defaults,
 * checks and foreign keys are not scripted, and the script says so rather than passing for complete.
 * @param qualified The table's bracketed, qualified name.
 * @param schema Its schema.
 * @param name Its name.
 * @param columns Its columns.
 * @returns Returns the script.
 */
export function createTable(
  qualified: string,
  schema: string,
  name: string,
  columns: readonly ColumnRow[],
): string {
  const keyed: readonly ColumnRow[] = columns.filter(
    (column: ColumnRow): boolean => column.primaryKey,
  );
  const lines: string[] = columns.map(
    (column: ColumnRow): string =>
      `    ${bracket(column.name)} ${column.declared}${column.identity ? ' IDENTITY' : ''} ${
        column.nullable ? 'NULL' : 'NOT NULL'
      }`,
  );
  if (keyed.length > 0) {
    lines.push(
      `    CONSTRAINT ${bracket(`PK_${name}`)} PRIMARY KEY (${keyed
        .map((column: ColumnRow): string => bracket(column.name))
        .join(', ')})`,
    );
  }
  return [
    `-- ${schema}.${name}: columns and primary key only; indexes, defaults, checks and foreign keys are not scripted.`,
    `CREATE TABLE ${qualified} (`,
    lines.join(',\n'),
    ');',
    'GO',
    '',
  ].join('\n');
}
