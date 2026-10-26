import pg from 'pg';
import {
  CompletionName,
  ConnectionValues,
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseNodeAction,
  DatabaseValue,
  ExecuteRequest,
  NamesScope,
  NodeActionOutcome,
  QueryMessage,
  ResultColumn,
} from '../../protocol/database/protocol';
import { countNewlines, splitStatements } from '../../protocol/database/statements';
import {
  bigintValue,
  bytesValue,
  DatabaseEngine,
  decodePath,
  describeError,
  encodePath,
  EngineExecution,
  EngineResultSet,
  EngineSession,
  MAX_RESULT_ROWS,
  quoteIdentifier,
  text,
} from '../../protocol/database/engine';

/**
 * The type oids whose text is kept as written rather than parsed into a JavaScript `Date`, which would
 * drop microseconds and rewrite the time zone: date, time, timetz, timestamp, timestamptz, interval.
 */
const TEMPORAL_OIDS: ReadonlySet<number> = new Set<number>([1082, 1083, 1266, 1114, 1184, 1186]);

/**
 * The type oid of `int8`, which `pg` hands back as a string so no digit is lost.
 */
const INT8_OID: number = 20;

/**
 * The type oid of `text[]`, whose parser reads an array's items as the server wrote them.
 */
const TEXT_ARRAY_OID: number = 1009;

/**
 * The element type of each array type whose items need the same care as a single value: `int8[]`,
 * and the date and time arrays, which are read as text so no microsecond or zone is lost.
 */
const ARRAY_ELEMENT_OIDS: ReadonlyMap<number, number> = new Map<number, number>([
  [1016, INT8_OID],
  [1182, 1082],
  [1183, 1083],
  [1270, 1266],
  [1115, 1114],
  [1185, 1184],
  [1187, 1186],
]);

/**
 * The parts of a server notice (`RAISE NOTICE`, a warning) the Messages tab shows.
 */
interface NoticeLike {
  readonly severity?: string;
  readonly message?: string;
}

/**
 * The actions a table offers.
 */
const TABLE_ACTIONS: readonly DatabaseNodeAction[] = [
  { id: 'select-top', label: 'Select Top 1000 Rows' },
  { id: 'script-create', label: 'Script as CREATE' },
  { id: 'script-select', label: 'Script as SELECT' },
];

/**
 * The actions a view offers.
 */
const VIEW_ACTIONS: readonly DatabaseNodeAction[] = [
  { id: 'select-top', label: 'Select Top 1000 Rows' },
  { id: 'script-create', label: 'Script as CREATE' },
];

/**
 * The folders under a schema, with the `pg_class.relkind` values (or `function`) each lists.
 */
const SCHEMA_FOLDERS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'tables', label: 'Tables' },
  { id: 'views', label: 'Views' },
  { id: 'functions', label: 'Functions' },
  { id: 'sequences', label: 'Sequences' },
];

/**
 * The connection settings shared by every client a session opens.
 */
interface PostgresSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly ssl: false | { readonly rejectUnauthorized: boolean };
  readonly database: string;
}

/**
 * PostgreSQL through `pg`, the pure-JavaScript client, so the engine needs no native build per
 * platform.
 */
export class PostgresEngine implements DatabaseEngine {
  /**
   * Gets what the engine says about itself.
   */
  public readonly info: DatabaseEngineInfo = {
    id: 'postgres',
    displayName: 'PostgreSQL',
    language: 'pgsql',
    queryExtension: 'sql',
    capabilities: ['cancel', 'multipleDatabases', 'script', 'completion'],
    connectionFields: [
      {
        id: 'host',
        label: 'Host',
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
        defaultValue: '5432',
        section: 'server',
        inline: true,
      },
      {
        id: 'user',
        label: 'User',
        kind: 'text',
        required: true,
        defaultValue: 'postgres',
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
        defaultValue: 'postgres',
        section: 'database',
      },
      {
        // Saved as `ssl`, PostgreSQL's own word; labelled for what it does.
        id: 'ssl',
        label: 'Encryption',
        kind: 'choice',
        defaultValue: 'disable',
        section: 'security',
        options: [
          { value: 'disable', label: 'Disabled' },
          { value: 'require', label: 'Required' },
          { value: 'no-verify', label: 'Required, without verifying the certificate' },
        ],
      },
    ],
  };

  /**
   * Opens a connection to the named database.
   * @param values The connection's field values.
   * @returns Returns a promise resolving the session.
   */
  public async connect(values: ConnectionValues): Promise<EngineSession> {
    const settings: PostgresSettings = {
      host: (values['host'] ?? 'localhost').trim() || 'localhost',
      port: Number(values['port'] ?? '5432') || 5432,
      user: (values['user'] ?? '').trim(),
      password: values['password'] ?? '',
      database: (values['database'] ?? 'postgres').trim() || 'postgres',
      ssl:
        values['ssl'] === 'require'
          ? { rejectUnauthorized: true }
          : values['ssl'] === 'no-verify'
            ? { rejectUnauthorized: false }
            : false,
    };
    const session: PostgresSession = new PostgresSession(settings);
    await session.open();
    return session;
  }
}

/**
 * One connection to a PostgreSQL server. A PostgreSQL connection is bound to one database, so the
 * session opens a client per database the user reaches into — lazily, on first expand or query.
 */
class PostgresSession implements EngineSession {
  /**
   * Gets the server's version, read on open.
   */
  public serverVersion: string = 'PostgreSQL';

  /**
   * Holds the open clients, keyed by database.
   */
  private readonly clients: Map<string, Promise<pg.Client>> = new Map<string, Promise<pg.Client>>();

  /**
   * Holds the client each running execution is using, so a cancel can find its backend.
   */
  private readonly running: Map<string, { client: pg.Client; database: string }> = new Map<
    string,
    { client: pg.Client; database: string }
  >();

  /**
   * Holds the executions a cancel has been asked for.
   */
  private readonly cancelled: Set<string> = new Set<string>();

  /**
   * Holds the type names by oid, read once per session for the grid's column types.
   */
  private typeNames: Map<number, string> | null = null;

  /**
   * Creates the session.
   * @param settings The connection settings.
   */
  public constructor(private readonly settings: PostgresSettings) {}

  /**
   * Opens the client for the connection's own database and reads the server version.
   */
  public async open(): Promise<void> {
    try {
      const client: pg.Client = await this.client(this.settings.database);
      const result: pg.QueryArrayResult = await client.query({
        text: 'show server_version',
        rowMode: 'array',
      });
      this.serverVersion = `PostgreSQL ${text(result.rows[0]?.[0])}`;
    } catch (error: unknown) {
      // A session that fails to open is never handed out, so nothing else would close its client.
      await this.close().catch((): void => undefined);
      throw error;
    }
  }

  /**
   * Gets the client for a database, opening it on first use.
   * @param database The database.
   * @returns Returns a promise resolving the client.
   */
  private client(database: string): Promise<pg.Client> {
    const existing: Promise<pg.Client> | undefined = this.clients.get(database);
    if (existing !== undefined) {
      return existing;
    }
    const opening: Promise<pg.Client> = this.newClient(database).catch((error: unknown): never => {
      this.clients.delete(database);
      throw error;
    });
    this.clients.set(database, opening);
    return opening;
  }

  /**
   * Opens a fresh client to a database.
   * @param database The database.
   * @returns Returns a promise resolving the connected client.
   */
  private async newClient(database: string): Promise<pg.Client> {
    const client: pg.Client = new pg.Client({
      host: this.settings.host,
      port: this.settings.port,
      user: this.settings.user,
      password: this.settings.password,
      database,
      ssl: this.settings.ssl === false ? false : { ...this.settings.ssl },
      connectionTimeoutMillis: 10_000,
      types: {
        getTypeParser: ((oid: number, format?: string): unknown =>
          TEMPORAL_OIDS.has(oid)
            ? (raw: string): string => raw
            : TEMPORAL_OIDS.has(ARRAY_ELEMENT_OIDS.get(oid) ?? 0)
              ? pg.types.getTypeParser(TEXT_ARRAY_OID, 'text')
              : pg.types.getTypeParser(oid, format as 'text')) as never,
      },
    });
    client.on('error', (): void => {
      // A dropped connection is reported by the next query that uses it; the session forgets it so
      // that query opens a fresh one — but only if it is the one remembered, since a cancel's
      // short-lived client is opened the same way and its failure says nothing about the other.
      const remembered: Promise<pg.Client> | undefined = this.clients.get(database);
      void remembered?.then(
        (current: pg.Client): void => {
          if (current === client && this.clients.get(database) === remembered) {
            this.clients.delete(database);
          }
        },
        (): void => undefined,
      );
    });
    await client.connect();
    return client;
  }

  /**
   * Lists a node's children.
   * @param path The node's path, or null for the top of the tree.
   * @returns Returns a promise resolving the children.
   */
  public async expand(path: string | null): Promise<readonly DatabaseNode[]> {
    const segments: readonly string[] = path === null ? [] : decodePath(path);
    const [, database, , schema, kind, name, part] = segments;
    if (database === undefined) {
      return this.databases();
    }
    if (schema === undefined) {
      return this.schemas(database);
    }
    if (kind === undefined) {
      return this.schemaFolders(database, schema);
    }
    if (name === undefined) {
      return this.objects(database, schema, kind);
    }
    if (part === undefined) {
      return [
        {
          path: encodePath('db', database, 'schema', schema, kind, name, 'columns'),
          label: 'Columns',
          icon: 'folder',
          leaf: false,
        },
        ...(kind === 'tables'
          ? [
              {
                path: encodePath('db', database, 'schema', schema, kind, name, 'indexes'),
                label: 'Indexes',
                icon: 'folder' as const,
                leaf: false,
              },
              {
                path: encodePath('db', database, 'schema', schema, kind, name, 'constraints'),
                label: 'Constraints',
                icon: 'folder' as const,
                leaf: false,
              },
            ]
          : []),
      ];
    }
    return this.parts(database, schema, name, part);
  }

  /**
   * Lists the databases on the server.
   * @returns Returns the database nodes.
   */
  private async databases(): Promise<readonly DatabaseNode[]> {
    const rows: readonly unknown[][] = await this.rows(
      this.settings.database,
      `select datname, pg_size_pretty(pg_database_size(datname)), pg_get_userbyid(datdba)
         from pg_database where not datistemplate and datallowconn order by datname`,
    );
    return rows.map((row: unknown[]): DatabaseNode => ({
      path: encodePath('db', text(row[0])),
      label: text(row[0]),
      detail: text(row[1]),
      icon: 'database',
      leaf: false,
      database: text(row[0]),
      properties: [
        { name: 'Database', value: text(row[0]) },
        { name: 'Size', value: text(row[1]) },
        { name: 'Owner', value: text(row[2]) },
      ],
    }));
  }

  /**
   * Lists a database's user schemas.
   * @param database The database.
   * @returns Returns the schema nodes.
   */
  private async schemas(database: string): Promise<readonly DatabaseNode[]> {
    const rows: readonly unknown[][] = await this.rows(
      database,
      `select nspname, pg_get_userbyid(nspowner) from pg_namespace
        where nspname not like 'pg\\_%' and nspname <> 'information_schema' order by nspname`,
    );
    return rows.map((row: unknown[]): DatabaseNode => ({
      path: encodePath('db', database, 'schema', text(row[0])),
      label: text(row[0]),
      icon: 'schema',
      leaf: false,
      database,
      properties: [
        { name: 'Schema', value: text(row[0]) },
        { name: 'Owner', value: text(row[1]) },
      ],
    }));
  }

  /**
   * Lists the object folders of a schema, with their counts.
   * @param database The database.
   * @param schema The schema.
   * @returns Returns the folder nodes.
   */
  private async schemaFolders(database: string, schema: string): Promise<readonly DatabaseNode[]> {
    const rows: readonly unknown[][] = await this.rows(
      database,
      `select
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('r', 'p')),
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('v', 'm')),
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1),
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind = 'S')`,
      [schema],
    );
    const counts: unknown[] = rows[0] ?? [];
    return SCHEMA_FOLDERS.map(
      (folder: { readonly id: string; readonly label: string }, index: number): DatabaseNode => ({
        path: encodePath('db', database, 'schema', schema, folder.id),
        label: folder.label,
        detail: text(counts[index] ?? 0),
        icon: 'folder',
        leaf: Number(counts[index] ?? 0) === 0,
        database,
      }),
    );
  }

  /**
   * Lists the objects in one folder of a schema.
   * @param database The database.
   * @param schema The schema.
   * @param kind The folder.
   * @returns Returns the object nodes.
   */
  private async objects(
    database: string,
    schema: string,
    kind: string,
  ): Promise<readonly DatabaseNode[]> {
    if (kind === 'functions') {
      const rows: readonly unknown[][] = await this.rows(
        database,
        `select p.proname, pg_get_function_identity_arguments(p.oid), p.oid::text,
                pg_get_function_result(p.oid), l.lanname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           join pg_language l on l.oid = p.prolang
          where n.nspname = $1 order by 1, 2`,
        [schema],
      );
      return rows.map((row: unknown[]): DatabaseNode => ({
        path: encodePath('db', database, 'schema', schema, kind, text(row[2])),
        label: `${text(row[0])}(${text(row[1])})`,
        detail: text(row[3] ?? ''),
        icon: 'function',
        leaf: true,
        database,
        actions: [{ id: 'script-create', label: 'Script as CREATE' }],
        properties: [
          { name: 'Function', value: text(row[0]) },
          { name: 'Arguments', value: text(row[1]) || '(none)' },
          { name: 'Returns', value: text(row[3] ?? '') },
          { name: 'Language', value: text(row[4]) },
        ],
      }));
    }
    const relkinds: string = kind === 'tables' ? `'r', 'p'` : kind === 'views' ? `'v', 'm'` : `'S'`;
    const rows: readonly unknown[][] = await this.rows(
      database,
      `select c.relname, c.reltuples::bigint, pg_size_pretty(pg_total_relation_size(c.oid)),
              pg_get_userbyid(c.relowner), c.relkind, coalesce(obj_description(c.oid, 'pg_class'), '')
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relkind in (${relkinds}) order by 1`,
      [schema],
    );
    return rows.map((row: unknown[]): DatabaseNode => {
      const name: string = text(row[0]);
      const estimate: number = Number(row[1]);
      return {
        path: encodePath('db', database, 'schema', schema, kind, name),
        label: name,
        icon: kind === 'tables' ? 'table' : kind === 'views' ? 'view' : 'sequence',
        leaf: kind === 'sequences',
        database,
        actions: kind === 'tables' ? TABLE_ACTIONS : kind === 'views' ? VIEW_ACTIONS : [],
        properties: [
          { name: 'Name', value: name },
          { name: 'Schema', value: schema },
          { name: 'Owner', value: text(row[3]) },
          ...(kind === 'sequences'
            ? []
            : [
                {
                  name: 'Rows (estimate)',
                  value: estimate < 0 ? 'Not yet analysed' : estimate.toLocaleString(),
                },
                { name: 'Size', value: text(row[2]) },
              ]),
          ...(text(row[5]) === '' ? [] : [{ name: 'Comment', value: text(row[5]) }]),
        ],
      };
    });
  }

  /**
   * Lists a table's columns, indexes or constraints.
   * @param database The database.
   * @param schema The schema.
   * @param name The table or view.
   * @param part Which list.
   * @returns Returns the nodes.
   */
  private async parts(
    database: string,
    schema: string,
    name: string,
    part: string,
  ): Promise<readonly DatabaseNode[]> {
    const relation: string = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
    const leaf: (label: string) => string = (label: string): string =>
      encodePath('db', database, 'schema', schema, 'part', name, part, label);
    if (part === 'columns') {
      const rows: readonly unknown[][] = await this.rows(
        database,
        `select a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                pg_get_expr(d.adbin, d.adrelid),
                exists (select 1 from pg_constraint k where k.conrelid = a.attrelid and k.contype = 'p' and a.attnum = any (k.conkey))
           from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`,
        [relation],
      );
      return rows.map((row: unknown[]): DatabaseNode => {
        const primary: boolean = row[4] === true;
        return {
          path: leaf(text(row[0])),
          label: text(row[0]),
          detail: `${text(row[1])}${primary ? ', PK' : ''}${row[2] === true ? ', not null' : ''}`,
          icon: primary ? 'key' : 'column',
          leaf: true,
          database,
          properties: [
            { name: 'Column', value: text(row[0]) },
            { name: 'Type', value: text(row[1]) },
            { name: 'Primary key', value: primary ? 'Yes' : 'No' },
            { name: 'Nullable', value: row[2] === true ? 'No' : 'Yes' },
            { name: 'Default', value: row[3] === null ? '(none)' : text(row[3]) },
          ],
        };
      });
    }
    if (part === 'indexes') {
      const rows: readonly unknown[][] = await this.rows(
        database,
        `select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = $2 order by 1`,
        [schema, name],
      );
      return rows.map((row: unknown[]): DatabaseNode => ({
        path: leaf(text(row[0])),
        label: text(row[0]),
        icon: 'index',
        leaf: true,
        database,
        properties: [
          { name: 'Index', value: text(row[0]) },
          { name: 'Definition', value: text(row[1]) },
        ],
      }));
    }
    const rows: readonly unknown[][] = await this.rows(
      database,
      `select conname, contype, pg_get_constraintdef(oid) from pg_constraint where conrelid = $1::regclass order by 1`,
      [relation],
    );
    return rows.map((row: unknown[]): DatabaseNode => ({
      path: leaf(text(row[0])),
      label: text(row[0]),
      detail: constraintKind(text(row[1])),
      icon: row[1] === 'p' || row[1] === 'f' ? 'key' : 'constraint',
      leaf: true,
      database,
      properties: [
        { name: 'Constraint', value: text(row[0]) },
        { name: 'Kind', value: constraintKind(text(row[1])) },
        { name: 'Definition', value: text(row[2]) },
      ],
    }));
  }

  /**
   * Runs a script statement by statement against a database, stopping at the first error.
   * @param request The execution.
   * @returns Returns a promise resolving what it produced.
   */
  public async execute(request: ExecuteRequest): Promise<EngineExecution> {
    const database: string = request.database ?? this.settings.database;
    const resultSets: EngineResultSet[] = [];
    const messages: QueryMessage[] = [];
    let client: pg.Client;
    try {
      client = await this.client(database);
    } catch (error: unknown) {
      return {
        resultSets,
        messages: [{ severity: 'error', text: describeError(error) }],
        failed: true,
        cancelled: false,
      };
    }
    const onNotice: (notice: NoticeLike) => void = (notice: NoticeLike): void => {
      messages.push({
        severity: notice.severity === 'WARNING' ? 'warning' : 'info',
        text: `${notice.severity ?? 'NOTICE'}: ${notice.message ?? ''}`,
      });
    };
    client.on('notice', onNotice);
    this.running.set(request.id, { client, database });
    let failed: boolean = false;
    try {
      const names: Map<number, string> = await this.types(client);
      for (const statement of splitStatements(request.text, request.firstLine)) {
        if (this.cancelled.has(request.id)) {
          break;
        }
        try {
          const result: pg.QueryArrayResult = await client.query({
            text: statement.text,
            rowMode: 'array',
          });
          if (result.fields.length > 0) {
            const rows: (readonly DatabaseValue[])[] = result.rows
              .slice(0, MAX_RESULT_ROWS)
              .map((row: unknown[]): readonly DatabaseValue[] =>
                row.map((value: unknown, index: number): DatabaseValue =>
                  toValue(value, result.fields[index]?.dataTypeID ?? 0),
                ),
              );
            resultSets.push({
              columns: result.fields.map((field: pg.FieldDef): ResultColumn => ({
                name: field.name,
                type: names.get(field.dataTypeID),
              })),
              rows,
              line: statement.line,
            });
            messages.push({
              severity: result.rows.length > rows.length ? 'warning' : 'info',
              text:
                result.rows.length > rows.length
                  ? `${result.rows.length} rows returned; the first ${rows.length} are kept`
                  : `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} returned`,
              line: statement.line,
            });
          } else {
            messages.push({
              severity: 'info',
              text: `${result.command ?? 'OK'}${result.rowCount === null ? '' : ` ${result.rowCount}`}`,
              line: statement.line,
            });
          }
        } catch (error: unknown) {
          const position: number = Number((error as { position?: string }).position ?? 0);
          const line: number =
            position > 0
              ? statement.line + countNewlines(statement.text.slice(0, position - 1))
              : statement.line;
          // The server answers a cancel by failing the statement; that is the cancel landing, not an
          // error in the query, so it reads as SQLite's does.
          messages.push(
            this.cancelled.has(request.id)
              ? { severity: 'warning', text: 'The query was cancelled.', line: statement.line }
              : { severity: 'error', text: describeError(error), line },
          );
          failed = true;
          break;
        }
      }
    } finally {
      client.removeListener('notice', onNotice);
      this.running.delete(request.id);
    }
    const cancelled: boolean = this.cancelled.delete(request.id);
    return { resultSets, messages, failed: failed && !cancelled, cancelled };
  }

  /**
   * Cancels a running execution by asking the server to cancel its backend, over a short-lived
   * connection of its own — the way `psql` handles Ctrl+C.
   * @param id The execution's identifier.
   */
  public cancel(id: string): void {
    const running: { client: pg.Client; database: string } | undefined = this.running.get(id);
    if (running === undefined) {
      return;
    }
    this.cancelled.add(id);
    const pid: unknown = (running.client as unknown as { processID?: number }).processID;
    void this.newClient(running.database)
      .then(async (canceller: pg.Client): Promise<void> => {
        try {
          await canceller.query('select pg_cancel_backend($1)', [pid]);
        } finally {
          await canceller.end();
        }
      })
      .catch((): void => {
        // The execution finishes on its own; there is nothing more a failed cancel can do.
      });
  }

  /**
   * Builds the script an object's action asks for.
   * @param path The node's path.
   * @param action The action.
   * @returns Returns a promise resolving the script.
   */
  public async action(path: string, action: string): Promise<NodeActionOutcome> {
    const [, database, , schema, kind, name] = decodePath(path);
    if (database === undefined || schema === undefined || name === undefined) {
      return { kind: 'failure', message: 'Nothing to act on.' };
    }
    const relation: string = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
    try {
      if (kind === 'functions') {
        const rows: readonly unknown[][] = await this.rows(
          database,
          'select pg_get_functiondef($1::oid)',
          [name],
        );
        return {
          kind: 'script',
          title: 'Function (CREATE)',
          text: `${text(rows[0]?.[0] ?? '')};\n`,
          database,
        };
      }
      switch (action) {
        case 'select-top':
          return {
            kind: 'script',
            title: name,
            text: `SELECT *\nFROM ${relation}\nLIMIT 1000;\n`,
            database,
            reads: true,
          };
        case 'script-select': {
          const columns: readonly unknown[][] = await this.rows(
            database,
            `select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`,
            [relation],
          );
          const list: string = columns
            .map((row: unknown[]): string => `  ${quoteIdentifier(text(row[0]))}`)
            .join(',\n');
          return {
            kind: 'script',
            title: `${name} (SELECT)`,
            text: `SELECT\n${list}\nFROM ${relation};\n`,
            database,
          };
        }
        case 'script-create':
          return {
            kind: 'script',
            title: `${name} (CREATE)`,
            text:
              kind === 'views'
                ? await this.viewDdl(database, relation)
                : await this.tableDdl(database, relation),
            database,
          };
        default:
          return { kind: 'failure', message: `Unknown action '${action}'.` };
      }
    } catch (error: unknown) {
      return { kind: 'failure', message: describeError(error) };
    }
  }

  /**
   * Reconstructs a table's `CREATE TABLE` from the catalogue: its columns, defaults and constraints.
   * Close enough to read and to adapt, which is what Script As is for; `pg_dump` is the tool for an
   * exact copy.
   * @param database The database.
   * @param relation The quoted, schema-qualified table.
   * @returns Returns a promise resolving the DDL.
   */
  private async tableDdl(database: string, relation: string): Promise<string> {
    const columns: readonly unknown[][] = await this.rows(
      database,
      `select a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
         from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`,
      [relation],
    );
    const constraints: readonly unknown[][] = await this.rows(
      database,
      `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = $1::regclass order by contype desc, conname`,
      [relation],
    );
    const lines: string[] = [
      ...columns.map(
        (row: unknown[]): string =>
          `  ${quoteIdentifier(text(row[0]))} ${text(row[1])}${row[2] === true ? ' NOT NULL' : ''}${
            row[3] === null ? '' : ` DEFAULT ${text(row[3])}`
          }`,
      ),
      ...constraints.map(
        (row: unknown[]): string => `  CONSTRAINT ${quoteIdentifier(text(row[0]))} ${text(row[1])}`,
      ),
    ];
    return `CREATE TABLE ${relation} (\n${lines.join(',\n')}\n);\n`;
  }

  /**
   * Reads a view's definition as a `CREATE OR REPLACE VIEW`.
   * @param database The database.
   * @param relation The quoted, schema-qualified view.
   * @returns Returns a promise resolving the DDL.
   */
  private async viewDdl(database: string, relation: string): Promise<string> {
    const rows: readonly unknown[][] = await this.rows(
      database,
      'select pg_get_viewdef($1::regclass, true)',
      [relation],
    );
    return `CREATE OR REPLACE VIEW ${relation} AS\n${text(rows[0]?.[0] ?? '').trimEnd()}\n`;
  }

  /**
   * Closes every client the session opened.
   */
  public async close(): Promise<void> {
    const clients: Promise<pg.Client>[] = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(
      clients.map(async (opening: Promise<pg.Client>): Promise<void> => (await opening).end()),
    );
  }

  /**
   * Lists names to complete with, in the database the query runs against: its schemas, the tables,
   * views and functions a query reaches unqualified (those on the search path), or the columns of the
   * table or view it names. The name is resolved by the server, search path and quoting included.
   * @param scope Which names.
   * @param database The database, or the connection's own.
   * @returns Returns a promise resolving the names.
   */
  public async names(scope: NamesScope, database?: string): Promise<readonly CompletionName[]> {
    const target: string = database ?? this.settings.database;
    if (scope.kind === 'members') {
      const columns: readonly unknown[][] = await this.rows(
        target,
        `select a.attname, format_type(a.atttypid, a.atttypmod)
           from pg_attribute a
          where a.attrelid = to_regclass($1) and a.attnum > 0 and not a.attisdropped
          order by a.attnum`,
        [scope.of],
      ).catch((): readonly unknown[][] => []);
      return columns.map((row: unknown[]): CompletionName => ({
        name: text(row[0]),
        kind: 'column',
        detail: text(row[1]),
      }));
    }
    // One after another: a client runs one query at a time, and pg no longer queues them for us.
    const schemas: readonly unknown[][] = await this.rows(
      target,
      `select nspname from pg_namespace
          where nspname not in ('information_schema', 'pg_toast') and nspname not like 'pg_temp_%'
            and nspname not like 'pg_toast_temp_%'
          order by nspname`,
    );
    const relations: readonly unknown[][] = await this.rows(
      target,
      `select c.relname, c.relkind, n.nspname
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname = any (current_schemas(false))
          order by c.relname`,
    );
    const functions: readonly unknown[][] = await this.rows(
      target,
      `select distinct p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = any (current_schemas(true)) and p.prokind in ('f', 'a', 'w')
          order by p.proname`,
    );
    return [
      ...schemas.map((row: unknown[]): CompletionName => ({ name: text(row[0]), kind: 'schema' })),
      ...relations.map((row: unknown[]): CompletionName => ({
        name: text(row[0]),
        kind: text(row[1]) === 'v' || text(row[1]) === 'm' ? 'view' : 'table',
        detail: text(row[2]),
      })),
      ...functions.map((row: unknown[]): CompletionName => ({
        name: text(row[0]),
        kind: 'function',
      })),
    ];
  }

  /**
   * Runs a metadata query and returns its rows as arrays.
   * @param database The database to run it in.
   * @param sql The query.
   * @param parameters Its parameters.
   * @returns Returns a promise resolving the rows.
   */
  private async rows(
    database: string,
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly unknown[][]> {
    const client: pg.Client = await this.client(database);
    const result: pg.QueryArrayResult = await client.query({
      text: sql,
      values: [...parameters],
      rowMode: 'array',
    });
    return result.rows;
  }

  /**
   * Reads the type names by oid, once, for the grid's column headers.
   * @param client The client to read them through.
   * @returns Returns a promise resolving the names.
   */
  private async types(client: pg.Client): Promise<Map<number, string>> {
    if (this.typeNames === null) {
      const result: pg.QueryArrayResult = await client.query({
        text: 'select oid::int, typname from pg_type',
        rowMode: 'array',
      });
      this.typeNames = new Map<number, string>(
        result.rows.map((row: unknown[]): [number, string] => [Number(row[0]), text(row[1])]),
      );
    }
    return this.typeNames;
  }
}

/**
 * Names a `pg_constraint.contype`.
 * @param code The one-letter code.
 * @returns Returns the name.
 */
export function constraintKind(code: string): string {
  switch (code) {
    case 'p':
      return 'primary key';
    case 'f':
      return 'foreign key';
    case 'u':
      return 'unique';
    case 'c':
      return 'check';
    case 'x':
      return 'exclusion';
    default:
      return code;
  }
}

/**
 * Converts a value `pg` returned into a typed cell.
 * @param value The parsed value.
 * @param oid The column's type oid.
 * @returns Returns the typed cell.
 */
export function toValue(value: unknown, oid: number): DatabaseValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (TEMPORAL_OIDS.has(oid) && typeof value === 'string') {
    return { type: 'temporal', value };
  }
  if (oid === INT8_OID && typeof value === 'string') {
    return bigintValue(BigInt(value));
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return bigintValue(value);
  }
  if (value instanceof Uint8Array) {
    return bytesValue(value);
  }
  if (value instanceof Date) {
    return { type: 'temporal', value: value.toISOString() };
  }
  if (Array.isArray(value)) {
    // A multidimensional array nests arrays of the same type; the innermost items take its element's.
    const element: number = ARRAY_ELEMENT_OIDS.get(oid) ?? 0;
    return {
      type: 'list',
      items: value.map((item: unknown): DatabaseValue =>
        toValue(item, Array.isArray(item) ? oid : element),
      ),
    };
  }
  return { type: 'json', value };
}
