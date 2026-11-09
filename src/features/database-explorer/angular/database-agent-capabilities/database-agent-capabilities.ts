import { DestroyRef, inject, Service } from '@angular/core';
import {
  CREATE_DATABASE_QUERY,
  LIST_DATABASE_CONNECTIONS,
  LIST_DATABASE_OBJECTS,
  LIST_DATABASE_QUERIES,
  RUN_DATABASE_QUERY,
  SCRIPT_DATABASE_OBJECT,
  UPDATE_DATABASE_QUERY,
} from '@shared/api/ai-types';
import { AiBridgeScope } from '@shared/api/ai/ai-bridge-types';
import {
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseValue,
  ExecuteOutcome,
  NodeActionOutcome,
  ResultSet,
} from '@shared/api/database-engine-protocol';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { Log } from '@shared/angular/services/log/log';
import { plainValue } from '../database-values';
import { DatabasePrompts } from '../database-prompts/database-prompts';
import { DatabaseQueryOpener } from '../database-query-opener/database-query-opener';
import {
  DatabaseWorkspace,
  NodeChildren,
  nodeKey,
  OpenSession,
} from '../database-workspace/database-workspace';

/**
 * How many rows of each result set are handed back to the agent. The user has every row in the grid;
 * the model needs a sample to reason about, not a table dump.
 */
const AGENT_ROWS: number = 50;

/**
 * Every capability the Database Explorer answers.
 */
const CAPABILITIES: readonly string[] = [
  LIST_DATABASE_CONNECTIONS,
  LIST_DATABASE_OBJECTS,
  SCRIPT_DATABASE_OBJECT,
  LIST_DATABASE_QUERIES,
  CREATE_DATABASE_QUERY,
  UPDATE_DATABASE_QUERY,
  RUN_DATABASE_QUERY,
];

/**
 * An answer to the agent: plain data the main process renders for the model.
 */
type Answer = Record<string, unknown>;

/**
 * Reads a string field of a tool input.
 * @param input The input.
 * @param key The field.
 * @returns Returns the field's text, or an empty string.
 */
function text(input: Record<string, unknown>, key: string): string {
  const value: unknown = input[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Routes the Database Explorer's capabilities to the tab whose agent asked. The agent runtime holds one
 * handler per capability name, application-wide, so with two Database Explorer tabs open a handler
 * registered by each would leave only the newest answering — and an agent docked in one tab would act
 * on the other's document. This registers each name once, and hands every request to the tab the
 * request's scope names.
 */
@Service()
export class DatabaseAgentRouter {
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the open tabs' capabilities, newest last.
   */
  private readonly hosts: DatabaseAgentCapabilities[] = [];

  /**
   * Holds the functions releasing the runtime registrations, while any tab is open.
   */
  private releases: readonly (() => void)[] = [];

  /**
   * Adds a tab's capabilities, registering the capability names on the first.
   * @param host The tab's capabilities.
   * @returns Returns a function removing them again.
   */
  public attach(host: DatabaseAgentCapabilities): () => void {
    this.hosts.push(host);
    if (this.releases.length === 0) {
      this.releases = CAPABILITIES.map((name: string): (() => void) =>
        this.runtime.registerCapability(
          name,
          (input: unknown, scope: AiBridgeScope): Answer | Promise<Answer> =>
            this.dispatch(name, input, scope),
        ),
      );
    }
    return (): void => {
      const at: number = this.hosts.indexOf(host);
      if (at >= 0) {
        this.hosts.splice(at, 1);
      }
      if (this.hosts.length === 0) {
        for (const release of this.releases) {
          release();
        }
        this.releases = [];
      }
    };
  }

  /**
   * Hands a request to the tab it belongs to.
   * @param name The capability.
   * @param input The tool input.
   * @param scope Who asked, as main stamped it.
   * @returns Returns the tab's answer.
   */
  private dispatch(name: string, input: unknown, scope: AiBridgeScope): Answer | Promise<Answer> {
    if (scope.surface !== 'database') {
      return { available: false };
    }
    const host: DatabaseAgentCapabilities | undefined = this.hosts.find(
      (candidate: DatabaseAgentCapabilities): boolean => candidate.tabId() === scope.owningTabId,
    );
    if (host === undefined) {
      return { available: false };
    }
    return host.handle(
      name,
      input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
  }
}

/**
 * The Database Explorer's agent capabilities for one tab: what an agent docked in the tab can
 * see and do. It inspects structure freely — connections, the object tree, definitions — writes and
 * changes queries through the same {@link DatabaseWorkspace} the panels use, so the tree and the well
 * update the moment it acts, and runs a query only behind the permission prompt main raises.
 *
 * Provided by the Database Explorer view, so it lives exactly as long as the tab.
 */
@Service()
export class DatabaseAgentCapabilities {
  private readonly workspace: DatabaseWorkspace = inject(DatabaseWorkspace);
  private readonly opener: DatabaseQueryOpener = inject(DatabaseQueryOpener);
  private readonly prompts: DatabasePrompts = inject(DatabasePrompts);
  private readonly tabContext: DockTabContext = inject(DockTabContext);
  private readonly log: Log = inject(Log);

  /**
   * Joins the router for the tab's life.
   */
  public constructor() {
    const detach: () => void = inject(DatabaseAgentRouter).attach(this);
    inject(DestroyRef).onDestroy(detach);
  }

  /**
   * Gets the id of the tab these capabilities belong to.
   * @returns Returns the tab's id.
   */
  public tabId(): string {
    return this.tabContext.tabId();
  }

  /**
   * Answers one capability request.
   * @param name The capability.
   * @param input The tool input.
   * @returns Returns the answer.
   */
  public handle(name: string, input: Record<string, unknown>): Answer | Promise<Answer> {
    switch (name) {
      case LIST_DATABASE_CONNECTIONS:
        return this.listConnections();
      case LIST_DATABASE_OBJECTS:
        return this.listObjects(text(input, 'connection_id'), text(input, 'path'));
      case SCRIPT_DATABASE_OBJECT:
        return this.script(
          text(input, 'connection_id'),
          text(input, 'path'),
          text(input, 'action'),
        );
      case LIST_DATABASE_QUERIES:
        return this.listQueries();
      case CREATE_DATABASE_QUERY:
        return this.create(input);
      case UPDATE_DATABASE_QUERY:
        return this.update(input);
      case RUN_DATABASE_QUERY:
        return this.run(text(input, 'id'));
      default:
        return { ok: false, error: `Unknown capability '${name}'.` };
    }
  }

  /**
   * Lists the connections, without their secrets.
   * @returns Returns the answer.
   */
  private listConnections(): Answer {
    const sessions: ReadonlyMap<string, OpenSession> = this.workspace.sessions();
    return {
      ok: true,
      connections: this.workspace.connections().map((connection: DatabaseConnection) => {
        const engine: DatabaseEngineInfo | undefined = this.workspace.engine(connection.engine);
        return {
          id: connection.id,
          name: connection.name,
          engine: engine?.displayName ?? connection.engine,
          language: engine?.language ?? 'sql',
          multiple_databases: engine?.capabilities.includes('multipleDatabases') === true,
          connected: sessions.has(connection.id),
          server: sessions.get(connection.id)?.serverVersion,
          last_error: this.workspace.connectionErrors().get(connection.id),
          settings: connection.values,
        };
      }),
    };
  }

  /**
   * Makes sure a connection is open, asking the user for its password when this session has none.
   * @param id The connection's id.
   * @returns Returns a promise resolving null when it is open, or the refusal to hand back.
   */
  private async ensureConnected(id: string): Promise<Answer | null> {
    if (this.workspace.connection(id) === undefined) {
      return { ok: false, error: `No connection has the id '${id}'. List the connections first.` };
    }
    if (this.workspace.sessions().has(id)) {
      return null;
    }
    if (this.workspace.needsSecrets(id)) {
      // An agent never sees a password: the user is asked for it, in Studio's own dialog.
      this.prompts.connect(id);
      return {
        ok: false,
        error:
          'The connection needs a password, so the user has been asked to enter it. Try again once they have connected.',
      };
    }
    if (!(await this.workspace.connect(id))) {
      return {
        ok: false,
        error: this.workspace.connectionErrors().get(id) ?? 'The connection could not be opened.',
      };
    }
    return null;
  }

  /**
   * Lists a node's children.
   * @param connectionId The connection.
   * @param path The node's path, or empty for the top of the tree.
   * @returns Returns a promise resolving the answer.
   */
  private async listObjects(connectionId: string, path: string): Promise<Answer> {
    const refused: Answer | null = await this.ensureConnected(connectionId);
    if (refused !== null) {
      return refused;
    }
    const at: string | null = path === '' ? null : path;
    await this.workspace.expand(connectionId, at);
    const children: NodeChildren | undefined = this.workspace
      .children()
      .get(nodeKey(connectionId, at));
    if (children === undefined || children.state === 'loading') {
      return { ok: false, error: 'The objects are still loading; try again.' };
    }
    if (children.state === 'failed') {
      return { ok: false, error: children.message };
    }
    return {
      ok: true,
      nodes: children.nodes.map((node: DatabaseNode) => ({
        path: node.path,
        name: node.label,
        kind: node.icon,
        ...(node.detail === undefined ? {} : { detail: node.detail }),
        expandable: !node.leaf,
        ...(node.database === undefined ? {} : { database: node.database }),
        ...((node.actions ?? []).length === 0
          ? {}
          : {
              actions: (node.actions ?? []).map((action) => ({
                id: action.id,
                label: action.label,
              })),
            }),
        ...((node.properties ?? []).length === 0
          ? {}
          : {
              properties: Object.fromEntries(
                (node.properties ?? []).map((property) => [property.name, property.value]),
              ),
            }),
      })),
    };
  }

  /**
   * Produces the script a node's action writes, without opening or running it.
   * @param connectionId The connection.
   * @param path The node's path.
   * @param action The action.
   * @returns Returns a promise resolving the answer.
   */
  private async script(connectionId: string, path: string, action: string): Promise<Answer> {
    const refused: Answer | null = await this.ensureConnected(connectionId);
    if (refused !== null) {
      return refused;
    }
    const outcome: NodeActionOutcome = await this.workspace.script(connectionId, path, action);
    return outcome.kind === 'script'
      ? { ok: true, title: outcome.title, text: outcome.text }
      : {
          ok: false,
          error: outcome.kind === 'failure' ? outcome.message : 'That action writes no script.',
        };
  }

  /**
   * Lists the saved queries.
   * @returns Returns the answer.
   */
  private listQueries(): Answer {
    return {
      ok: true,
      queries: this.workspace.queries().map((query: DatabaseQuery) => ({
        id: query.id,
        title: query.title,
        connection_id: query.connectionId,
        connection: this.workspace.connection(query.connectionId)?.name ?? null,
        ...(query.database === undefined ? {} : { database: query.database }),
        text: query.text,
      })),
    };
  }

  /**
   * Writes a new query and opens it behind what the user is looking at.
   * @param input The tool input.
   * @returns Returns the answer.
   */
  private create(input: Record<string, unknown>): Answer {
    const connectionId: string = text(input, 'connection_id');
    if (this.workspace.connection(connectionId) === undefined) {
      return { ok: false, error: `No connection has the id '${connectionId}'.` };
    }
    const database: string = text(input, 'database');
    const query: DatabaseQuery = this.workspace.addQuery(
      connectionId,
      database === '' ? undefined : database,
      text(input, 'text'),
      text(input, 'title') || undefined,
    );
    this.opener.open(query.id, { background: true });
    this.log.info('database.agent', 'Agent created a query', { id: query.id });
    return { ok: true, id: query.id, title: query.title };
  }

  /**
   * Changes a saved query.
   * @param input The tool input.
   * @returns Returns the answer.
   */
  private update(input: Record<string, unknown>): Answer {
    const id: string = text(input, 'id');
    if (this.workspace.query(id) === undefined) {
      return { ok: false, error: `No query has the id '${id}'.` };
    }
    const connectionId: string = text(input, 'connection_id');
    if (connectionId !== '' && this.workspace.connection(connectionId) === undefined) {
      return { ok: false, error: `No connection has the id '${connectionId}'.` };
    }
    const changes: Partial<Omit<DatabaseQuery, 'id'>> = {
      ...(typeof input['text'] === 'string' ? { text: input['text'] } : {}),
      ...(typeof input['title'] === 'string' && input['title'] !== ''
        ? { title: input['title'] }
        : {}),
      ...(connectionId === '' ? {} : { connectionId }),
      ...(typeof input['database'] === 'string'
        ? { database: input['database'] === '' ? undefined : input['database'] }
        : {}),
    };
    this.workspace.updateQuery(id, changes);
    if (changes.title !== undefined) {
      this.opener.retitle(id, changes.title);
    }
    this.log.info('database.agent', 'Agent updated a query', { id });
    return { ok: true };
  }

  /**
   * Runs a saved query — only ever reached once the user has granted it — and hands back its messages
   * and the first rows of each result set. The query opens behind what the user is looking at, so the
   * whole result is there for them in the grid.
   * @param id The query's id.
   * @returns Returns a promise resolving the answer.
   */
  private async run(id: string): Promise<Answer> {
    const query: DatabaseQuery | undefined = this.workspace.query(id);
    if (query === undefined) {
      return { ok: false, error: `No query has the id '${id}'.` };
    }
    if (query.connectionId === null) {
      return {
        ok: false,
        error: 'The query has no connection; set one with the update tool first.',
      };
    }
    const refused: Answer | null = await this.ensureConnected(query.connectionId);
    if (refused !== null) {
      return refused;
    }
    this.opener.open(id, { background: true });
    const outcome: ExecuteOutcome | null = await this.workspace.execute(id, query.text);
    if (outcome === null) {
      return { ok: false, error: 'The query is already running.' };
    }
    this.log.info('database.agent', 'Agent ran a query', { id, failed: outcome.failed });
    return {
      ok: true,
      failed: outcome.failed,
      cancelled: outcome.cancelled,
      elapsedMs: outcome.elapsedMs,
      messages: outcome.messages,
      resultSets: outcome.resultSets.map((set: ResultSet) => ({
        columns: set.columns.map((column) =>
          column.type === undefined ? column.name : `${column.name} (${column.type})`,
        ),
        total_rows: set.totalRows,
        rows: set.rows
          .slice(0, AGENT_ROWS)
          .map((row: readonly DatabaseValue[]): unknown[] => row.map(plainValue)),
        ...(set.totalRows > AGENT_ROWS ? { rows_shown: AGENT_ROWS } : {}),
      })),
    };
  }
}
