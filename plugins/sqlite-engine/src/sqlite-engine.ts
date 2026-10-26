import { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite';
import {
  ConnectionValues,
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseValue,
  ExecuteRequest,
  NodeActionOutcome,
} from './protocol';
import { SqliteRunner } from './sqlite-runner';
import { toValue } from './sqlite-run';
import {
  DatabaseEngine,
  decodePath,
  describeError,
  encodePath,
  EngineExecution,
  EngineSession,
  quoteIdentifier,
  text,
} from './engine';

/**
 * The folders a SQLite database's objects are filed under, keyed by their `sqlite_schema` type.
 */
const OBJECT_FOLDERS: readonly { readonly type: string; readonly label: string }[] = [
  { type: 'table', label: 'Tables' },
  { type: 'view', label: 'Views' },
  { type: 'index', label: 'Indexes' },
  { type: 'trigger', label: 'Triggers' },
];

/**
 * The actions a table or view offers.
 */
const RELATION_ACTIONS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'select-top', label: 'Select Top 1000 Rows' },
  { id: 'script-create', label: 'Script as CREATE' },
  { id: 'script-insert', label: 'Script as INSERT' },
];

/**
 * SQLite, through the runtime's own `node:sqlite` — no dependency at all, and no server: a connection
 * is a file.
 *
 * `node:sqlite` is synchronous, so queries run in a runner process of their own (see
 * {@link SqliteRunner}), over a second connection to the same file. The plugin itself keeps the
 * first connection for the tree and Script As, so both stay responsive while a query runs, and a query
 * can be cancelled by stopping its runner.
 */
export class SqliteEngine implements DatabaseEngine {
  /**
   * Initializes a new instance of the {@link SqliteEngine} class.
   * @param runnerScript The script the runners start from — this plugin's own bundle, which serves
   * as a runner when started with the runner argument.
   */
  public constructor(private readonly runnerScript: string) {}

  /**
   * Gets what the engine says about itself.
   */
  public readonly info: DatabaseEngineInfo = {
    id: 'sqlite',
    displayName: 'SQLite',
    language: 'sql',
    queryExtension: 'sql',
    capabilities: ['cancel', 'script'],
    connectionFields: [
      {
        id: 'file',
        label: 'Database file',
        kind: 'file',
        required: true,
        placeholder: '/path/to/database.db',
      },
      { id: 'readOnly', label: 'Open read-only', kind: 'boolean', defaultValue: 'false' },
    ],
  };

  /**
   * Opens a database file.
   * @param values The connection's field values.
   * @returns Returns a promise resolving the session.
   */
  public connect(values: ConnectionValues): Promise<EngineSession> {
    const file: string = (values['file'] ?? '').trim();
    if (file === '') {
      return Promise.reject(new Error('Choose a database file.'));
    }
    const readOnly: boolean = values['readOnly'] === 'true';
    try {
      const database: DatabaseSync = new DatabaseSync(file, { readOnly });
      // A query in the runner may hold a write lock for a while; the tree waits a little for it
      // rather than failing at once.
      database.exec('pragma busy_timeout = 3000');
      return Promise.resolve(
        new SqliteSession(database, new SqliteRunner(this.runnerScript, file, readOnly)),
      );
    } catch (error: unknown) {
      return Promise.reject(new Error(describeError(error)));
    }
  }
}

/**
 * One open SQLite database.
 */
class SqliteSession implements EngineSession {
  /**
   * Gets the SQLite library version.
   */
  public readonly serverVersion: string;

  /**
   * Opens the session over an open database.
   * @param database The connection the tree and the scripts are read through, in the plugin.
   * @param runner The process queries run in, over a connection of its own.
   */
  public constructor(
    private readonly database: DatabaseSync,
    private readonly runner: SqliteRunner,
  ) {
    const row: Record<string, SQLOutputValue> | undefined = database
      .prepare('select sqlite_version() as version')
      .get();
    this.serverVersion = `SQLite ${text(row?.['version'] ?? '')}`;
  }

  /**
   * Lists a node's children: the schemas (main, temp and any attached), their object folders, the
   * objects in each, and a table's columns, indexes and foreign keys.
   * @param path The node's path, or null for the top of the tree.
   * @returns Returns a promise resolving the children.
   */
  public expand(path: string | null): Promise<readonly DatabaseNode[]> {
    try {
      return Promise.resolve(this.children(path === null ? [] : decodePath(path)));
    } catch (error: unknown) {
      return Promise.reject(new Error(describeError(error)));
    }
  }

  /**
   * Builds a node's children from the segments of its path.
   * @param segments The decoded path.
   * @returns Returns the children.
   */
  private children(segments: readonly string[]): readonly DatabaseNode[] {
    const [schema, folder, name, part] = segments;
    if (schema === undefined) {
      return this.all('pragma database_list').map(
        (row: readonly DatabaseValue[]): DatabaseNode => ({
          path: encodePath(text(row[1])),
          label: text(row[1]),
          detail: text(row[1]) === 'main' ? undefined : text(row[2] ?? ''),
          icon: 'database',
          leaf: false,
          properties: [
            { name: 'Schema', value: text(row[1]) },
            { name: 'File', value: text(row[2] ?? '') || '(in memory)' },
          ],
        }),
      );
    }
    if (folder === undefined) {
      return OBJECT_FOLDERS.map(
        (entry: { readonly type: string; readonly label: string }): DatabaseNode => {
          const count: number = Number(
            this.all(
              `select count(*) from ${quoteIdentifier(schema)}.sqlite_schema where type = ? and name not like 'sqlite_%'`,
              entry.type,
            )[0]?.[0] ?? 0,
          );
          return {
            path: encodePath(schema, entry.type),
            label: entry.label,
            detail: text(count),
            icon: 'folder',
            leaf: count === 0,
          };
        },
      );
    }
    if (name === undefined) {
      return this.objects(schema, folder);
    }
    if (part === undefined) {
      return this.tableParts(schema, name);
    }
    return this.partChildren(schema, name, part);
  }

  /**
   * Lists the objects of one kind in a schema.
   * @param schema The schema.
   * @param type The `sqlite_schema` type.
   * @returns Returns the object nodes.
   */
  private objects(schema: string, type: string): readonly DatabaseNode[] {
    return this.all(
      `select name, tbl_name from ${quoteIdentifier(schema)}.sqlite_schema where type = ? and name not like 'sqlite_%' order by name`,
      type,
    ).map((row: readonly DatabaseValue[]): DatabaseNode => {
      const name: string = text(row[0]);
      const relation: boolean = type === 'table' || type === 'view';
      return {
        path: encodePath(schema, type, name),
        label: name,
        detail: relation ? undefined : text(row[1]),
        icon:
          type === 'table'
            ? 'table'
            : type === 'view'
              ? 'view'
              : type === 'index'
                ? 'index'
                : 'trigger',
        leaf: !relation,
        actions: relation ? RELATION_ACTIONS : [{ id: 'script-create', label: 'Script as CREATE' }],
        properties: [
          { name: 'Name', value: name },
          { name: 'Type', value: type },
          { name: 'Schema', value: schema },
          ...(relation ? [] : [{ name: 'Table', value: text(row[1]) }]),
        ],
      };
    });
  }

  /**
   * Lists the folders under a table or view: its columns, and a table's indexes and foreign keys.
   * @param schema The schema.
   * @param name The table or view.
   * @returns Returns the folder nodes.
   */
  private tableParts(schema: string, name: string): readonly DatabaseNode[] {
    const type: string = text(
      this.all(
        `select type from ${quoteIdentifier(schema)}.sqlite_schema where name = ?`,
        name,
      )[0]?.[0] ?? 'table',
    );
    const parts: DatabaseNode[] = [
      {
        path: encodePath(schema, type, name, 'columns'),
        label: 'Columns',
        icon: 'folder',
        leaf: false,
      },
    ];
    if (type === 'table') {
      parts.push(
        {
          path: encodePath(schema, type, name, 'indexes'),
          label: 'Indexes',
          icon: 'folder',
          leaf: false,
        },
        {
          path: encodePath(schema, type, name, 'keys'),
          label: 'Foreign Keys',
          icon: 'folder',
          leaf: false,
        },
      );
    }
    return parts;
  }

  /**
   * Lists a table's columns, indexes or foreign keys.
   * @param schema The schema.
   * @param name The table.
   * @param part Which list.
   * @returns Returns the nodes.
   */
  private partChildren(schema: string, name: string, part: string): readonly DatabaseNode[] {
    const leafPath: (label: string) => string = (label: string): string =>
      encodePath(schema, 'part', name, part, label);
    if (part === 'columns') {
      return this.all(`pragma ${quoteIdentifier(schema)}.table_info(${quoteIdentifier(name)})`).map(
        (row: readonly DatabaseValue[]): DatabaseNode => {
          const column: string = text(row[1]);
          const type: string = text(row[2] ?? '') || 'ANY';
          const primary: boolean = Number(row[5]) > 0;
          const notNull: boolean = Number(row[3]) === 1;
          return {
            path: leafPath(column),
            label: column,
            detail: `${type}${primary ? ', PK' : ''}${notNull ? ', not null' : ''}`,
            icon: primary ? 'key' : 'column',
            leaf: true,
            properties: [
              { name: 'Column', value: column },
              { name: 'Type', value: type },
              { name: 'Primary key', value: primary ? 'Yes' : 'No' },
              { name: 'Nullable', value: notNull ? 'No' : 'Yes' },
              { name: 'Default', value: row[4] === null ? '(none)' : text(row[4]) },
            ],
          };
        },
      );
    }
    if (part === 'indexes') {
      return this.all(`pragma ${quoteIdentifier(schema)}.index_list(${quoteIdentifier(name)})`).map(
        (row: readonly DatabaseValue[]): DatabaseNode => ({
          path: leafPath(text(row[1])),
          label: text(row[1]),
          detail: Number(row[2]) === 1 ? 'unique' : undefined,
          icon: 'index',
          leaf: true,
        }),
      );
    }
    return this.all(
      `pragma ${quoteIdentifier(schema)}.foreign_key_list(${quoteIdentifier(name)})`,
    ).map((row: readonly DatabaseValue[]): DatabaseNode => ({
      path: leafPath(`${text(row[0])}-${text(row[1])}`),
      label: `${text(row[3])} → ${text(row[2])}.${text(row[4] ?? '')}`,
      icon: 'key',
      leaf: true,
    }));
  }

  /**
   * Runs a script in the session's runner, statement by statement, stopping at the first error.
   * The plugin stays free meanwhile, so the tree can still be browsed and the run can be
   * cancelled.
   * @param request The execution.
   * @returns Returns a promise resolving what it produced.
   */
  public execute(request: ExecuteRequest): Promise<EngineExecution> {
    return this.runner.run(request);
  }

  /**
   * Cancels a running execution by killing the runner it is in. SQLite cannot interrupt a
   * statement from outside it, so this is the one way to stop one; the next run starts a fresh
   * runner, which means a temporary table made on the old one is gone.
   * @param id The execution's id.
   */
  public cancel(id: string): void {
    this.runner.cancel(id);
  }

  /**
   * Builds the script a table, view, index or trigger action asks for.
   * @param path The node's path.
   * @param action The action.
   * @returns Returns a promise resolving the script.
   */
  public action(path: string, action: string): Promise<NodeActionOutcome> {
    const [schema, , name] = decodePath(path);
    if (schema === undefined || name === undefined) {
      return Promise.resolve({ kind: 'failure', message: 'Nothing to act on.' });
    }
    const qualified: string = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
    try {
      switch (action) {
        case 'select-top':
          return Promise.resolve({
            kind: 'script',
            reads: true,
            title: name,
            text: `SELECT *\nFROM ${schema === 'main' ? quoteIdentifier(name) : qualified}\nLIMIT 1000;\n`,
          });
        case 'script-create': {
          const sql: DatabaseValue =
            this.all(
              `select sql from ${quoteIdentifier(schema)}.sqlite_schema where name = ?`,
              name,
            )[0]?.[0] ?? null;
          return Promise.resolve({
            kind: 'script',
            title: `${name} (CREATE)`,
            text: `${text(sql ?? '')};\n`,
          });
        }
        case 'script-insert': {
          const columns: readonly string[] = this.all(
            `pragma ${quoteIdentifier(schema)}.table_info(${quoteIdentifier(name)})`,
          ).map((row: readonly DatabaseValue[]): string => quoteIdentifier(text(row[1])));
          return Promise.resolve({
            kind: 'script',
            title: `${name} (INSERT)`,
            text: `INSERT INTO ${quoteIdentifier(name)} (${columns.join(', ')})\nVALUES (${columns.map((): string => '?').join(', ')});\n`,
          });
        }
        default:
          return Promise.resolve({ kind: 'failure', message: `Unknown action '${action}'.` });
      }
    } catch (error: unknown) {
      return Promise.resolve({ kind: 'failure', message: describeError(error) });
    }
  }

  /**
   * Closes the database.
   */
  public close(): Promise<void> {
    this.runner.close();
    this.database.close();
    return Promise.resolve();
  }

  /**
   * Runs a metadata query and returns its rows as arrays of typed cells.
   * @param sql The query.
   * @param parameters Its parameters.
   * @returns Returns the rows.
   */
  private all(sql: string, ...parameters: string[]): readonly (readonly DatabaseValue[])[] {
    const prepared: StatementSync = this.database.prepare(sql);
    prepared.setReturnArrays(true);
    return (prepared.all(...parameters) as unknown as readonly (readonly SQLOutputValue[])[]).map(
      (row: readonly SQLOutputValue[]): readonly DatabaseValue[] => row.map(toValue),
    );
  }
}
