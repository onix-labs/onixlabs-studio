import { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite';
import {
  DatabaseValue,
  QueryMessage,
  ResultColumn,
  ResultColumnKey,
} from '../../protocol/database/protocol';
import {
  bigintValue,
  bytesValue,
  describeError,
  EngineExecution,
  EngineResultSet,
  MAX_RESULT_ROWS,
  text,
} from '../../protocol/database/engine';
import { ScriptStatement, splitStatements } from '../../protocol/database/statements';

/**
 * Runs a script against a database statement by statement, stopping at the first error: each
 * row-returning statement becomes a result set, every other one a row count, and an error a message
 * on the line its statement starts on. Synchronous, as `node:sqlite` is — callers run it outside the
 * process that must stay responsive.
 * @param database The open database.
 * @param script The text to run.
 * @param firstLine The document line the text starts on.
 * @returns Returns what the script produced.
 */
export function runScript(
  database: DatabaseSync,
  script: string,
  firstLine: number,
): EngineExecution {
  const resultSets: EngineResultSet[] = [];
  const messages: QueryMessage[] = [];
  let failed: boolean = false;
  for (const statement of splitStatements(script, firstLine)) {
    try {
      runStatement(database, statement, resultSets, messages);
    } catch (error: unknown) {
      messages.push({ severity: 'error', text: describeError(error), line: statement.line });
      failed = true;
      break;
    }
  }
  return { resultSets, messages, failed, cancelled: false };
}

/**
 * Runs one statement, recording its rows or its row count.
 * @param database The open database.
 * @param statement The statement.
 * @param resultSets The result sets being built.
 * @param messages The messages being built.
 */
function runStatement(
  database: DatabaseSync,
  statement: ScriptStatement,
  resultSets: EngineResultSet[],
  messages: QueryMessage[],
): void {
  const prepared: StatementSync = database.prepare(statement.text);
  const columns: readonly SourceColumn[] = prepared.columns();
  if (columns.length === 0) {
    const result: { changes: number | bigint } = prepared.run();
    messages.push({
      severity: 'info',
      text: `${text(result.changes)} row${Number(result.changes) === 1 ? '' : 's'} affected`,
      line: statement.line,
    });
    return;
  }
  prepared.setReadBigInts(true);
  prepared.setReturnArrays(true);
  const rows: (readonly DatabaseValue[])[] = [];
  let total: number = 0;
  for (const row of prepared.iterate() as Iterable<unknown>) {
    total += 1;
    if (rows.length < MAX_RESULT_ROWS) {
      rows.push((row as readonly SQLOutputValue[]).map(toValue));
    }
  }
  const keys: TableKeys = new TableKeys(database);
  resultSets.push({
    columns: columns.map((column: SourceColumn): ResultColumn => {
      const own: readonly ResultColumnKey[] = keys.of(column);
      return {
        name: column.name,
        type: column.type ?? undefined,
        ...(own.length === 0 ? {} : { keys: own }),
      };
    }),
    rows,
    line: statement.line,
  });
  messages.push({
    severity: total > rows.length ? 'warning' : 'info',
    text:
      total > rows.length
        ? `${total} rows returned; the first ${rows.length} are kept`
        : `${total} row${total === 1 ? '' : 's'} returned`,
    line: statement.line,
  });
}

/**
 * One column of a prepared statement's result, with the table column it comes from when SQLite can
 * trace one (null for an expression).
 */
interface SourceColumn {
  readonly name: string;
  readonly type: string | null;
  readonly database: string | null;
  readonly table: string | null;
  readonly column: string | null;
}

/**
 * Reads the keys of the tables a result's columns come from — the primary key, unique constraints and
 * unique indexes, and foreign keys — once per table, so the grid can mark the key columns. Best
 * effort: a table whose keys cannot be read leaves its columns unmarked.
 */
class TableKeys {
  private readonly tables: Map<string, ReadonlyMap<string, readonly ResultColumnKey[]>> = new Map<
    string,
    ReadonlyMap<string, readonly ResultColumnKey[]>
  >();

  /**
   * Creates the reader.
   * @param database The open database.
   */
  public constructor(private readonly database: DatabaseSync) {}

  /**
   * Gets the keys a result column belongs to, the primary key first.
   * @param column The column.
   * @returns Returns its keys; none for a column SQLite cannot trace to a table.
   */
  public of(column: SourceColumn): readonly ResultColumnKey[] {
    if (column.table === null || column.column === null) {
      return [];
    }
    const schema: string = column.database ?? 'main';
    const at: string = `${schema}\u0000${column.table}`;
    let table: ReadonlyMap<string, readonly ResultColumnKey[]> | undefined = this.tables.get(at);
    if (table === undefined) {
      table = this.read(schema, column.table);
      this.tables.set(at, table);
    }
    return table.get(column.column.toLowerCase()) ?? [];
  }

  /**
   * Reads one table's keys.
   * @param schema The schema the table is in.
   * @param table The table.
   * @returns Returns each column's keys, by lower-cased column name.
   */
  private read(schema: string, table: string): ReadonlyMap<string, readonly ResultColumnKey[]> {
    const keys: Map<string, ResultColumnKey[]> = new Map<string, ResultColumnKey[]>();
    const add: (column: unknown, key: ResultColumnKey) => void = (
      column: unknown,
      key: ResultColumnKey,
    ): void => {
      const name: string = text(column).toLowerCase();
      keys.set(name, [...(keys.get(name) ?? []), key]);
    };
    try {
      for (const row of this.all('select name from pragma_table_info(?, ?) where pk > 0', [
        table,
        schema,
      ])) {
        add(row[0], { kind: 'primary', name: 'PRIMARY KEY' });
      }
      // The primary key's own index (origin `pk`) is the primary key already.
      for (const index of this.all(
        `select name, origin from pragma_index_list(?, ?) where "unique" = 1 and origin <> 'pk'`,
        [table, schema],
      )) {
        const columns: readonly unknown[] = this.all(
          'select name from pragma_index_info(?, ?) where name is not null order by seqno',
          [text(index[0]), schema],
        ).map((row: readonly unknown[]): unknown => row[0]);
        // A UNIQUE constraint has no name of its own, only its index's generated one; it reads by the
        // columns it covers instead.
        const name: string =
          text(index[1]) === 'u' ? `UNIQUE (${columns.map(text).join(', ')})` : text(index[0]);
        for (const column of columns) {
          add(column, { kind: 'unique', name });
        }
      }
      const references: Map<string, { table: string; from: string[]; to: string[] }> = new Map<
        string,
        { table: string; from: string[]; to: string[] }
      >();
      for (const row of this.all(
        'select id, "table", "from", "to" from pragma_foreign_key_list(?, ?) order by id, seq',
        [table, schema],
      )) {
        const reference: { table: string; from: string[]; to: string[] } = references.get(
          text(row[0]),
        ) ?? { table: text(row[1]), from: [], to: [] };
        reference.from.push(text(row[2]));
        // A reference to the other table's primary key names no columns.
        if (row[3] !== null) {
          reference.to.push(text(row[3]));
        }
        references.set(text(row[0]), reference);
      }
      for (const reference of references.values()) {
        const target: string =
          reference.to.length === 0
            ? reference.table
            : `${reference.table} (${reference.to.join(', ')})`;
        for (const column of reference.from) {
          add(column, { kind: 'foreign', name: `REFERENCES ${target}` });
        }
      }
    } catch {
      return new Map<string, readonly ResultColumnKey[]>();
    }
    return keys;
  }

  /**
   * Runs a pragma query.
   * @param sql The query.
   * @param parameters Its parameters.
   * @returns Returns its rows, as arrays.
   */
  private all(sql: string, parameters: readonly string[]): readonly (readonly unknown[])[] {
    const statement: StatementSync = this.database.prepare(sql);
    statement.setReturnArrays(true);
    return statement.all(...parameters) as unknown as readonly (readonly unknown[])[];
  }
}

/**
 * Converts a `node:sqlite` value into a typed cell.
 * @param value The value SQLite returned.
 * @returns Returns the typed cell.
 */
export function toValue(value: SQLOutputValue): DatabaseValue {
  if (typeof value === 'bigint') {
    return bigintValue(value);
  }
  if (value instanceof Uint8Array) {
    return bytesValue(value);
  }
  return value;
}
