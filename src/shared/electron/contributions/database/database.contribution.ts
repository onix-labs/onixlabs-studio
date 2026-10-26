import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { DatabaseChannel } from '@shared/api/database-channels';
import {
  ConnectionValues,
  ConnectOutcome,
  DatabaseEngineInfo,
  DatabaseValue,
  ExecuteOutcome,
  ExecuteRequest,
  ExpandOutcome,
  FetchRequest,
  NodeActionOutcome,
} from '@shared/api/database-engine-protocol';
import { pluginNodeRuntime } from '../../plugin-node-runtime';
import { ContributionContext, MainContribution } from '../main-contribution';
import { contributedDatabaseEngines } from '../plugins/contributed';
import { DatabaseEngineClient, DatabaseEngineOutcome } from './database-engine-client';
import type {
  DatabaseEngineDescriptor,
  DatabaseEngineResolution,
} from './database-engine-descriptor';

/**
 * One open session: which engine holds it, and the engine's own id for it.
 */
interface OpenSession {
  readonly engine: string;
  readonly session: string;
}

/**
 * The Database Explorer's main-process half (#1095): the host of the installed database-engine
 * plugins. It holds no database code — no driver, no SQL, nothing about any engine — and forwards each
 * request of the database-engine protocol to the plugin the session belongs to.
 *
 * One plugin process per installed engine, started the first time a Database Explorer asks which
 * engines there are, and started again after it exits. A session is named to the renderer by an id of
 * this host's own, so a renderer can never address another engine's session by guessing its id, and
 * sessions die with the process that held them.
 */
export class DatabaseContribution implements MainContribution {
  /**
   * The stable contribution id and IPC channel namespace.
   */
  public readonly id: string = 'database';

  /**
   * The engine plugins' clients, keyed by engine id.
   */
  private readonly clients: Map<string, { client: DatabaseEngineClient; command: string }> =
    new Map<string, { client: DatabaseEngineClient; command: string }>();

  /**
   * The open sessions, keyed by this host's session id.
   */
  private readonly sessions: Map<string, OpenSession> = new Map<string, OpenSession>();

  /**
   * The engine each running execution belongs to, so a cancel finds it.
   */
  private readonly executions: Map<string, string> = new Map<string, string>();

  /**
   * The context, kept for logging.
   */
  private context: ContributionContext | null = null;

  /**
   * Wires the channels.
   * @param context The surface the contribution reaches the application through.
   */
  public activate(context: ContributionContext): void {
    this.context = context;
    context.handle(DatabaseChannel.Engines, (): Promise<readonly DatabaseEngineInfo[]> =>
      this.engines(),
    );
    context.handle(
      DatabaseChannel.Connect,
      (_event: IpcMainInvokeEvent, ...args: unknown[]): Promise<ConnectOutcome> =>
        this.connect(args[0] as string, args[1] as ConnectionValues),
    );
    context.handle(
      DatabaseChannel.Test,
      async (_event: IpcMainInvokeEvent, ...args: unknown[]): Promise<ConnectOutcome> => {
        const outcome: ConnectOutcome = await this.connect(
          args[0] as string,
          args[1] as ConnectionValues,
        );
        if (outcome.kind === 'connected') {
          await this.disconnect(outcome.session);
        }
        return outcome;
      },
    );
    context.handle(
      DatabaseChannel.Disconnect,
      (_event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> =>
        this.disconnect(args[0] as string),
    );
    context.handle(
      DatabaseChannel.Expand,
      (_event: IpcMainInvokeEvent, ...args: unknown[]): Promise<ExpandOutcome> =>
        this.expand(args[0] as string, args[1] as string | null),
    );
    context.handle(
      DatabaseChannel.Execute,
      (_event: IpcMainInvokeEvent, ...args: unknown[]): Promise<ExecuteOutcome> =>
        this.execute(args[0] as ExecuteRequest),
    );
    context.on(DatabaseChannel.Cancel, (_event: IpcMainEvent, ...args: unknown[]): void => {
      const id: string = args[0] as string;
      const engine: string | undefined = this.executions.get(id);
      if (engine !== undefined) {
        void this.clients.get(engine)?.client.call('cancel', { id });
        context.log.info('Cancelling execution', { id, engine });
      }
    });
    context.handle(
      DatabaseChannel.Fetch,
      (
        _event: IpcMainInvokeEvent,
        ...args: unknown[]
      ): Promise<readonly (readonly DatabaseValue[])[]> => this.fetch(args[0] as FetchRequest),
    );
    context.handle(
      DatabaseChannel.Action,
      (_event: IpcMainInvokeEvent, ...args: unknown[]): Promise<NodeActionOutcome> =>
        this.action(args[0] as string, args[1] as string, args[2] as string),
    );
    context.log.info('Database engine host ready');
  }

  /**
   * Stops every engine plugin, so a quitting application leaves no connection open.
   */
  public dispose(): void {
    for (const { client } of this.clients.values()) {
      client.dispose();
    }
    this.clients.clear();
    this.sessions.clear();
    this.executions.clear();
  }

  /**
   * Stops an engine's plugin after it is installed, updated or removed, so the next request starts
   * what is on disk now rather than leaving the old process serving (#881).
   * @param id The engine's id.
   */
  public restartEngine(id: string): void {
    const entry: { client: DatabaseEngineClient } | undefined = this.clients.get(id);
    if (entry !== undefined) {
      entry.client.dispose();
      this.clients.delete(id);
      this.forgetSessions(id);
      this.context?.log.info('Restarted database engine plugin', { id });
    }
  }

  /**
   * Lists the installed engines, starting each one's plugin to ask what it is. An engine whose plugin
   * cannot start is left out rather than listed with nothing behind it.
   * @returns Returns a promise resolving the engines, highest priority first.
   */
  private async engines(): Promise<readonly DatabaseEngineInfo[]> {
    const descriptors: readonly DatabaseEngineDescriptor[] = [
      ...contributedDatabaseEngines(pluginNodeRuntime),
    ].sort(
      (left: DatabaseEngineDescriptor, right: DatabaseEngineDescriptor): number =>
        right.priority - left.priority,
    );
    const installed: Set<string> = new Set<string>();
    const infos: (DatabaseEngineInfo | null)[] = await Promise.all(
      descriptors.map(async (descriptor: DatabaseEngineDescriptor) => {
        const client: DatabaseEngineClient | null = this.clientFor(descriptor);
        if (client === null) {
          return null;
        }
        installed.add(descriptor.id);
        const info: DatabaseEngineInfo | null = await client.info();
        // The manifest's id is the one connections name; the process may not contradict it.
        return info === null ? null : { ...info, id: descriptor.id };
      }),
    );
    // An engine uninstalled since it was last asked for no longer serves anything.
    for (const id of [...this.clients.keys()]) {
      if (!installed.has(id)) {
        this.restartEngine(id);
      }
    }
    return infos.filter(
      (info: DatabaseEngineInfo | null): info is DatabaseEngineInfo => info !== null,
    );
  }

  /**
   * Gets the client for an engine, making it when the engine is installed and rebuilding it when the
   * installed plugin's command has changed since.
   * @param descriptor The engine.
   * @returns Returns the client, or null when the engine is not installed.
   */
  private clientFor(descriptor: DatabaseEngineDescriptor): DatabaseEngineClient | null {
    const resolution: DatabaseEngineResolution = descriptor.resolve();
    if (!resolution.available) {
      return null;
    }
    const command: string = [resolution.spec.command, ...resolution.spec.args].join('\u0000');
    const existing: { client: DatabaseEngineClient; command: string } | undefined =
      this.clients.get(descriptor.id);
    if (existing?.command === command) {
      return existing.client;
    }
    existing?.client.dispose();
    this.forgetSessions(descriptor.id);
    const client: DatabaseEngineClient = new DatabaseEngineClient(descriptor.id, resolution.spec);
    client.onExit((): void => this.forgetSessions(descriptor.id));
    this.clients.set(descriptor.id, { client, command });
    return client;
  }

  /**
   * Gets a running engine's client by id, starting it from what is installed when need be.
   * @param id The engine's id.
   * @returns Returns the client, or null when no such engine is installed.
   */
  private client(id: string): DatabaseEngineClient | null {
    const existing: { client: DatabaseEngineClient } | undefined = this.clients.get(id);
    if (existing !== undefined) {
      return existing.client;
    }
    const descriptor: DatabaseEngineDescriptor | undefined = contributedDatabaseEngines(
      pluginNodeRuntime,
    ).find((candidate: DatabaseEngineDescriptor): boolean => candidate.id === id);
    return descriptor === undefined ? null : this.clientFor(descriptor);
  }

  /**
   * Opens a connection with an engine.
   * @param engineId The engine's id.
   * @param values The connection's field values, secrets included.
   * @returns Returns a promise resolving the session, or why there is none.
   */
  private async connect(engineId: string, values: ConnectionValues): Promise<ConnectOutcome> {
    const client: DatabaseEngineClient | null = this.client(engineId);
    if (client === null) {
      return { kind: 'failure', message: `No database engine named '${engineId}' is installed.` };
    }
    const outcome: DatabaseEngineOutcome<ConnectOutcome> = await client.call('connect', { values });
    if (!outcome.ok) {
      return { kind: 'failure', message: outcome.error };
    }
    if (outcome.result.kind !== 'connected') {
      return outcome.result;
    }
    const id: string = randomUUID();
    this.sessions.set(id, { engine: engineId, session: outcome.result.session });
    this.context?.log.info('Connected', { engine: engineId, server: outcome.result.serverVersion });
    return { ...outcome.result, session: id };
  }

  /**
   * Closes a session.
   * @param id The session's id.
   */
  private async disconnect(id: string): Promise<void> {
    const open: OpenSession | undefined = this.sessions.get(id);
    this.sessions.delete(id);
    if (open !== undefined) {
      await this.clients.get(open.engine)?.client.call('disconnect', { session: open.session });
    }
  }

  /**
   * Lists a node's children.
   * @param sessionId The session.
   * @param path The node's path, or null for the top of the tree.
   * @returns Returns a promise resolving the children, or why they could not be read.
   */
  private async expand(sessionId: string, path: string | null): Promise<ExpandOutcome> {
    const target: { client: DatabaseEngineClient; open: OpenSession } | null =
      this.target(sessionId);
    if (target === null) {
      return { kind: 'failure', message: 'The connection is closed. Connect again.' };
    }
    const outcome: DatabaseEngineOutcome<ExpandOutcome> = await target.client.call('expand', {
      session: target.open.session,
      path,
    });
    return outcome.ok ? outcome.result : { kind: 'failure', message: outcome.error };
  }

  /**
   * Runs an execution.
   * @param request The execution, naming this host's session.
   * @returns Returns a promise resolving the outcome; it never rejects.
   */
  private async execute(request: ExecuteRequest): Promise<ExecuteOutcome> {
    const target: { client: DatabaseEngineClient; open: OpenSession } | null = this.target(
      request.session,
    );
    if (target === null) {
      return failedExecution(request.id, 'The connection is closed. Connect again and re-run.');
    }
    this.executions.set(request.id, target.open.engine);
    try {
      const outcome: DatabaseEngineOutcome<ExecuteOutcome> = await target.client.call('execute', {
        ...request,
        session: target.open.session,
      });
      return outcome.ok ? outcome.result : failedExecution(request.id, outcome.error);
    } finally {
      this.executions.delete(request.id);
    }
  }

  /**
   * Reads more rows of a paged result set.
   * @param request What to read, naming this host's session.
   * @returns Returns a promise resolving the rows, or none when they are gone.
   */
  private async fetch(request: FetchRequest): Promise<readonly (readonly DatabaseValue[])[]> {
    const target: { client: DatabaseEngineClient; open: OpenSession } | null = this.target(
      request.session,
    );
    if (target === null) {
      return [];
    }
    const outcome: DatabaseEngineOutcome<readonly (readonly DatabaseValue[])[]> =
      await target.client.call('fetch', { ...request, session: target.open.session });
    return outcome.ok ? outcome.result : [];
  }

  /**
   * Runs a node action.
   * @param sessionId The session.
   * @param path The node's path.
   * @param action The action's id.
   * @returns Returns a promise resolving what it produced.
   */
  private async action(
    sessionId: string,
    path: string,
    action: string,
  ): Promise<NodeActionOutcome> {
    const target: { client: DatabaseEngineClient; open: OpenSession } | null =
      this.target(sessionId);
    if (target === null) {
      return { kind: 'failure', message: 'The connection is closed. Connect again.' };
    }
    const outcome: DatabaseEngineOutcome<NodeActionOutcome> = await target.client.call('action', {
      session: target.open.session,
      path,
      action,
    });
    return outcome.ok ? outcome.result : { kind: 'failure', message: outcome.error };
  }

  /**
   * Finds the plugin and the plugin's own session behind one of this host's session ids.
   * @param sessionId The session id.
   * @returns Returns them, or null when the session is not open.
   */
  private target(sessionId: string): { client: DatabaseEngineClient; open: OpenSession } | null {
    const open: OpenSession | undefined = this.sessions.get(sessionId);
    const client: DatabaseEngineClient | undefined =
      open === undefined ? undefined : this.clients.get(open.engine)?.client;
    return open === undefined || client === undefined ? null : { client, open };
  }

  /**
   * Forgets every session an engine held, when its process has gone.
   * @param engine The engine's id.
   */
  private forgetSessions(engine: string): void {
    for (const [id, open] of [...this.sessions]) {
      if (open.engine === engine) {
        this.sessions.delete(id);
      }
    }
  }
}

/**
 * Builds the outcome of an execution that could not be run at all.
 * @param id The execution's id.
 * @param message Why.
 * @returns Returns the outcome.
 */
function failedExecution(id: string, message: string): ExecuteOutcome {
  return {
    id,
    resultSets: [],
    messages: [{ severity: 'error', text: message }],
    elapsedMs: 0,
    failed: true,
    cancelled: false,
  };
}

/**
 * The Database Explorer backend contribution instance registered in the main manifest.
 */
export const databaseContribution: DatabaseContribution = new DatabaseContribution();
