import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
import {
  CompletionName,
  ConnectionValues,
  DATABASE_ENGINE_PROTOCOL,
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseValue,
  ExecuteOutcome,
  ExecuteRequest,
  NamesScope,
  NodeActionOutcome,
} from './protocol';
import { DatabaseEngine, EngineExecution, EngineSession } from './engine';

/**
 * The standard-input lines the host reads, stood in for by the `readline` interface it listens on, so a
 * test hands it requests and closes its input without touching the worker's real stdin.
 */
const input: { handlers: Map<string, (line?: string) => void> } = vi.hoisted(
  (): { handlers: Map<string, (line?: string) => void> } => ({
    handlers: new Map<string, (line?: string) => void>(),
  }),
);

vi.mock('node:readline', () => {
  const createInterface: () => {
    on(event: string, handler: (line?: string) => void): unknown;
  } = (): { on(event: string, handler: (line?: string) => void): unknown } => {
    const lines: { on(event: string, handler: (line?: string) => void): unknown } = {
      on: (event: string, handler: (line?: string) => void): unknown => {
        input.handlers.set(event, handler);
        return lines;
      },
    };
    return lines;
  };
  return { createInterface, default: { createInterface } };
});

const { serve } = await import('./host');

/**
 * A promise a test settles by hand, so it can hold an execution open.
 */
class Deferred<T> {
  public resolve: (value: T) => void = (): void => undefined;
  public reject: (error: unknown) => void = (): void => undefined;
  public readonly promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (error: unknown) => void): void => {
      this.resolve = resolve;
      this.reject = reject;
    },
  );
}

/**
 * A session recording what it is asked, whose answers a test sets.
 */
class FakeSession implements EngineSession {
  public readonly serverVersion: string = 'Fake 1.0';
  public readonly expanded: (string | null)[] = [];
  public readonly cancelled: string[] = [];
  public closed: number = 0;
  public names?: (scope: NamesScope, database?: string) => Promise<readonly CompletionName[]>;
  public expandAnswer: () => Promise<readonly DatabaseNode[]> = (): Promise<
    readonly DatabaseNode[]
  > => Promise.resolve([{ path: 'p', label: 'Tables', icon: 'folder', leaf: false }]);
  public executeAnswer: (request: ExecuteRequest) => Promise<EngineExecution> =
    (): Promise<EngineExecution> =>
      Promise.resolve({ resultSets: [], messages: [], failed: false, cancelled: false });

  public expand(path: string | null): Promise<readonly DatabaseNode[]> {
    this.expanded.push(path);
    return this.expandAnswer();
  }

  public execute(request: ExecuteRequest): Promise<EngineExecution> {
    return this.executeAnswer(request);
  }

  public cancel(id: string): void {
    this.cancelled.push(id);
  }

  public action(path: string, action: string): Promise<NodeActionOutcome> {
    if (action === 'explode') {
      return Promise.reject(new Error('No such table.'));
    }
    return Promise.resolve({ kind: 'script', title: path, text: `-- ${action}` });
  }

  public close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

/**
 * An engine handing out fake sessions, refusing a connection whose `file` is `bad`.
 */
class FakeEngine implements DatabaseEngine {
  public readonly sessions: FakeSession[] = [];
  public readonly info: DatabaseEngineInfo = {
    id: 'fake',
    displayName: 'Fake',
    language: 'sql',
    queryExtension: 'sql',
    capabilities: ['cancel'],
    connectionFields: [],
  };

  public connect(values: ConnectionValues): Promise<EngineSession> {
    if (values['file'] === 'bad') {
      return Promise.reject(new Error('Cannot open bad.'));
    }
    const session: FakeSession = new FakeSession();
    this.sessions.push(session);
    return Promise.resolve(session);
  }
}

/**
 * Builds rows numbered from zero, one column each.
 * @param count How many.
 * @returns Returns the rows.
 */
function rows(count: number): readonly (readonly DatabaseValue[])[] {
  return Array.from({ length: count }, (_: unknown, index: number): readonly DatabaseValue[] => [
    index,
  ]);
}

describe('serve', (): void => {
  let engine: FakeEngine;
  let written: Record<string, unknown>[];
  let notes: string[];
  let stdout: MockInstance;
  let stderr: MockInstance;
  let nextId: number;

  beforeEach((): void => {
    input.handlers.clear();
    written = [];
    notes = [];
    nextId = 1;
    stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        return true;
      });
    stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        notes.push(String(chunk));
        return true;
      });
    engine = new FakeEngine();
    serve(engine);
  });

  afterEach((): void => {
    stdout.mockRestore();
    stderr.mockRestore();
    vi.restoreAllMocks();
  });

  /**
   * Writes one line to the host's input.
   * @param line The line.
   */
  function line(line: string): void {
    input.handlers.get('line')?.(line);
  }

  /**
   * Sends a request without waiting for its answer.
   * @param op The operation.
   * @param params Its parameters.
   * @returns Returns the request's id.
   */
  function send(op: string, params: Record<string, unknown> = {}): number {
    const id: number = nextId;
    nextId += 1;
    line(JSON.stringify({ id, op, params }));
    return id;
  }

  /**
   * Waits for the answer to a request.
   * @param id The request's id.
   * @returns Returns the answer line.
   */
  async function answerTo(id: number): Promise<Record<string, unknown>> {
    return vi.waitFor((): Record<string, unknown> => {
      const found: Record<string, unknown> | undefined = written.find(
        (message: Record<string, unknown>): boolean => message['id'] === id,
      );
      if (found === undefined) {
        throw new Error(`no answer to ${id} yet`);
      }
      return found;
    });
  }

  /**
   * Sends a request and waits for its result, failing the test when it is answered with an error.
   * @param op The operation.
   * @param params Its parameters.
   * @returns Returns the result.
   */
  async function call<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    const answer: Record<string, unknown> = await answerTo(send(op, params));
    expect(answer['ok']).toBe(true);
    return answer['result'] as T;
  }

  /**
   * Opens a session.
   * @returns Returns the host's id for it.
   */
  async function connect(): Promise<string> {
    const result: { kind: string; session: string } = await call<{
      kind: string;
      session: string;
    }>('connect', { values: { file: 'good.db' } });
    return result.session;
  }

  it('initialize_answersTheProtocolAndTheEnginesInfo', async (): Promise<void> => {
    expect(await call('initialize', { protocol: '1.0' })).toEqual({
      protocol: DATABASE_ENGINE_PROTOCOL,
      engine: engine.info,
    });
  });

  it('connect_namesTheSessionByAnIdOfItsOwn_andReportsTheServer', async (): Promise<void> => {
    const result: Record<string, unknown> = await call<Record<string, unknown>>('connect', {
      values: { file: 'good.db' },
    });

    expect(result['kind']).toBe('connected');
    expect(result['serverVersion']).toBe('Fake 1.0');
    expect(typeof result['session']).toBe('string');
    expect((result['session'] as string).length).toBeGreaterThan(0);
  });

  it('connect_answersAFailureRatherThanAnError_whenTheEngineRefuses', async (): Promise<void> => {
    expect(await call('connect', { values: { file: 'bad' } })).toEqual({
      kind: 'failure',
      message: 'Cannot open bad.',
    });
  });

  it('expand_passesThePathToTheSession_andNullForTheTop', async (): Promise<void> => {
    const session: string = await connect();

    expect(await call('expand', { session, path: null })).toEqual({
      kind: 'nodes',
      nodes: [{ path: 'p', label: 'Tables', icon: 'folder', leaf: false }],
    });
    await call('expand', { session, path: '["main"]' });

    expect(engine.sessions[0].expanded).toEqual([null, '["main"]']);
  });

  it('expand_answersAFailure_forASessionThatIsNotOpen', async (): Promise<void> => {
    expect(await call('expand', { session: 'nope', path: null })).toEqual({
      kind: 'failure',
      message: 'The connection is closed. Connect again.',
    });
  });

  it('expand_answersAFailure_whenTheSessionRejects', async (): Promise<void> => {
    const session: string = await connect();
    engine.sessions[0].expandAnswer = (): Promise<readonly DatabaseNode[]> =>
      Promise.reject(new Error('locked'));

    expect(await call('expand', { session, path: null })).toEqual({
      kind: 'failure',
      message: 'locked',
    });
  });

  it('execute_sendsTheFirstThousandRowsWithTheAnswer_andPagesTheRestByFetch', async (): Promise<void> => {
    const session: string = await connect();
    engine.sessions[0].executeAnswer = (): Promise<EngineExecution> =>
      Promise.resolve({
        resultSets: [{ columns: [{ name: 'n' }], rows: rows(2_500), line: 3 }],
        messages: [{ severity: 'info', text: '2500 rows returned', line: 3 }],
        failed: false,
        cancelled: false,
      });

    const outcome: ExecuteOutcome = await call<ExecuteOutcome>('execute', {
      id: 'run-1',
      session,
      text: 'select n',
      firstLine: 3,
    });

    expect(outcome.id).toBe('run-1');
    expect(outcome.failed).toBe(false);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.messages).toEqual([{ severity: 'info', text: '2500 rows returned', line: 3 }]);
    expect(typeof outcome.elapsedMs).toBe('number');
    expect(outcome.resultSets).toHaveLength(1);
    expect(outcome.resultSets[0].rows).toEqual(rows(1_000));
    expect(outcome.resultSets[0].totalRows).toBe(2_500);
    expect(outcome.resultSets[0].line).toBe(3);
    expect(outcome.resultSets[0].columns).toEqual([{ name: 'n' }]);

    const page: readonly (readonly DatabaseValue[])[] = await call('fetch', {
      session,
      resultSet: outcome.resultSets[0].id,
      offset: 1_000,
      count: 500,
    });
    expect(page).toEqual(rows(1_500).slice(1_000));
    // Past the end is just fewer rows, not an error.
    expect(
      await call('fetch', {
        session,
        resultSet: outcome.resultSets[0].id,
        offset: 2_400,
        count: 500,
      }),
    ).toEqual(rows(2_500).slice(2_400));
  });

  it('execute_keepsNothingToFetch_forAResultThatFitsInTheFirstPage', async (): Promise<void> => {
    const session: string = await connect();
    engine.sessions[0].executeAnswer = (): Promise<EngineExecution> =>
      Promise.resolve({
        resultSets: [{ columns: [{ name: 'n' }], rows: rows(1_000), line: 1 }],
        messages: [],
        failed: false,
        cancelled: false,
      });

    const outcome: ExecuteOutcome = await call<ExecuteOutcome>('execute', {
      id: 'run-1',
      session,
      text: 'select n',
      firstLine: 1,
    });

    expect(outcome.resultSets[0].rows).toHaveLength(1_000);
    expect(outcome.resultSets[0].totalRows).toBe(1_000);
    expect(
      await call('fetch', { session, resultSet: outcome.resultSets[0].id, offset: 0, count: 10 }),
    ).toEqual([]);
    expect(await call('fetch', { session, resultSet: 'unknown', offset: 0, count: 10 })).toEqual(
      [],
    );
  });

  it('fetch_pagesAResultOnlyForTheSessionItCameFrom_andForgetsItWhenThatSessionCloses', async (): Promise<void> => {
    const session: string = await connect();
    const other: string = await connect();
    engine.sessions[0].executeAnswer = (): Promise<EngineExecution> =>
      Promise.resolve({
        resultSets: [{ columns: [{ name: 'n' }], rows: rows(2_500), line: 1 }],
        messages: [],
        failed: false,
        cancelled: false,
      });
    const outcome: ExecuteOutcome = await call<ExecuteOutcome>('execute', {
      id: 'run-1',
      session,
      text: 'select n',
      firstLine: 1,
    });
    const resultSet: string = outcome.resultSets[0].id;

    expect(await call('fetch', { session: other, resultSet, offset: 1_000, count: 1 })).toEqual([]);
    expect(await call('fetch', { session, resultSet, offset: 1_000, count: 1 })).toEqual([[1_000]]);

    await call('disconnect', { session });

    expect(await call('fetch', { session, resultSet, offset: 1_000, count: 1 })).toEqual([]);
  });

  it('execute_dropsTheOldestKeptResult_onceTwoDozenAreKept', async (): Promise<void> => {
    const session: string = await connect();
    engine.sessions[0].executeAnswer = (): Promise<EngineExecution> =>
      Promise.resolve({
        resultSets: [{ columns: [{ name: 'n' }], rows: rows(1_001), line: 1 }],
        messages: [],
        failed: false,
        cancelled: false,
      });
    const ids: string[] = [];
    for (let run: number = 0; run < 25; run += 1) {
      const outcome: ExecuteOutcome = await call<ExecuteOutcome>('execute', {
        id: `run-${run}`,
        session,
        text: 'select n',
        firstLine: 1,
      });
      ids.push(outcome.resultSets[0].id);
    }

    expect(await call('fetch', { session, resultSet: ids[0], offset: 1_000, count: 1 })).toEqual(
      [],
    );
    expect(await call('fetch', { session, resultSet: ids[1], offset: 1_000, count: 1 })).toEqual([
      [1_000],
    ]);
    expect(await call('fetch', { session, resultSet: ids[24], offset: 1_000, count: 1 })).toEqual([
      [1_000],
    ]);
  });

  it('execute_answersAFailedOutcome_forASessionThatIsNotOpen', async (): Promise<void> => {
    const outcome: ExecuteOutcome = await call<ExecuteOutcome>('execute', {
      id: 'run-1',
      session: 'nope',
      text: 'select 1',
      firstLine: 1,
    });

    expect(outcome).toMatchObject({
      id: 'run-1',
      resultSets: [],
      messages: [{ severity: 'error', text: 'The connection is closed. Connect again.' }],
      failed: true,
      cancelled: false,
    });
  });

  it('execute_answersAFailedOutcome_whenTheSessionRejects', async (): Promise<void> => {
    const session: string = await connect();
    engine.sessions[0].executeAnswer = (): Promise<EngineExecution> =>
      Promise.reject(new Error('disk I/O error'));

    expect(
      await call<ExecuteOutcome>('execute', { id: 'run-1', session, text: 'x', firstLine: 1 }),
    ).toMatchObject({
      messages: [{ severity: 'error', text: 'disk I/O error' }],
      failed: true,
    });
  });

  it('cancel_reachesTheSessionRunningTheExecution_whileItRuns', async (): Promise<void> => {
    const first: string = await connect();
    await connect();
    const running: Deferred<EngineExecution> = new Deferred<EngineExecution>();
    engine.sessions[0].executeAnswer = (): Promise<EngineExecution> => running.promise;

    const execution: number = send('execute', {
      id: 'run-1',
      session: first,
      text: 'select slow()',
      firstLine: 1,
    });
    // Answered while the execution is still running: requests are answered as they finish.
    expect(await call('cancel', { id: 'run-1' })).toBe(true);
    expect(engine.sessions[0].cancelled).toEqual(['run-1']);
    expect(engine.sessions[1].cancelled).toEqual([]);

    running.resolve({ resultSets: [], messages: [], failed: false, cancelled: true });
    expect(((await answerTo(execution))['result'] as ExecuteOutcome).cancelled).toBe(true);

    // Once it has finished there is nothing to cancel.
    expect(await call('cancel', { id: 'run-1' })).toBe(true);
    expect(engine.sessions[0].cancelled).toEqual(['run-1']);
  });

  it('cancel_ofAnUnknownExecution_isHarmless', async (): Promise<void> => {
    expect(await call('cancel', { id: 'never-ran' })).toBe(true);
  });

  it('disconnect_closesTheSession_afterWhichItIsNotOpen', async (): Promise<void> => {
    const session: string = await connect();

    expect(await call('disconnect', { session })).toBe(true);
    expect(engine.sessions[0].closed).toBe(1);
    expect(await call('expand', { session, path: null })).toMatchObject({ kind: 'failure' });
    // Disconnecting again, or something never open, is harmless.
    expect(await call('disconnect', { session })).toBe(true);
    expect(engine.sessions[0].closed).toBe(1);
  });

  it('action_passesThrough_andAnswersAFailureWhenItRejects', async (): Promise<void> => {
    const session: string = await connect();

    expect(await call('action', { session, path: 't', action: 'select-top' })).toEqual({
      kind: 'script',
      title: 't',
      text: '-- select-top',
    });
    expect(await call('action', { session, path: 't', action: 'explode' })).toEqual({
      kind: 'failure',
      message: 'No such table.',
    });
    expect(await call('action', { session: 'nope', path: 't', action: 'select-top' })).toEqual({
      kind: 'failure',
      message: 'The connection is closed. Connect again.',
    });
  });

  it('names_reachesTheSession_withTheScopeNormalised_andTheDatabase', async (): Promise<void> => {
    const session: string = await connect();
    const asked: { scope: NamesScope; database: string | undefined }[] = [];
    engine.sessions[0].names = (
      scope: NamesScope,
      database?: string,
    ): Promise<readonly CompletionName[]> => {
      asked.push({ scope, database });
      return Promise.resolve([{ name: 'orders', kind: 'table', detail: 'main' }]);
    };

    expect(
      await call('names', {
        session,
        database: 'shop',
        scope: { kind: 'members', of: 'orders', extra: true },
      }),
    ).toEqual([{ name: 'orders', kind: 'table', detail: 'main' }]);
    await call('names', { session, scope: { kind: 'members', of: 42 } });
    await call('names', { session, database: 7, scope: { kind: 'bogus' } });
    await call('names', { session });

    expect(asked).toEqual([
      { scope: { kind: 'members', of: 'orders' }, database: 'shop' },
      { scope: { kind: 'objects' }, database: undefined },
      { scope: { kind: 'objects' }, database: undefined },
      { scope: { kind: 'objects' }, database: undefined },
    ]);
  });

  it('names_answersNone_forASessionThatCannotName', async (): Promise<void> => {
    const session: string = await connect();

    expect(await call('names', { session, scope: { kind: 'objects' } })).toEqual([]);
  });

  it('names_answersNoneRatherThanAnError_whenTheSessionRejects', async (): Promise<void> => {
    const session: string = await connect();
    engine.sessions[0].names = (): Promise<readonly CompletionName[]> =>
      Promise.reject(new Error('Catalogue unreadable.'));

    expect(await call('names', { session, scope: { kind: 'objects' } })).toEqual([]);
  });

  it('answersAnUnknownOperationWithAnError', async (): Promise<void> => {
    expect(await answerTo(send('teleport'))).toEqual({
      id: 1,
      ok: false,
      error: "Unknown operation 'teleport'.",
    });
  });

  it('ignoresLinesThatAreNotRequests_noting_whyOnStderr', async (): Promise<void> => {
    line('not json');
    line(JSON.stringify({ op: 'initialize' }));
    line(JSON.stringify({ id: 'one', op: 'initialize' }));
    line('   ');

    expect(notes).toEqual([
      'Ignored a line that is not JSON\n',
      'Ignored a request with no id or operation\n',
      'Ignored a request with no id or operation\n',
    ]);
    // The host is still listening.
    expect(await call('cancel', { id: 'x' })).toBe(true);
    expect(written).toHaveLength(1);
  });

  it('treatsMissingParamsAsEmpty', async (): Promise<void> => {
    line(JSON.stringify({ id: 7, op: 'expand' }));

    expect(await answerTo(7)).toEqual({
      id: 7,
      ok: true,
      result: { kind: 'failure', message: 'The connection is closed. Connect again.' },
    });
  });

  it('closesEverySessionAndExits_whenStudioClosesItsInput', async (): Promise<void> => {
    await connect();
    await connect();
    const exit: MockInstance = vi
      .spyOn(process, 'exit')
      .mockImplementation((): never => undefined as never);

    input.handlers.get('close')?.();

    await vi.waitFor((): void => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    expect(engine.sessions.map((session: FakeSession): number => session.closed)).toEqual([1, 1]);
  });
});
