import neo4j, {
  Driver,
  Integer,
  isDate,
  isDateTime,
  isDuration,
  isInt,
  isLocalDateTime,
  isLocalTime,
  isNode,
  isPath,
  isPoint,
  isRelationship,
  isTime,
  Node,
  Path,
  PathSegment,
  QueryResult,
  Result,
  Record as Neo4jRecord,
  Relationship,
  Session,
} from 'neo4j-driver';
import {
  ConnectionValues,
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseValue,
  ExecuteRequest,
  GraphNodeValue,
  GraphRelationshipValue,
  NodeActionOutcome,
  QueryMessage,
} from '../../protocol/database/protocol';
import { splitStatements } from '../../protocol/database/statements';
import {
  bytesValue,
  DatabaseEngine,
  decodePath,
  describeError,
  encodePath,
  EngineExecution,
  EngineResultSet,
  EngineSession,
  MAX_RESULT_ROWS,
} from '../../protocol/database/engine';

/**
 * The folders under a Neo4j database: what a graph's schema is made of, instead of tables.
 */
const DATABASE_FOLDERS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'labels', label: 'Node Labels' },
  { id: 'types', label: 'Relationship Types' },
  { id: 'keys', label: 'Property Keys' },
  { id: 'indexes', label: 'Indexes' },
  { id: 'constraints', label: 'Constraints' },
];

/**
 * Neo4j through `neo4j-driver`, the pure-JavaScript Bolt driver. It is here to prove the
 * abstraction is not SQL in disguise: its tree is labels and relationship types rather than tables,
 * its language is Cypher, and its results carry nodes, relationships and paths, which the Graph view
 * draws.
 */
export class Neo4jEngine implements DatabaseEngine {
  /**
   * Gets what the engine says about itself.
   */
  public readonly info: DatabaseEngineInfo = {
    id: 'neo4j',
    displayName: 'Neo4j',
    language: 'cypher',
    queryExtension: 'cypher',
    capabilities: ['cancel', 'multipleDatabases', 'script', 'graph'],
    connectionFields: [
      {
        id: 'uri',
        label: 'Address',
        kind: 'text',
        required: true,
        defaultValue: 'neo4j://localhost:7687',
      },
      { id: 'database', label: 'Database', kind: 'text', defaultValue: 'neo4j' },
      { id: 'user', label: 'User', kind: 'text', required: true, defaultValue: 'neo4j' },
      { id: 'password', label: 'Password', kind: 'password', secret: true },
    ],
  };

  /**
   * Opens a driver and checks it can reach the server.
   * @param values The connection's field values.
   * @returns Returns a promise resolving the session.
   */
  public async connect(values: ConnectionValues): Promise<EngineSession> {
    const uri: string = (values['uri'] ?? '').trim();
    if (uri === '') {
      throw new Error('Enter the server address.');
    }
    const driver: Driver = neo4j.driver(
      uri,
      neo4j.auth.basic((values['user'] ?? '').trim(), values['password'] ?? ''),
      { connectionTimeout: 10_000, disableLosslessIntegers: false },
    );
    try {
      const info: { agent?: string } = await driver.getServerInfo();
      return new Neo4jSession(
        driver,
        (values['database'] ?? '').trim() || 'neo4j',
        info.agent ?? 'Neo4j',
      );
    } catch (error: unknown) {
      await driver.close();
      throw new Error(describeError(error), { cause: error });
    }
  }
}

/**
 * One connection to a Neo4j server.
 */
class Neo4jSession implements EngineSession {
  /**
   * Holds the Bolt sessions of running executions, so a cancel can close the one it belongs to.
   */
  private readonly running: Map<string, Session> = new Map<string, Session>();

  /**
   * Holds the executions a cancel has been asked for.
   */
  private readonly cancelled: Set<string> = new Set<string>();

  /**
   * Creates the session.
   * @param driver The connected driver.
   * @param database The connection's default database.
   * @param serverVersion The server's agent string.
   */
  public constructor(
    private readonly driver: Driver,
    private readonly database: string,
    public readonly serverVersion: string,
  ) {}

  /**
   * Lists a node's children: the databases, the schema folders of one, and each folder's entries.
   * @param path The node's path, or null for the top of the tree.
   * @returns Returns a promise resolving the children.
   */
  public async expand(path: string | null): Promise<readonly DatabaseNode[]> {
    const [, database, folder] = path === null ? [] : decodePath(path);
    if (database === undefined) {
      return this.databases();
    }
    if (folder === undefined) {
      return DATABASE_FOLDERS.map(
        (entry: { readonly id: string; readonly label: string }): DatabaseNode => ({
          path: encodePath('db', database, entry.id),
          label: entry.label,
          icon: 'folder',
          leaf: false,
          database,
        }),
      );
    }
    return this.folder(database, folder);
  }

  /**
   * Lists the databases the user can see, falling back to the connection's own when the server will
   * not say (an older server, or a user without access to `system`).
   * @returns Returns a promise resolving the database nodes.
   */
  private async databases(): Promise<readonly DatabaseNode[]> {
    let rows: readonly { name: string; status: string; home: boolean }[];
    try {
      const result: QueryResult = await this.driver.executeQuery(
        'SHOW DATABASES YIELD name, currentStatus, home WHERE name <> "system" RETURN name, currentStatus, home',
        {},
        { database: 'system' },
      );
      rows = result.records.map((record: Neo4jRecord) => ({
        name: String(record.get('name')),
        status: String(record.get('currentStatus')),
        home: record.get('home') === true,
      }));
    } catch {
      rows = [{ name: this.database, status: 'online', home: true }];
    }
    return rows.map((row: { name: string; status: string; home: boolean }): DatabaseNode => ({
      path: encodePath('db', row.name),
      label: row.name,
      detail: row.home ? 'home' : row.status === 'online' ? undefined : row.status,
      icon: 'database',
      leaf: false,
      database: row.name,
      actions: [{ id: 'schema', label: 'Show Schema Graph' }],
      properties: [
        { name: 'Database', value: row.name },
        { name: 'Status', value: row.status },
        { name: 'Home database', value: row.home ? 'Yes' : 'No' },
      ],
    }));
  }

  /**
   * Lists one schema folder of a database.
   * @param database The database.
   * @param folder The folder.
   * @returns Returns a promise resolving the entries.
   */
  private async folder(database: string, folder: string): Promise<readonly DatabaseNode[]> {
    const leaf: (label: string) => string = (label: string): string =>
      encodePath('db', database, folder, label);
    switch (folder) {
      case 'labels':
        return (
          await this.column(database, 'CALL db.labels() YIELD label RETURN label ORDER BY label')
        ).map((label: string): DatabaseNode => ({
          path: leaf(label),
          label,
          icon: 'label',
          leaf: true,
          database,
          actions: [{ id: 'match-nodes', label: 'Match 25 Nodes' }],
          properties: [{ name: 'Label', value: label }],
        }));
      case 'types':
        return (
          await this.column(
            database,
            'CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType',
          )
        ).map((type: string): DatabaseNode => ({
          path: leaf(type),
          label: type,
          icon: 'relationship',
          leaf: true,
          database,
          actions: [{ id: 'match-relationships', label: 'Match 25 Relationships' }],
          properties: [{ name: 'Relationship type', value: type }],
        }));
      case 'keys':
        return (
          await this.column(
            database,
            'CALL db.propertyKeys() YIELD propertyKey RETURN propertyKey ORDER BY propertyKey',
          )
        ).map((key: string): DatabaseNode => ({
          path: leaf(key),
          label: key,
          icon: 'property',
          leaf: true,
          database,
        }));
      case 'indexes':
      case 'constraints': {
        const result: QueryResult = await this.driver.executeQuery(
          folder === 'indexes'
            ? 'SHOW INDEXES YIELD name, type, labelsOrTypes, properties RETURN name, type, labelsOrTypes, properties ORDER BY name'
            : 'SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties RETURN name, type, labelsOrTypes, properties ORDER BY name',
          {},
          { database },
        );
        return result.records.map((record: Neo4jRecord): DatabaseNode => {
          const name: string = String(record.get('name'));
          const on: string = `${String(record.get('labelsOrTypes') ?? '')}(${String(record.get('properties') ?? '')})`;
          return {
            path: leaf(name),
            label: name,
            detail: String(record.get('type')),
            icon: folder === 'indexes' ? 'index' : 'constraint',
            leaf: true,
            database,
            properties: [
              { name: 'Name', value: name },
              { name: 'Type', value: String(record.get('type')) },
              { name: 'On', value: on },
            ],
          };
        });
      }
      default:
        return [];
    }
  }

  /**
   * Runs a query returning one column and reads it as strings.
   * @param database The database.
   * @param cypher The query.
   * @returns Returns a promise resolving the values.
   */
  private async column(database: string, cypher: string): Promise<readonly string[]> {
    const result: QueryResult = await this.driver.executeQuery(cypher, {}, { database });
    return result.records.map((record: Neo4jRecord): string => String(record.get(0)));
  }

  /**
   * Runs a script statement by statement in one Bolt session, stopping at the first error.
   * @param request The execution.
   * @returns Returns a promise resolving what it produced.
   */
  public async execute(request: ExecuteRequest): Promise<EngineExecution> {
    const session: Session = this.driver.session({ database: request.database ?? this.database });
    this.running.set(request.id, session);
    const resultSets: EngineResultSet[] = [];
    const messages: QueryMessage[] = [];
    let failed: boolean = false;
    try {
      for (const statement of splitStatements(request.text, request.firstLine, true)) {
        if (this.cancelled.has(request.id)) {
          break;
        }
        try {
          const running: Result = session.run(statement.text);
          // Asked of the result rather than read off its first record, so a query that matches
          // nothing still shows its columns.
          const keys: readonly string[] = (await running.keys()).map(String);
          const result: QueryResult = await running;
          if (keys.length > 0) {
            resultSets.push({
              columns: keys.map((name: string) => ({ name })),
              rows: result.records
                .slice(0, MAX_RESULT_ROWS)
                .map((record: Neo4jRecord): readonly DatabaseValue[] =>
                  keys.map((key: string): DatabaseValue => toValue(record.get(key))),
                ),
              line: statement.line,
            });
          }
          messages.push(
            result.records.length > MAX_RESULT_ROWS
              ? {
                  severity: 'warning',
                  text: `${result.records.length} rows returned; the first ${MAX_RESULT_ROWS} are kept`,
                  line: statement.line,
                }
              : { severity: 'info', text: describeSummary(result), line: statement.line },
          );
          for (const notification of result.summary.notifications) {
            messages.push({
              severity: 'warning',
              text: `${notification.title}: ${notification.description}`,
              line:
                statement.line +
                Math.max(0, (notification.position as { line?: number } | undefined)?.line ?? 1) -
                1,
            });
          }
        } catch (error: unknown) {
          if (this.cancelled.has(request.id)) {
            messages.push({
              severity: 'warning',
              text: 'The query was cancelled.',
              line: statement.line,
            });
            break;
          }
          const message: string = describeError(error);
          const at: RegExpExecArray | null = /line (\d+)/i.exec(message);
          messages.push({
            severity: 'error',
            text: message,
            line: at === null ? statement.line : statement.line + Number(at[1]) - 1,
          });
          failed = true;
          break;
        }
      }
    } finally {
      this.running.delete(request.id);
      await session.close().catch((): void => undefined);
    }
    const cancelled: boolean = this.cancelled.delete(request.id);
    return { resultSets, messages, failed: failed && !cancelled, cancelled };
  }

  /**
   * Cancels a running execution by closing its Bolt session, which aborts the statement in flight.
   * @param id The execution's identifier.
   */
  public cancel(id: string): void {
    const session: Session | undefined = this.running.get(id);
    if (session !== undefined) {
      this.cancelled.add(id);
      void session.close().catch((): void => undefined);
    }
  }

  /**
   * Builds the query a node's action asks for.
   * @param path The node's path.
   * @param action The action.
   * @returns Returns a promise resolving the query.
   */
  public action(path: string, action: string): Promise<NodeActionOutcome> {
    const [, database, , name] = decodePath(path);
    if (database === undefined) {
      return Promise.resolve({ kind: 'failure', message: 'Nothing to act on.' });
    }
    const quoted: string = `\`${(name ?? '').replace(/`/g, '``')}\``;
    switch (action) {
      case 'schema':
        return Promise.resolve({
          kind: 'script',
          reads: true,
          title: `${database} schema`,
          text: 'CALL db.schema.visualization();\n',
          database,
        });
      case 'match-nodes':
        return Promise.resolve({
          kind: 'script',
          reads: true,
          title: name ?? 'Nodes',
          text: `MATCH (n:${quoted})\nRETURN n\nLIMIT 25;\n`,
          database,
        });
      case 'match-relationships':
        return Promise.resolve({
          kind: 'script',
          reads: true,
          title: name ?? 'Relationships',
          text: `MATCH p = ()-[r:${quoted}]->()\nRETURN p\nLIMIT 25;\n`,
          database,
        });
      default:
        return Promise.resolve({ kind: 'failure', message: `Unknown action '${action}'.` });
    }
  }

  /**
   * Closes the driver.
   */
  public async close(): Promise<void> {
    await this.driver.close();
  }
}

/**
 * Describes what a statement did, the way Neo4j Browser does: the changes it made, or the rows it
 * returned.
 * @param result The statement's result.
 * @returns Returns the message text.
 */
export function describeSummary(result: QueryResult): string {
  const updates: Record<string, number> = result.summary.counters.updates();
  const changes: string[] = Object.entries(updates)
    .filter(([, count]: [string, number]): boolean => count > 0)
    .map(
      ([name, count]: [string, number]): string =>
        `${count} ${name.replace(/([A-Z])/g, ' $1').toLowerCase()}`,
    );
  const rows: number = result.records.length;
  const returned: string = `${rows} row${rows === 1 ? '' : 's'} returned`;
  return changes.length === 0 ? returned : `${changes.join(', ')}; ${returned}`;
}

/**
 * Converts a node into its typed graph value.
 * @param node The driver's node.
 * @returns Returns the typed value.
 */
export function nodeValue(node: Node): GraphNodeValue {
  return {
    type: 'node',
    id: node.elementId,
    labels: [...node.labels],
    properties: mapValue(node.properties),
  };
}

/**
 * Converts a relationship into its typed graph value.
 * @param relationship The driver's relationship.
 * @returns Returns the typed value.
 */
export function relationshipValue(relationship: Relationship): GraphRelationshipValue {
  return {
    type: 'relationship',
    id: relationship.elementId,
    relationshipType: relationship.type,
    start: relationship.startNodeElementId,
    end: relationship.endNodeElementId,
    properties: mapValue(relationship.properties),
  };
}

/**
 * Converts a property map into typed cells.
 * @param map The properties.
 * @returns Returns the typed map.
 */
function mapValue(map: Readonly<Record<string, unknown>>): Readonly<Record<string, DatabaseValue>> {
  return Object.fromEntries(
    Object.entries(map).map(([key, value]: [string, unknown]): [string, DatabaseValue] => [
      key,
      toValue(value),
    ]),
  );
}

/**
 * Converts a value the driver returned into a typed cell.
 * @param value The driver's value.
 * @returns Returns the typed cell.
 */
export function toValue(value: unknown): DatabaseValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (isInt(value)) {
    const integer: Integer = value;
    return integer.inSafeRange()
      ? integer.toNumber()
      : { type: 'bigint', value: integer.toString() };
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return { type: 'bigint', value: value.toString() };
  }
  if (isNode(value)) {
    return nodeValue(value);
  }
  if (isRelationship(value)) {
    return relationshipValue(value);
  }
  if (isPath(value)) {
    const path: Path = value;
    return {
      type: 'path',
      nodes: [
        nodeValue(path.start),
        ...path.segments.map((segment: PathSegment): GraphNodeValue => nodeValue(segment.end)),
      ],
      relationships: path.segments.map((segment: PathSegment): GraphRelationshipValue =>
        relationshipValue(segment.relationship),
      ),
    };
  }
  if (
    isDate(value) ||
    isDateTime(value) ||
    isLocalDateTime(value) ||
    isTime(value) ||
    isLocalTime(value) ||
    isDuration(value) ||
    isPoint(value)
  ) {
    return { type: 'temporal', value: String(value) };
  }
  if (value instanceof Uint8Array || value instanceof Int8Array) {
    return bytesValue(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value)) {
    return { type: 'list', items: value.map(toValue) };
  }
  if (typeof value === 'object') {
    return { type: 'map', entries: mapValue(value as Record<string, unknown>) };
  }
  return JSON.stringify(value) ?? '';
}
