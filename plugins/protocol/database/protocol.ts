// The database-engine protocol (#1095): what Studio says to a database-engine plugin, and what it
// answers. Keep this module platform-neutral (types, constants and pure functions only) so both
// compilation targets can import it. The engine plugins share one copy of it, in
// `plugins/protocol/database/`, beside the host they all serve it through.
//
// One plugin per engine (SQLite, PostgreSQL, Neo4j…), each a separate process Studio starts on first
// use. Framing is newline-delimited JSON over the plugin's standard streams: each request line carries
// an `id`, `op` and `params`, and each answer carries the same `id`; answers may arrive in any order,
// so a long query does not hold up an expand.
//
// Studio owns every pixel. An engine never describes UI: it answers questions about its own world —
// what fields a connection needs, what lives under a tree node, what a query returned — and Studio
// renders the answers with its own controls. The tree's shape, the node actions and the connection
// fields are all data for that reason.
//
// A plugin holds its own sessions and result rows. Studio hands it the values a connection needs —
// secrets included — at `connect`, and asks for further pages of a large result with `fetch` rather
// than receiving every row in one line.

/**
 * The protocol version this build speaks. A plugin answering with a different major version is
 * refused; a newer minor is accepted, and its additions go unused.
 */
export const DATABASE_ENGINE_PROTOCOL: string = '1.1';

/**
 * The capabilities an engine may declare. A closed list: Studio only offers what it knows how to
 * drive, and an engine only claims what it implements.
 *
 * - `cancel` — a running query can be stopped part-way.
 * - `multipleDatabases` — one connection reaches several databases (PostgreSQL, Neo4j), so the tree
 *   lists them and a query document can name which one it runs against.
 * - `script` — node actions can produce a script (Select Top N, Script as CREATE) to open as a query.
 * - `graph` — results may carry nodes, relationships and paths, so the Graph view is offered.
 */
export type DatabaseEngineCapability =
  'cancel' | 'multipleDatabases' | 'script' | 'graph' | 'completion';

/**
 * The kinds of connection field an engine may ask for. A closed list, rendered by Studio's own form
 * atoms: an engine describes the field, it never draws it.
 */
export type ConnectionFieldKind = 'text' | 'number' | 'password' | 'file' | 'boolean' | 'choice';

/**
 * One option of a `choice` connection field.
 */
export interface ConnectionFieldOption {
  /**
   * Gets the value stored when the option is chosen.
   */
  readonly value: string;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;
}

/**
 * One field an engine needs to make a connection: a host, a port, a user, a database file.
 */
export interface ConnectionField {
  /**
   * Gets the field's identifier, the key its value is stored under.
   */
  readonly id: string;

  /**
   * Gets the label shown beside the field.
   */
  readonly label: string;

  /**
   * Gets how the field is entered.
   */
  readonly kind: ConnectionFieldKind;

  /**
   * Gets whether a connection cannot be made without it.
   */
  readonly required?: boolean;

  /**
   * Gets the value a new connection starts with.
   */
  readonly defaultValue?: string;

  /**
   * Gets the hint shown in an empty field.
   */
  readonly placeholder?: string;

  /**
   * Gets the options of a `choice` field.
   */
  readonly options?: readonly ConnectionFieldOption[];

  /**
   * Gets whether the value is a secret. A secret is never written into a database document as it
   * was typed: it is held in memory for the session (and, with #1097, kept encrypted in the document).
   */
  readonly secret?: boolean;
}

/**
 * What an engine says about itself when Studio starts it: the `initialize` answer.
 */
export interface DatabaseEngineInfo {
  /**
   * Gets the engine's stable identifier, named after the implementation (`sqlite`, `postgres`).
   */
  readonly id: string;

  /**
   * Gets the engine's display name.
   */
  readonly displayName: string;

  /**
   * Gets the Monaco language id its query documents are written in (`sql`, `pgsql`, `cypher`).
   */
  readonly language: string;

  /**
   * Gets the file extension a query exported from this engine is saved with, without the dot.
   */
  readonly queryExtension: string;

  /**
   * Gets the capabilities the engine implements.
   */
  readonly capabilities: readonly DatabaseEngineCapability[];

  /**
   * Gets the fields a connection to this engine needs, in the order they are asked for.
   */
  readonly connectionFields: readonly ConnectionField[];
}

/**
 * The values a connection's fields hold, keyed by field id. Numbers and booleans travel as strings,
 * exactly as they are entered, and the engine parses them.
 */
export type ConnectionValues = Readonly<Record<string, string>>;

/**
 * The icons a tree node may ask for. A closed list of meanings, not of glyphs: Studio picks the glyph,
 * so every engine's tree reads in the same visual language.
 */
export type DatabaseNodeIcon =
  | 'server'
  | 'database'
  | 'schema'
  | 'folder'
  | 'table'
  | 'view'
  | 'column'
  | 'key'
  | 'index'
  | 'function'
  | 'trigger'
  | 'sequence'
  | 'label'
  | 'relationship'
  | 'property'
  | 'constraint';

/**
 * Something that can be done to a tree node, offered on its context menu.
 */
export interface DatabaseNodeAction {
  /**
   * Gets the action's identifier, handed back to the engine when it is chosen.
   */
  readonly id: string;

  /**
   * Gets the menu label.
   */
  readonly label: string;
}

/**
 * One name/value fact about a node, shown in the Properties panel.
 */
export interface DatabaseProperty {
  /**
   * Gets the property's name.
   */
  readonly name: string;

  /**
   * Gets the property's value, already formatted for reading.
   */
  readonly value: string;
}

/**
 * One node of the object tree. The engine decides the tree's whole shape: Studio never assumes there
 * is a "Tables" folder, which is what lets a graph database's labels and relationship types sit in the
 * same tree as a relational schema.
 */
export interface DatabaseNode {
  /**
   * Gets the node's path: an identifier the engine minted and Studio treats as opaque. It is handed
   * back to expand the node, act on it, or name the database a query runs against.
   */
  readonly path: string;

  /**
   * Gets the label shown in the tree.
   */
  readonly label: string;

  /**
   * Gets a muted detail shown after the label (a column's type, a folder's count).
   */
  readonly detail?: string;

  /**
   * Gets the node's icon.
   */
  readonly icon: DatabaseNodeIcon;

  /**
   * Gets whether the node has no children to expand.
   */
  readonly leaf: boolean;

  /**
   * Gets the database a query opened from this node runs against, when the engine reaches several.
   */
  readonly database?: string;

  /**
   * Gets the actions offered on the node's context menu.
   */
  readonly actions?: readonly DatabaseNodeAction[];

  /**
   * Gets the facts shown in the Properties panel when the node is selected.
   */
  readonly properties?: readonly DatabaseProperty[];
}

/**
 * A graph node, as a Cypher query returns one.
 */
export interface GraphNodeValue {
  readonly type: 'node';

  /**
   * Gets the node's identity within its database.
   */
  readonly id: string;

  /**
   * Gets the node's labels.
   */
  readonly labels: readonly string[];

  /**
   * Gets the node's properties.
   */
  readonly properties: Readonly<Record<string, DatabaseValue>>;
}

/**
 * A graph relationship, as a Cypher query returns one.
 */
export interface GraphRelationshipValue {
  readonly type: 'relationship';

  /**
   * Gets the relationship's identity within its database.
   */
  readonly id: string;

  /**
   * Gets the relationship's type.
   */
  readonly relationshipType: string;

  /**
   * Gets the identity of the node it starts at.
   */
  readonly start: string;

  /**
   * Gets the identity of the node it ends at.
   */
  readonly end: string;

  /**
   * Gets the relationship's properties.
   */
  readonly properties: Readonly<Record<string, DatabaseValue>>;
}

/**
 * A graph path: alternating nodes and the relationships between them.
 */
export interface GraphPathValue {
  readonly type: 'path';

  /**
   * Gets the nodes along the path, in order.
   */
  readonly nodes: readonly GraphNodeValue[];

  /**
   * Gets the relationships along the path, in order.
   */
  readonly relationships: readonly GraphRelationshipValue[];
}

/**
 * One cell of a result. Typed rather than stringly-typed, so the grid can right-align numbers, mark
 * NULL as NULL rather than as the word "null", and the Graph view can find nodes and relationships
 * without parsing text.
 */
export type DatabaseValue =
  | null
  | boolean
  | number
  | string
  | { readonly type: 'bigint'; readonly value: string }
  | { readonly type: 'bytes'; readonly size: number; readonly preview: string }
  | { readonly type: 'temporal'; readonly value: string }
  | { readonly type: 'json'; readonly value: unknown }
  | { readonly type: 'list'; readonly items: readonly DatabaseValue[] }
  | { readonly type: 'map'; readonly entries: Readonly<Record<string, DatabaseValue>> }
  | GraphNodeValue
  | GraphRelationshipValue
  | GraphPathValue;

/**
 * One column of a result set.
 */
export interface ResultColumn {
  /**
   * Gets the column's name.
   */
  readonly name: string;

  /**
   * Gets the engine's name for the column's type, when it knows one.
   */
  readonly type?: string;
}

/**
 * One result set: the rows one statement returned.
 */
export interface ResultSet {
  /**
   * Gets the result set's identifier, used to fetch more of its rows.
   */
  readonly id: string;

  /**
   * Gets the columns, in order.
   */
  readonly columns: readonly ResultColumn[];

  /**
   * Gets the rows delivered so far, each one cell per column.
   */
  readonly rows: readonly (readonly DatabaseValue[])[];

  /**
   * Gets how many rows the statement returned in all. More than {@link rows} holds when the result was
   * paged: the rest are kept by the engine and fetched on demand.
   */
  readonly totalRows: number;

  /**
   * Gets the line in the document the statement that produced this result started on, 1-based.
   */
  readonly line: number;
}

/**
 * How serious a query message is.
 */
export type QueryMessageSeverity = 'info' | 'warning' | 'error';

/**
 * One line of a query's Messages: a notice, a row count, an error.
 */
export interface QueryMessage {
  /**
   * Gets how serious the message is.
   */
  readonly severity: QueryMessageSeverity;

  /**
   * Gets the message text.
   */
  readonly text: string;

  /**
   * Gets the document line the message refers to, 1-based, when there is one.
   */
  readonly line?: number;
}

/**
 * What a query execution produced. Every outcome — including an error from the database — is an
 * answer, never a rejection: a syntax error is exactly what someone writing a query needs to see.
 */
export interface ExecuteOutcome {
  /**
   * Gets the execution's identifier.
   */
  readonly id: string;

  /**
   * Gets the result sets, one per row-returning statement, in order.
   */
  readonly resultSets: readonly ResultSet[];

  /**
   * Gets the messages, in order.
   */
  readonly messages: readonly QueryMessage[];

  /**
   * Gets how long the execution took, in milliseconds.
   */
  readonly elapsedMs: number;

  /**
   * Gets whether it stopped on an error.
   */
  readonly failed: boolean;

  /**
   * Gets whether it was cancelled.
   */
  readonly cancelled: boolean;
}

/**
 * Asks an engine to run some text.
 */
export interface ExecuteRequest {
  /**
   * Gets the execution's identifier, minted by Studio so it can cancel the execution.
   */
  readonly id: string;

  /**
   * Gets the session the text runs in.
   */
  readonly session: string;

  /**
   * Gets the text to run: a whole document or the selection.
   */
  readonly text: string;

  /**
   * Gets the line of the document the text starts on, 1-based, so the engine reports lines in the
   * document's terms rather than the selection's.
   */
  readonly firstLine: number;

  /**
   * Gets the database to run against, for an engine that reaches several; otherwise absent.
   */
  readonly database?: string;
}

/**
 * Asks an engine for more rows of a paged result set.
 */
export interface FetchRequest {
  /**
   * Gets the session the result belongs to.
   */
  readonly session: string;

  /**
   * Gets the result set's identifier.
   */
  readonly resultSet: string;

  /**
   * Gets the index of the first row wanted.
   */
  readonly offset: number;

  /**
   * Gets how many rows are wanted.
   */
  readonly count: number;
}

/**
 * What a node action produced: a script to open as a query, or a request to refresh a node.
 */
export type NodeActionOutcome =
  | {
      readonly kind: 'script';
      readonly title: string;
      readonly text: string;
      readonly database?: string;
      /**
       * Gets whether the script only reads (Select Top, Match Nodes), so Studio may run it as it opens
       * when the user has asked for that. A script that would change something never sets it.
       */
      readonly reads?: boolean;
    }
  | { readonly kind: 'refresh'; readonly path: string }
  | { readonly kind: 'failure'; readonly message: string };

/**
 * The answer to a connect or test: a session, or why there is none.
 */
export type ConnectOutcome =
  | {
      readonly kind: 'connected';
      readonly session: string;
      /**
       * Gets the server's own description of itself (`PostgreSQL 17.2`, `SQLite 3.53.3`).
       */
      readonly serverVersion: string;
    }
  | { readonly kind: 'failure'; readonly message: string };

/**
 * What a completion name is: what the list shows it as and sorts it by.
 */
export type CompletionNameKind =
  'schema' | 'table' | 'view' | 'function' | 'column' | 'label' | 'relationship' | 'property';

/**
 * One name a query may use, as the engine knows it (#1098).
 */
export interface CompletionName {
  /**
   * Gets the name, as it is written in a query.
   */
  readonly name: string;

  /**
   * Gets what it is.
   */
  readonly kind: CompletionNameKind;

  /**
   * Gets a short note shown beside it — a column's type, a table's schema.
   */
  readonly detail?: string;
}

/**
 * Which names a `names` request asks for: the objects a query reaches for first, or the members of one
 * object it names.
 */
export type NamesScope =
  | { readonly kind: 'objects' }
  | {
      readonly kind: 'members';
      /**
       * Gets the object, as the query names it — `orders`, `public.orders`, a label.
       */
      readonly of: string;
    };

/**
 * Asks an engine for names to complete with, for an engine that declares `completion`.
 */
export interface NamesRequest {
  /**
   * Gets the session.
   */
  readonly session: string;

  /**
   * Gets the database the query runs against, for an engine that reaches several.
   */
  readonly database?: string;

  /**
   * Gets which names.
   */
  readonly scope: NamesScope;
}

/**
 * The answer to an expand: the node's children, or why they could not be read.
 */
export type ExpandOutcome =
  | { readonly kind: 'nodes'; readonly nodes: readonly DatabaseNode[] }
  | { readonly kind: 'failure'; readonly message: string };

/**
 * What a plugin says about itself at `initialize`: the protocol it speaks, and the engine it is.
 */
export interface DatabaseEngineDescription {
  /**
   * Gets the protocol version the plugin speaks.
   */
  readonly protocol: string;

  /**
   * Gets what the engine says about itself.
   */
  readonly engine: DatabaseEngineInfo;
}

/**
 * Every operation, with what it takes and what it answers.
 */
export interface DatabaseEngineOperations {
  /**
   * Starts the plugin: the protocol Studio speaks; the answer says what engine it is.
   */
  readonly initialize: {
    readonly params: { readonly protocol: string };
    readonly result: DatabaseEngineDescription;
  };

  /**
   * Opens a connection with the field values given, secrets included, and answers with the plugin's
   * own session id, or why there is none. A failure to connect is an answer, not an error.
   */
  readonly connect: {
    readonly params: { readonly values: ConnectionValues };
    readonly result: ConnectOutcome;
  };

  /**
   * Closes a session.
   */
  readonly disconnect: { readonly params: { readonly session: string }; readonly result: boolean };

  /**
   * Lists a tree node's children; a null path lists the top of the tree.
   */
  readonly expand: {
    readonly params: { readonly session: string; readonly path: string | null };
    readonly result: ExpandOutcome;
  };

  /**
   * Runs text, statement by statement, and answers with each result set's first page and the messages.
   * A database error is part of the outcome, never a failed request.
   */
  readonly execute: { readonly params: ExecuteRequest; readonly result: ExecuteOutcome };

  /**
   * Reads more rows of a result set an execution kept.
   */
  readonly fetch: {
    readonly params: FetchRequest;
    readonly result: readonly (readonly DatabaseValue[])[];
  };

  /**
   * Stops a running execution, for an engine that declares `cancel`. The execution then answers as
   * cancelled.
   */
  readonly cancel: { readonly params: { readonly id: string }; readonly result: boolean };

  /**
   * Runs a node action.
   */
  readonly action: {
    readonly params: { readonly session: string; readonly path: string; readonly action: string };
    readonly result: NodeActionOutcome;
  };

  /**
   * Lists names to complete with (protocol 1.1, #1098), for an engine that declares `completion`. An
   * object that does not exist answers with no members rather than an error.
   */
  readonly names: { readonly params: NamesRequest; readonly result: readonly CompletionName[] };
}

/**
 * Identifies one operation.
 */
export type DatabaseEngineOp = keyof DatabaseEngineOperations;

/**
 * What an operation takes.
 */
export type DatabaseEngineParams<Op extends DatabaseEngineOp> =
  DatabaseEngineOperations[Op]['params'];

/**
 * What an operation answers.
 */
export type DatabaseEngineResult<Op extends DatabaseEngineOp> =
  DatabaseEngineOperations[Op]['result'];

/**
 * One request line.
 */
export interface DatabaseEngineRequest<Op extends DatabaseEngineOp = DatabaseEngineOp> {
  readonly id: number;
  readonly op: Op;
  readonly params: DatabaseEngineParams<Op>;
}

/**
 * One answer line.
 */
export type DatabaseEngineResponse<Op extends DatabaseEngineOp = DatabaseEngineOp> =
  | { readonly id: number; readonly ok: true; readonly result: DatabaseEngineResult<Op> }
  | { readonly id: number; readonly ok: false; readonly error: string };

/**
 * Determines whether a plugin's protocol version is one this build can speak: the same major version.
 * @param version The plugin's version.
 * @returns Returns true when it is compatible.
 */
export function isCompatibleDatabaseEngineProtocol(version: string): boolean {
  const major: string | undefined = version.split('.')[0];
  return major !== undefined && major === DATABASE_ENGINE_PROTOCOL.split('.')[0];
}
