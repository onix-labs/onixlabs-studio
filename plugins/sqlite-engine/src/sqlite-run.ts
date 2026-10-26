import { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite';
import { DatabaseValue, QueryMessage, ResultColumn } from './protocol';
import {
  bigintValue,
  bytesValue,
  describeError,
  EngineExecution,
  EngineResultSet,
  MAX_RESULT_ROWS,
  text,
} from './engine';
import { ScriptStatement, splitStatements } from './statements';

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
  const columns: readonly { readonly name: string; readonly type: string | null }[] =
    prepared.columns();
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
  resultSets.push({
    columns: columns.map(
      (column: { readonly name: string; readonly type: string | null }): ResultColumn => ({
        name: column.name,
        type: column.type ?? undefined,
      }),
    ),
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
