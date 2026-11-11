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

// 1.5 (#1099) adds the `explain` capability and request: a statement's plan as a common tree of steps
// (operator, detail, estimated cost and rows, actual rows and time when analyzed, and the engine's own
// facts), with the engine's raw plan beside it. Studio only asks an engine that declares `explain`, so
// a 1.4 engine is still spoken to.

/**
 * The protocol version this build speaks. A plugin answering with a different major version is
 * refused; a newer minor is accepted, and its additions go unused.
 */
export const DATABASE_ENGINE_PROTOCOL: string = '1.5';

/**
 * The capabilities an engine may declare. A closed list: Studio only offers what it knows how to
 * drive, and an engine only claims what it implements.
 *
 * - `cancel` — a running query can be stopped part-way.
 * - `multipleDatabases` — one connection reaches several databases (PostgreSQL, Neo4j), so the tree
 *   lists them and a query document can name which one it runs against.
 * - `script` — node actions can produce a script (Select Top N, Script as CREATE) to open as a query.
 * - `graph` — results may carry nodes, relationships and paths, so the Graph view is offered.
 * - `transactions` — an execution can leave a transaction open for a later `transaction` request to
 *   commit or roll back (protocol 1.4).
 * - `explain` — the engine can say how it would run a statement, as a tree of plan steps, through the
 *   `explain` request (protocol 1.5, #1099).
 */
export type DatabaseEngineCapability =
  'cancel' | 'multipleDatabases' | 'script' | 'graph' | 'completion' | 'transactions' | 'explain';

/**
 * The kinds of connection field an engine may ask for. A closed list, rendered by Studio's own form
 * atoms: an engine describes the field, it never draws it.
 */
export type ConnectionFieldKind = 'text' | 'number' | 'password' | 'file' | 'boolean' | 'choice';

/**
 * Where a connection field belongs in the connection dialog (#1121). A closed list, so every engine's
 * dialog reads alike: Studio draws `server` and `authentication` on its Login tab and the rest on its
 * Connection Properties tab, each section in this order. A field that names none is on Login.
 *
 * - `server`: where to connect — a host and port, an address, a file.
 * - `authentication`: who connects — a user, a password.
 * - `database`: which database, for an engine that reaches several.
 * - `security`: how the connection is protected — encryption, certificates.
 * - `options`: anything else about how it is opened.
 */
export type ConnectionFieldSection =
  'server' | 'authentication' | 'database' | 'security' | 'options';

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

  /**
   * Gets the dialog section the field belongs in (protocol 1.2); Login when absent.
   */
  readonly section?: ConnectionFieldSection;

  /**
   * Gets whether the field sits on the same line as the one before it, as a port does beside its host
   * (protocol 1.2). It is drawn narrower, and only when the two are in the same section.
   */
  readonly inline?: boolean;
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
 * How Studio wants a connection opened (protocol 1.4). All optional: an engine falls back on its own
 * defaults for anything absent.
 */
export interface ConnectOptions {
  /**
   * Gets how long to wait for the server, in milliseconds. An engine with no server ignores it.
   */
  readonly timeoutMs?: number;
}

/**
 * How Studio wants the object tree described (protocol 1.4).
 */
export interface TreeOptions {
  /**
   * Gets whether the tree lists the engine's own system schemas and objects.
   */
  readonly systemObjects?: boolean;

  /**
   * Gets how many nodes or relationships a Match action reads, for a graph engine.
   */
  readonly matchCount?: number;
}

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
 * The kind of key a result column belongs to (protocol 1.3): the table's primary key, a key the table
 * also holds unique (a unique constraint, or a unique index with no constraint of its own), or a
 * reference to another table's key.
 */
export type ResultColumnKeyKind = 'primary' | 'unique' | 'foreign';

/**
 * One key a result column belongs to (protocol 1.3). A key over several columns is reported on each of
 * them.
 */
export interface ResultColumnKey {
  /**
   * Gets the kind of key.
   */
  readonly kind: ResultColumnKeyKind;

  /**
   * Gets the key's name: its constraint's, or its index's.
   */
  readonly name: string;
}

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

  /**
   * Gets the keys the column belongs to, when it is a table's column the engine can trace (protocol
   * 1.3): the primary key first. Absent, or empty, for a column that is in no key or is computed.
   */
  readonly keys?: readonly ResultColumnKey[];
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

  /**
   * Gets whether a transaction it began or carried on is still open (protocol 1.4), when it ran under
   * {@link ExecuteOptions.manualTransaction}.
   */
  readonly transactionOpen?: boolean;
}

/**
 * How Studio wants one execution run (protocol 1.4). All optional: absent keeps what an engine did
 * before them.
 */
export interface ExecuteOptions {
  /**
   * Gets how long it may run, in milliseconds; 0 for no limit.
   */
  readonly timeoutMs?: number;

  /**
   * Gets whether the statements after one that fails still run.
   */
  readonly continueOnError?: boolean;

  /**
   * Gets the most rows a result set keeps.
   */
  readonly maxRows?: number;

  /**
   * Gets how many rows of a result set travel with the execution's answer.
   */
  readonly pageRows?: number;

  /**
   * Gets whether the text runs inside a transaction left open for a `transaction` request, for an
   * engine that declares `transactions`.
   */
  readonly manualTransaction?: boolean;
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

  /**
   * Gets how to run it (protocol 1.4).
   */
  readonly options?: ExecuteOptions;
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
    readonly params: { readonly values: ConnectionValues; readonly options?: ConnectOptions };
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
    readonly params: {
      readonly session: string;
      readonly path: string | null;
      readonly options?: TreeOptions;
    };
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
    readonly params: {
      readonly session: string;
      readonly path: string;
      readonly action: string;
      readonly options?: TreeOptions;
    };
    readonly result: NodeActionOutcome;
  };

  /**
   * Lists names to complete with (protocol 1.1, #1098), for an engine that declares `completion`. An
   * object that does not exist answers with no members rather than an error.
   */
  readonly names: { readonly params: NamesRequest; readonly result: readonly CompletionName[] };

  /**
   * Commits or rolls back the transaction an execution left open (protocol 1.4), for an engine that
   * declares `transactions`.
   */
  readonly transaction: {
    readonly params: TransactionRequest;
    readonly result: TransactionOutcome;
  };

  /**
   * Says how the engine would run each statement of the text, as a tree of plan steps (protocol 1.5,
   * #1099), for an engine that declares `explain`. A database error is part of the outcome, never a
   * failed request.
   */
  readonly explain: { readonly params: ExplainRequest; readonly result: ExplainOutcome };
}

/**
 * Identifies one operation.
 */
export type DatabaseEngineOp = keyof DatabaseEngineOperations;

/**
 * What to do with a transaction left open.
 */
export type TransactionAction = 'commit' | 'rollback';

/**
 * Asks an engine to end the transaction an execution left open (protocol 1.4).
 */
export interface TransactionRequest {
  /**
   * Gets the session.
   */
  readonly session: string;

  /**
   * Gets what to do with it.
   */
  readonly action: TransactionAction;

  /**
   * Gets the database it is open on, for an engine that reaches several.
   */
  readonly database?: string;
}

/**
 * What ending a transaction came to. A database error is an answer, never a failed request.
 */
export interface TransactionOutcome {
  /**
   * Gets whether it failed.
   */
  readonly failed: boolean;

  /**
   * Gets what happened, fit to show.
   */
  readonly message: string;
}

/**
 * Asks an engine how it would run some text (protocol 1.5, #1099).
 */
export interface ExplainRequest {
  /**
   * Gets the session.
   */
  readonly session: string;

  /**
   * Gets the text, one statement or several.
   */
  readonly text: string;

  /**
   * Gets the database to plan it against, for an engine that reaches several.
   */
  readonly database?: string;

  /**
   * Gets whether to run the statements and report what actually happened (`EXPLAIN ANALYZE`,
   * `PROFILE`) rather than only the planner's estimates. ⚠️ Analyzing executes the statements, writes
   * included, so a caller asks the user first wherever running them would.
   */
  readonly analyze?: boolean;
}

/**
 * One step of a query plan: what the engine does, its estimates, and the steps feeding it.
 */
export interface PlanNode {
  /**
   * Gets the step's operator, in the engine's own words: `Seq Scan`, `SEARCH users USING INDEX`,
   * `NodeByLabelScan`.
   */
  readonly operator: string;

  /**
   * Gets what it works on and how, when the engine says: a table, an index, a condition.
   */
  readonly detail?: string;

  /**
   * Gets the planner's estimated cost, in the engine's own units.
   */
  readonly cost?: number;

  /**
   * Gets the planner's estimated row count.
   */
  readonly estimatedRows?: number;

  /**
   * Gets the rows the step actually produced, when the plan was analyzed.
   */
  readonly actualRows?: number;

  /**
   * Gets the time the step took, in milliseconds, when the plan was analyzed and the engine times it.
   */
  readonly time?: number;

  /**
   * Gets everything else the engine reports about the step, as name and value pairs to show.
   */
  readonly properties?: readonly PlanProperty[];

  /**
   * Gets the steps feeding this one, in the engine's order.
   */
  readonly children: readonly PlanNode[];
}

/**
 * One fact about a plan step, fit to show as it is.
 */
export interface PlanProperty {
  /**
   * Gets its name.
   */
  readonly name: string;

  /**
   * Gets its value, as text.
   */
  readonly value: string;
}

/**
 * The plan of one statement.
 */
export interface QueryPlan {
  /**
   * Gets the statement's text.
   */
  readonly statement: string;

  /**
   * Gets the line it starts on, counting from 1, within the text sent.
   */
  readonly line: number;

  /**
   * Gets the plan's top step.
   */
  readonly root: PlanNode;

  /**
   * Gets the engine's own plan, as it gave it (JSON or text), for a view that shows it raw.
   */
  readonly raw: string;
}

/**
 * What explaining some text came to. A database error is an answer, never a failed request.
 */
export interface ExplainOutcome {
  /**
   * Gets the plan of each statement, in order, up to the one that failed.
   */
  readonly plans: readonly QueryPlan[];

  /**
   * Gets whether a statement could not be explained.
   */
  readonly failed: boolean;

  /**
   * Gets why, when one could not, fit to show.
   */
  readonly message?: string;
}

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
