import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseChannel } from '@shared/api/database-channels';
import type {
  CompletionName,
  ConnectOutcome,
  DatabaseEngineInfo,
  ExecuteOutcome,
  ExpandOutcome,
  NodeActionOutcome,
} from '@shared/api/database-engine-protocol';
import type {
  ContributionContext,
  ContributionListener,
  InvokeHandler,
} from '../main-contribution';
import type { DatabaseEngineDescriptor } from './database-engine-descriptor';

/**
 * A user-data directory of the test's own, so the contributed plugins are the curated index's alone and
 * none of them is installed. Read when Electron is asked for it, after the imports have run.
 */
const userData: string = mkdtempSync(join(tmpdir(), 'database-contribution-'));

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: (): string => userData },
}));

const { DatabaseContribution } = await import('./database.contribution');
const { DatabaseEngineClient } = await import('./database-engine-client');

type Contribution = InstanceType<typeof DatabaseContribution>;

/**
 * A call the contribution made of an engine.
 */
interface Call {
  readonly op: string;
  readonly params: Record<string, unknown>;
}

/**
 * Stands in for an engine plugin's client: records each call and answers from `answers`, which a test
 * may hold open with a promise of its own.
 */
class FakeClient {
  public readonly calls: Call[] = [];
  public disposed: number = 0;
  public engineInfo: DatabaseEngineInfo | null = null;
  public answers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    connect: (): Promise<unknown> =>
      Promise.resolve({
        ok: true,
        result: { kind: 'connected', session: 'engine-session', serverVersion: 'Fake 1' },
      }),
    disconnect: (): Promise<unknown> => Promise.resolve({ ok: true, result: true }),
    expand: (): Promise<unknown> =>
      Promise.resolve({ ok: true, result: { kind: 'nodes', nodes: [] } }),
    execute: (params: Record<string, unknown>): Promise<unknown> =>
      Promise.resolve({
        ok: true,
        result: {
          id: params['id'],
          resultSets: [],
          messages: [],
          elapsedMs: 1,
          failed: false,
          cancelled: false,
        },
      }),
    fetch: (): Promise<unknown> => Promise.resolve({ ok: true, result: [[1]] }),
    cancel: (): Promise<unknown> => Promise.resolve({ ok: true, result: true }),
    action: (): Promise<unknown> =>
      Promise.resolve({ ok: true, result: { kind: 'script', title: 't', text: 'select 1' } }),
    names: (): Promise<unknown> =>
      Promise.resolve({ ok: true, result: [{ name: 'orders', kind: 'table' }] }),
  };

  public constructor(public readonly id: string) {}

  public call(op: string, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ op, params });
    return this.answers[op](params);
  }

  public info(): Promise<DatabaseEngineInfo | null> {
    return Promise.resolve(this.engineInfo);
  }

  public onExit(): () => void {
    return (): void => undefined;
  }

  public dispose(): void {
    this.disposed += 1;
  }

  /**
   * Gets the operations called, in order.
   * @returns Returns them.
   */
  public ops(): readonly string[] {
    return this.calls.map((call: Call): string => call.op);
  }
}

/**
 * A context capturing the handlers and listeners the contribution registers.
 */
class FakeContext {
  public readonly handlers: Map<string, InvokeHandler> = new Map<string, InvokeHandler>();
  public readonly listeners: Map<string, ContributionListener> = new Map<
    string,
    ContributionListener
  >();

  public readonly context: ContributionContext = {
    handle: (channel: string, handler: InvokeHandler): void => {
      this.handlers.set(channel, handler);
    },
    on: (channel: string, listener: ContributionListener): void => {
      this.listeners.set(channel, listener);
    },
    send: (): void => undefined,
    permission: <T>(): T => {
      throw new Error('no permissions declared');
    },
    mainWindow: (): null => null,
    log: { error: (): void => undefined, warn: (): void => undefined, info: (): void => undefined },
  };

  /**
   * Invokes a handler as the renderer would.
   * @param channel The channel.
   * @param args The arguments.
   * @returns Returns the handler's answer.
   */
  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const handler: InvokeHandler | undefined = this.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`nothing handles ${channel}`);
    }
    return Promise.resolve(handler({} as never, ...args)) as Promise<T>;
  }

  /**
   * Fires a fire-and-forget listener as the renderer would.
   * @param channel The channel.
   * @param args The arguments.
   */
  public fire(channel: string, ...args: unknown[]): void {
    this.listeners.get(channel)?.({} as never, ...args);
  }
}

/**
 * Gets the contribution's private client table, so a test can install engines without plugins.
 * @param contribution The contribution.
 * @returns Returns the table.
 */
function clientsOf(contribution: Contribution): Map<string, { client: unknown; command: string }> {
  return (contribution as unknown as { clients: Map<string, { client: unknown; command: string }> })
    .clients;
}

/**
 * Describes an engine with the given capabilities.
 * @param capabilities The capabilities.
 * @returns Returns the engine's description.
 */
function engineInfo(capabilities: DatabaseEngineInfo['capabilities']): DatabaseEngineInfo {
  return {
    id: 'sqlite',
    displayName: 'SQLite',
    language: 'sql',
    queryExtension: 'sql',
    capabilities,
    connectionFields: [],
  };
}

afterAll((): void => {
  rmSync(userData, { recursive: true, force: true });
});

describe('DatabaseContribution', () => {
  let contribution: Contribution;
  let fake: FakeContext;
  let sqlite: FakeClient;
  let other: FakeClient;

  beforeEach((): void => {
    contribution = new DatabaseContribution();
    fake = new FakeContext();
    contribution.activate(fake.context);
    sqlite = new FakeClient('sqlite');
    other = new FakeClient('other');
    clientsOf(contribution).set('sqlite', { client: sqlite, command: 'sqlite' });
    clientsOf(contribution).set('other', { client: other, command: 'other' });
  });

  /**
   * Connects with an engine.
   * @param engine The engine's id.
   * @returns Returns the host's session id.
   */
  async function connect(engine: string = 'sqlite'): Promise<string> {
    const outcome: ConnectOutcome = await fake.invoke<ConnectOutcome>(
      DatabaseChannel.Connect,
      engine,
      { file: 'x.db' },
    );
    if (outcome.kind !== 'connected') {
      throw new Error('did not connect');
    }
    return outcome.session;
  }

  it('activate_wiresEveryChannel', () => {
    expect([...fake.handlers.keys()].sort()).toEqual(
      [
        DatabaseChannel.Engines,
        DatabaseChannel.Connect,
        DatabaseChannel.Test,
        DatabaseChannel.Disconnect,
        DatabaseChannel.Expand,
        DatabaseChannel.Execute,
        DatabaseChannel.Fetch,
        DatabaseChannel.Action,
        DatabaseChannel.Names,
        DatabaseChannel.SecretsMachineSealing,
        DatabaseChannel.SecretsUnlock,
        DatabaseChannel.SecretsSeal,
        DatabaseChannel.SecretsOpen,
      ].sort(),
    );
    expect([...fake.listeners.keys()].sort()).toEqual(
      [DatabaseChannel.Cancel, DatabaseChannel.SecretsForget].sort(),
    );
  });

  it('connect_namesTheSessionByTheHostsOwnId_notTheEngines', async () => {
    const outcome: ConnectOutcome = await fake.invoke<ConnectOutcome>(
      DatabaseChannel.Connect,
      'sqlite',
      { file: 'x.db' },
    );

    expect(outcome).toMatchObject({ kind: 'connected', serverVersion: 'Fake 1' });
    expect(outcome.kind === 'connected' ? outcome.session : '').not.toBe('engine-session');
    expect(sqlite.calls).toEqual([{ op: 'connect', params: { values: { file: 'x.db' } } }]);
  });

  it('connect_answersAFailure_forAnEngineThatIsNotInstalled', async () => {
    expect(
      await fake.invoke<ConnectOutcome>(DatabaseChannel.Connect, 'nope', { file: 'x.db' }),
    ).toEqual({ kind: 'failure', message: "No database engine named 'nope' is installed." });
  });

  it('connect_passesOnTheEnginesRefusal_andWhyAPluginCouldNotBeReached', async () => {
    sqlite.answers['connect'] = (): Promise<unknown> =>
      Promise.resolve({ ok: true, result: { kind: 'failure', message: 'No such file.' } });
    expect(await fake.invoke(DatabaseChannel.Connect, 'sqlite', {})).toEqual({
      kind: 'failure',
      message: 'No such file.',
    });

    sqlite.answers['connect'] = (): Promise<unknown> =>
      Promise.resolve({ ok: false, error: 'The sqlite engine stopped.' });
    expect(await fake.invoke(DatabaseChannel.Connect, 'sqlite', {})).toEqual({
      kind: 'failure',
      message: 'The sqlite engine stopped.',
    });
  });

  it('forwardsEachRequestToTheEngineHoldingTheSession_underTheEnginesOwnId', async () => {
    const session: string = await connect();

    expect(await fake.invoke<ExpandOutcome>(DatabaseChannel.Expand, session, '["main"]')).toEqual({
      kind: 'nodes',
      nodes: [],
    });
    expect(
      await fake.invoke<ExecuteOutcome>(DatabaseChannel.Execute, {
        id: 'run-1',
        session,
        text: 'select 1',
        firstLine: 4,
      }),
    ).toMatchObject({ id: 'run-1', failed: false });
    expect(
      await fake.invoke(DatabaseChannel.Fetch, {
        session,
        resultSet: 'r1',
        offset: 1_000,
        count: 500,
      }),
    ).toEqual([[1]]);
    expect(
      await fake.invoke<NodeActionOutcome>(DatabaseChannel.Action, session, 'p', 'select-top'),
    ).toEqual({ kind: 'script', title: 't', text: 'select 1' });

    expect(sqlite.calls.slice(1)).toEqual([
      { op: 'expand', params: { session: 'engine-session', path: '["main"]' } },
      {
        op: 'execute',
        params: { id: 'run-1', session: 'engine-session', text: 'select 1', firstLine: 4 },
      },
      {
        op: 'fetch',
        params: { session: 'engine-session', resultSet: 'r1', offset: 1_000, count: 500 },
      },
      { op: 'action', params: { session: 'engine-session', path: 'p', action: 'select-top' } },
    ]);
    expect(other.calls).toEqual([]);
  });

  it('answersAClosedConnection_forASessionItDoesNotHold', async () => {
    expect(await fake.invoke(DatabaseChannel.Expand, 'engine-session', null)).toEqual({
      kind: 'failure',
      message: 'The connection is closed. Connect again.',
    });
    expect(
      await fake.invoke(DatabaseChannel.Execute, {
        id: 'run-1',
        session: 'engine-session',
        text: 'select 1',
        firstLine: 1,
      }),
    ).toEqual({
      id: 'run-1',
      resultSets: [],
      messages: [
        { severity: 'error', text: 'The connection is closed. Connect again and re-run.' },
      ],
      elapsedMs: 0,
      failed: true,
      cancelled: false,
    });
    expect(
      await fake.invoke(DatabaseChannel.Fetch, {
        session: 'engine-session',
        resultSet: 'r',
        offset: 0,
        count: 1,
      }),
    ).toEqual([]);
    expect(await fake.invoke(DatabaseChannel.Action, 'engine-session', 'p', 'x')).toEqual({
      kind: 'failure',
      message: 'The connection is closed. Connect again.',
    });
    // Guessing the engine's own id reaches nothing.
    expect(sqlite.calls).toEqual([]);
  });

  it('turnsAnUnreachablePluginIntoTheRequestsOwnFailure', async () => {
    const session: string = await connect();
    for (const op of ['expand', 'execute', 'fetch', 'action']) {
      sqlite.answers[op] = (): Promise<unknown> =>
        Promise.resolve({ ok: false, error: 'The sqlite engine stopped.' });
    }

    expect(await fake.invoke(DatabaseChannel.Expand, session, null)).toEqual({
      kind: 'failure',
      message: 'The sqlite engine stopped.',
    });
    expect(
      await fake.invoke<ExecuteOutcome>(DatabaseChannel.Execute, {
        id: 'run-1',
        session,
        text: 'x',
        firstLine: 1,
      }),
    ).toMatchObject({
      id: 'run-1',
      failed: true,
      messages: [{ severity: 'error', text: 'The sqlite engine stopped.' }],
    });
    expect(
      await fake.invoke(DatabaseChannel.Fetch, { session, resultSet: 'r', offset: 0, count: 1 }),
    ).toEqual([]);
    expect(await fake.invoke(DatabaseChannel.Action, session, 'p', 'x')).toEqual({
      kind: 'failure',
      message: 'The sqlite engine stopped.',
    });
  });

  it('cancel_reachesTheEngineRunningTheExecution_onlyWhileItRuns', async () => {
    const session: string = await connect();
    let finish: (value: unknown) => void = (): void => undefined;
    sqlite.answers['execute'] = (): Promise<unknown> =>
      new Promise((resolve: (value: unknown) => void): void => {
        finish = resolve;
      });

    const running: Promise<ExecuteOutcome> = fake.invoke<ExecuteOutcome>(DatabaseChannel.Execute, {
      id: 'run-1',
      session,
      text: 'select slow()',
      firstLine: 1,
    });
    await vi.waitFor((): void => {
      expect(sqlite.ops()).toContain('execute');
    });
    fake.fire(DatabaseChannel.Cancel, 'run-1');
    fake.fire(DatabaseChannel.Cancel, 'some-other-run');

    expect(sqlite.calls.at(-1)).toEqual({ op: 'cancel', params: { id: 'run-1' } });
    expect(other.calls).toEqual([]);

    finish({
      ok: true,
      result: {
        id: 'run-1',
        resultSets: [],
        messages: [],
        elapsedMs: 5,
        failed: false,
        cancelled: true,
      },
    });
    expect((await running).cancelled).toBe(true);

    fake.fire(DatabaseChannel.Cancel, 'run-1');
    expect(sqlite.ops().filter((op: string): boolean => op === 'cancel')).toHaveLength(1);
  });

  it('disconnect_closesTheEnginesSession_afterWhichTheHostsIdReachesNothing', async () => {
    const session: string = await connect();

    await fake.invoke(DatabaseChannel.Disconnect, session);

    expect(sqlite.calls.at(-1)).toEqual({
      op: 'disconnect',
      params: { session: 'engine-session' },
    });
    expect(await fake.invoke(DatabaseChannel.Expand, session, null)).toMatchObject({
      kind: 'failure',
    });
    // Disconnecting what is not open asks nothing of any engine.
    await fake.invoke(DatabaseChannel.Disconnect, session);
    expect(sqlite.ops().filter((op: string): boolean => op === 'disconnect')).toHaveLength(1);
  });

  it('names_asksTheEngineHoldingTheSession_underTheEnginesOwnId', async () => {
    sqlite.engineInfo = engineInfo(['cancel', 'completion']);
    const session: string = await connect();

    expect(
      await fake.invoke<readonly CompletionName[]>(DatabaseChannel.Names, {
        session,
        database: 'shop',
        scope: { kind: 'members', of: 'orders' },
      }),
    ).toEqual([{ name: 'orders', kind: 'table' }]);
    expect(sqlite.calls.at(-1)).toEqual({
      op: 'names',
      params: {
        session: 'engine-session',
        database: 'shop',
        scope: { kind: 'members', of: 'orders' },
      },
    });
    expect(other.calls).toEqual([]);
  });

  it('names_answersNone_forAnEngineThatDoesNotDeclareCompletion', async () => {
    sqlite.engineInfo = engineInfo(['cancel', 'script']);
    const session: string = await connect();

    expect(
      await fake.invoke(DatabaseChannel.Names, { session, scope: { kind: 'objects' } }),
    ).toEqual([]);
    sqlite.engineInfo = null;
    expect(
      await fake.invoke(DatabaseChannel.Names, { session, scope: { kind: 'objects' } }),
    ).toEqual([]);
    expect(sqlite.ops()).not.toContain('names');
  });

  it('names_answersNone_forASessionThatIsClosed_orAPluginThatCannotBeReached', async () => {
    sqlite.engineInfo = engineInfo(['completion']);
    const session: string = await connect();
    sqlite.answers['names'] = (): Promise<unknown> =>
      Promise.resolve({ ok: false, error: 'The sqlite engine stopped.' });

    expect(
      await fake.invoke(DatabaseChannel.Names, { session, scope: { kind: 'objects' } }),
    ).toEqual([]);

    await fake.invoke(DatabaseChannel.Disconnect, session);
    const asked: number = sqlite.calls.length;
    expect(
      await fake.invoke(DatabaseChannel.Names, { session, scope: { kind: 'objects' } }),
    ).toEqual([]);
    expect(
      await fake.invoke(DatabaseChannel.Names, { session: 'nope', scope: { kind: 'objects' } }),
    ).toEqual([]);
    expect(sqlite.calls).toHaveLength(asked);
  });

  it('test_connectsThenDisconnects_leavingNoSessionOpen', async () => {
    const outcome: ConnectOutcome = await fake.invoke<ConnectOutcome>(
      DatabaseChannel.Test,
      'sqlite',
      { file: 'x.db' },
    );

    expect(outcome.kind).toBe('connected');
    expect(sqlite.ops()).toEqual(['connect', 'disconnect']);
    const session: string = outcome.kind === 'connected' ? outcome.session : '';
    expect(await fake.invoke(DatabaseChannel.Expand, session, null)).toMatchObject({
      kind: 'failure',
    });
  });

  it('restartEngine_disposesItsClient_andForgetsOnlyItsSessions', async () => {
    const mine: string = await connect('sqlite');
    const theirs: string = await connect('other');

    contribution.restartEngine('sqlite');

    expect(sqlite.disposed).toBe(1);
    expect(clientsOf(contribution).has('sqlite')).toBe(false);
    expect(await fake.invoke(DatabaseChannel.Expand, mine, null)).toMatchObject({
      kind: 'failure',
    });
    expect(await fake.invoke(DatabaseChannel.Expand, theirs, null)).toEqual({
      kind: 'nodes',
      nodes: [],
    });
    // An engine that is not running has nothing to restart.
    contribution.restartEngine('never-installed');
  });

  it('dispose_stopsEveryEngine', async () => {
    const session: string = await connect();

    contribution.dispose();

    expect(sqlite.disposed).toBe(1);
    expect(other.disposed).toBe(1);
    expect(await fake.invoke(DatabaseChannel.Expand, session, null)).toMatchObject({
      kind: 'failure',
    });
  });

  it('engines_leavesOutAnEngineWhosePluginIsNotInstalled_andStopsOnesNoLongerInstalled', async () => {
    // The curated index offers SQLite, but nothing is installed in this test's user data; and the
    // fake engines installed above are not in the index at all, so they are stopped.
    expect(await fake.invoke(DatabaseChannel.Engines)).toEqual([]);
    expect(sqlite.disposed).toBe(1);
    expect(other.disposed).toBe(1);
    expect(clientsOf(contribution).size).toBe(0);
  });
});

describe('DatabaseContribution clients', () => {
  let directory: string;

  beforeEach((): (() => void) => {
    directory = mkdtempSync(join(tmpdir(), 'database-clients-'));
    return (): void => rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Builds a descriptor whose plugin runs a given command.
   * @param command The command, or null when the engine is not installed.
   * @returns Returns the descriptor.
   */
  function descriptor(command: string | null): DatabaseEngineDescriptor {
    return {
      id: 'sqlite',
      displayName: 'SQLite',
      priority: 100,
      resolve: () =>
        command === null
          ? { available: false, reason: 'not installed' }
          : { available: true, spec: { command, args: [join(directory, 'main.js')] } },
    };
  }

  it('clientFor_keepsTheClientWhileTheCommandIsTheSame_andRebuildsItWhenItChanges', () => {
    const contribution: Contribution = new DatabaseContribution();
    const clientFor: (d: DatabaseEngineDescriptor) => unknown = (
      contribution as unknown as { clientFor(d: DatabaseEngineDescriptor): unknown }
    ).clientFor.bind(contribution);

    const first: unknown = clientFor(descriptor('/runtime/a'));
    expect(first).toBeInstanceOf(DatabaseEngineClient);
    expect(clientFor(descriptor('/runtime/a'))).toBe(first);

    // An update installed while Studio runs is started from what is on disk now.
    const second: unknown = clientFor(descriptor('/runtime/b'));
    expect(second).toBeInstanceOf(DatabaseEngineClient);
    expect(second).not.toBe(first);

    expect(clientFor(descriptor(null))).toBeNull();
    contribution.dispose();
  });
});
