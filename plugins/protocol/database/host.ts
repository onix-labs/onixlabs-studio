// Serves a database engine over the database-engine protocol on the plugin's standard streams (#1095).
//
// Studio spawns the plugin once and keeps it running. Each line on stdin is one request; each answer
// goes back as one line on stdout carrying the request's `id`. Requests are answered as they finish, not
// in order, so a long query does not hold up an expand or a cancel.
//
// The host owns what is not the engine's business: the sessions, by id; which session each running
// execution belongs to, so a cancel finds it; and the rows of large results, kept here and paged out by
// `fetch` so a hundred thousand rows never travel in one line.
import { randomUUID } from 'node:crypto';
import { createInterface, Interface } from 'node:readline';
import {
  DATABASE_ENGINE_PROTOCOL,
  DatabaseEngineResponse,
  DatabaseValue,
  ExecuteOutcome,
  ExecuteRequest,
  FetchRequest,
  NamesRequest,
  NamesScope,
  ResultSet,
} from './protocol';
import {
  DatabaseEngine,
  describeError,
  EngineExecution,
  EngineResultSet,
  EngineSession,
} from './engine';

/**
 * How many rows of a result set travel with the execution's answer; the rest are fetched as Studio's
 * grid asks for them.
 */
const FIRST_PAGE_ROWS: number = 1_000;

/**
 * How many result sets' rows are kept for fetching. Older ones are dropped: a result two dozen runs
 * ago is not one anybody is still scrolling.
 */
const KEPT_RESULT_SETS: number = 24;

/**
 * Writes a note to stderr, which Studio records in its log.
 * @param message The note.
 */
export function note(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Reads a record's field as text.
 * @param record The record.
 * @param key The field.
 * @returns Returns the text, or empty.
 */
function field(record: Record<string, unknown>, key: string): string {
  const value: unknown = record[key];
  return typeof value === 'string' ? value : '';
}

/**
 * The rows of a large result, kept for paging, and the session they belong to.
 */
interface KeptResult {
  readonly session: string;
  readonly rows: readonly (readonly DatabaseValue[])[];
}

/**
 * Serves an engine until Studio closes the plugin's stdin.
 * @param engine The engine.
 */
export function serve(engine: DatabaseEngine): void {
  const sessions: Map<string, EngineSession> = new Map<string, EngineSession>();
  const executions: Map<string, EngineSession> = new Map<string, EngineSession>();
  // Each kept result remembers the session it came from, so only that session can page it and it goes
  // when that session does.
  const results: Map<string, KeptResult> = new Map<string, KeptResult>();

  const keep: (owner: string, result: EngineResultSet) => ResultSet = (
    owner: string,
    result: EngineResultSet,
  ): ResultSet => {
    const id: string = randomUUID();
    if (result.rows.length > FIRST_PAGE_ROWS) {
      results.set(id, { session: owner, rows: result.rows });
      while (results.size > KEPT_RESULT_SETS) {
        const oldest: string | undefined = results.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        results.delete(oldest);
      }
    }
    return {
      id,
      columns: result.columns,
      rows: result.rows.slice(0, FIRST_PAGE_ROWS),
      totalRows: result.rows.length,
      line: result.line,
    };
  };

  const session: (params: Record<string, unknown>) => EngineSession = (
    params: Record<string, unknown>,
  ): EngineSession => {
    const found: EngineSession | undefined = sessions.get(field(params, 'session'));
    if (found === undefined) {
      throw new Error('The connection is closed. Connect again.');
    }
    return found;
  };

  const answer: (op: string, params: Record<string, unknown>) => Promise<unknown> = async (
    op: string,
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    switch (op) {
      case 'initialize':
        return { protocol: DATABASE_ENGINE_PROTOCOL, engine: engine.info };
      case 'connect': {
        try {
          const opened: EngineSession = await engine.connect(
            (params['values'] ?? {}) as Record<string, string>,
          );
          const id: string = randomUUID();
          sessions.set(id, opened);
          return { kind: 'connected', session: id, serverVersion: opened.serverVersion };
        } catch (error: unknown) {
          return { kind: 'failure', message: describeError(error) };
        }
      }
      case 'disconnect': {
        const id: string = field(params, 'session');
        const closing: EngineSession | undefined = sessions.get(id);
        sessions.delete(id);
        for (const [key, kept] of results) {
          if (kept.session === id) {
            results.delete(key);
          }
        }
        await closing?.close().catch((): void => undefined);
        return true;
      }
      case 'expand':
        try {
          return {
            kind: 'nodes',
            nodes: await session(params).expand(
              typeof params['path'] === 'string' ? params['path'] : null,
            ),
          };
        } catch (error: unknown) {
          return { kind: 'failure', message: describeError(error) };
        }
      case 'execute': {
        const request: ExecuteRequest = params as unknown as ExecuteRequest;
        const started: number = performance.now();
        let execution: EngineExecution;
        try {
          const running: EngineSession = session(params);
          executions.set(request.id, running);
          execution = await running.execute(request);
        } catch (error: unknown) {
          execution = {
            resultSets: [],
            messages: [{ severity: 'error', text: describeError(error) }],
            failed: true,
            cancelled: false,
          };
        } finally {
          executions.delete(request.id);
        }
        const outcome: ExecuteOutcome = {
          id: request.id,
          resultSets: execution.resultSets.map((result: EngineResultSet): ResultSet =>
            keep(request.session, result),
          ),
          messages: execution.messages,
          elapsedMs: performance.now() - started,
          failed: execution.failed,
          cancelled: execution.cancelled,
        };
        return outcome;
      }
      case 'fetch': {
        const request: FetchRequest = params as unknown as FetchRequest;
        const kept: KeptResult | undefined = results.get(request.resultSet);
        return (kept?.session === request.session ? kept.rows : []).slice(
          request.offset,
          request.offset + request.count,
        );
      }
      case 'cancel': {
        const id: string = field(params, 'id');
        executions.get(id)?.cancel(id);
        return true;
      }
      case 'action':
        try {
          return await session(params).action(field(params, 'path'), field(params, 'action'));
        } catch (error: unknown) {
          return { kind: 'failure', message: describeError(error) };
        }
      case 'names': {
        const request: NamesRequest = params as unknown as NamesRequest;
        const scope: NamesScope =
          request.scope?.kind === 'members' && typeof request.scope.of === 'string'
            ? { kind: 'members', of: request.scope.of }
            : { kind: 'objects' };
        // A completion that cannot be had is no completion, never an error in the query.
        try {
          return (
            (await session(params).names?.(
              scope,
              typeof request.database === 'string' ? request.database : undefined,
            )) ?? []
          );
        } catch {
          return [];
        }
      }
      default:
        throw new Error(`Unknown operation '${op}'.`);
    }
  };

  const write: (message: DatabaseEngineResponse) => void = (
    message: DatabaseEngineResponse,
  ): void => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };

  const handle: (line: string) => Promise<void> = async (line: string): Promise<void> => {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      note('Ignored a line that is not JSON');
      return;
    }
    const record: Record<string, unknown> =
      typeof request === 'object' && request !== null ? (request as Record<string, unknown>) : {};
    const id: unknown = record['id'];
    const op: unknown = record['op'];
    if (typeof id !== 'number' || typeof op !== 'string') {
      note('Ignored a request with no id or operation');
      return;
    }
    const params: Record<string, unknown> =
      typeof record['params'] === 'object' && record['params'] !== null
        ? (record['params'] as Record<string, unknown>)
        : {};
    try {
      write({ id, ok: true, result: (await answer(op, params)) as never });
    } catch (error: unknown) {
      write({ id, ok: false, error: describeError(error) });
    }
  };

  const lines: Interface = createInterface({ input: process.stdin });
  lines.on('line', (line: string): void => {
    if (line.trim().length > 0) {
      void handle(line);
    }
  });
  // Studio closing stdin is how it says the plugin is no longer wanted.
  lines.on('close', (): void => {
    void Promise.allSettled([...sessions.values()].map((open: EngineSession) => open.close())).then(
      (): never => process.exit(0),
    );
  });
}
