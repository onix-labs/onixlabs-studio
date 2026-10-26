import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
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

/**
 * The message every call answers with outside the desktop application, where there is no engine.
 */
const UNAVAILABLE: string = 'Database engines are unavailable outside the desktop application.';

/**
 * The renderer client for the database engines: a typed wrapper over the generic {@link Bridge} naming
 * the {@link DatabaseChannel} channels, so no panel touches `window.bridge`. Outside Electron every
 * call answers with a failure rather than throwing, as the API Explorer's client does.
 */
@Service()
export class DatabaseClient {
  /**
   * Holds the IPC transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Lists the available engines.
   * @returns Returns a promise resolving the engines.
   */
  public engines(): Promise<readonly DatabaseEngineInfo[]> {
    return (
      this.bridge?.invoke<readonly DatabaseEngineInfo[]>(DatabaseChannel.Engines) ??
      Promise.resolve([])
    );
  }

  /**
   * Opens a connection.
   * @param engine The engine's id.
   * @param values The field values, secrets included.
   * @returns Returns a promise resolving the outcome.
   */
  public connect(engine: string, values: ConnectionValues): Promise<ConnectOutcome> {
    return (
      this.bridge?.invoke<ConnectOutcome>(DatabaseChannel.Connect, engine, values) ??
      Promise.resolve({ kind: 'failure', message: UNAVAILABLE })
    );
  }

  /**
   * Tests a connection without keeping it open.
   * @param engine The engine's id.
   * @param values The field values, secrets included.
   * @returns Returns a promise resolving the outcome.
   */
  public test(engine: string, values: ConnectionValues): Promise<ConnectOutcome> {
    return (
      this.bridge?.invoke<ConnectOutcome>(DatabaseChannel.Test, engine, values) ??
      Promise.resolve({ kind: 'failure', message: UNAVAILABLE })
    );
  }

  /**
   * Closes a session.
   * @param session The session's id.
   * @returns Returns a promise resolving once it is closed.
   */
  public disconnect(session: string): Promise<void> {
    return this.bridge?.invoke<void>(DatabaseChannel.Disconnect, session) ?? Promise.resolve();
  }

  /**
   * Lists a tree node's children.
   * @param session The session's id.
   * @param path The node's path, or null for the top of the tree.
   * @returns Returns a promise resolving the outcome.
   */
  public expand(session: string, path: string | null): Promise<ExpandOutcome> {
    return (
      this.bridge?.invoke<ExpandOutcome>(DatabaseChannel.Expand, session, path) ??
      Promise.resolve({ kind: 'failure', message: UNAVAILABLE })
    );
  }

  /**
   * Runs text.
   * @param request The execution.
   * @returns Returns a promise resolving the outcome; it never rejects.
   */
  public execute(request: ExecuteRequest): Promise<ExecuteOutcome> {
    return (
      this.bridge?.invoke<ExecuteOutcome>(DatabaseChannel.Execute, request) ??
      Promise.resolve({
        id: request.id,
        resultSets: [],
        messages: [{ severity: 'error', text: UNAVAILABLE }],
        elapsedMs: 0,
        failed: true,
        cancelled: false,
      })
    );
  }

  /**
   * Cancels a running execution.
   * @param id The execution's id.
   */
  public cancel(id: string): void {
    this.bridge?.send(DatabaseChannel.Cancel, id);
  }

  /**
   * Reads more rows of a paged result set.
   * @param request What to read.
   * @returns Returns a promise resolving the rows.
   */
  public fetch(request: FetchRequest): Promise<readonly (readonly DatabaseValue[])[]> {
    return (
      this.bridge?.invoke<readonly (readonly DatabaseValue[])[]>(DatabaseChannel.Fetch, request) ??
      Promise.resolve([])
    );
  }

  /**
   * Runs a node action.
   * @param session The session's id.
   * @param path The node's path.
   * @param action The action's id.
   * @returns Returns a promise resolving what it produced.
   */
  public action(session: string, path: string, action: string): Promise<NodeActionOutcome> {
    return (
      this.bridge?.invoke<NodeActionOutcome>(DatabaseChannel.Action, session, path, action) ??
      Promise.resolve({ kind: 'failure', message: UNAVAILABLE })
    );
  }
}
