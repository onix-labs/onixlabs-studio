import {
  ConnectionValues,
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseValue,
  ExecuteRequest,
  NodeActionOutcome,
  QueryMessage,
  ResultColumn,
} from './protocol';

/**
 * A database engine as this plugin implements it: the database-engine protocol's requests one for
 * one — `initialize` is {@link info}, `connect` is {@link connect}, and a session answers `expand`,
 * `execute`, `cancel` and `action`. The host (`host.ts`) serves it over the plugin's standard streams
 * and keeps the sessions and the rows of large results.
 */
export interface DatabaseEngine {
  /**
   * Gets what the engine says about itself.
   */
  readonly info: DatabaseEngineInfo;

  /**
   * Opens a connection.
   * @param values The connection's field values, secrets included.
   * @returns Returns a promise resolving the session; it rejects with a message fit to show.
   */
  connect(values: ConnectionValues): Promise<EngineSession>;
}

/**
 * The rows one statement returned, before the host pages them out to Studio.
 */
export interface EngineResultSet {
  /**
   * Gets the columns.
   */
  readonly columns: readonly ResultColumn[];

  /**
   * Gets every row, up to the engine's row ceiling.
   */
  readonly rows: readonly (readonly DatabaseValue[])[];

  /**
   * Gets the line the statement started on.
   */
  readonly line: number;
}

/**
 * Everything an execution produced, before the host assigns result-set identifiers and pages the rows.
 */
export interface EngineExecution {
  readonly resultSets: readonly EngineResultSet[];
  readonly messages: readonly QueryMessage[];
  readonly failed: boolean;
  readonly cancelled: boolean;
}

/**
 * One open connection.
 */
export interface EngineSession {
  /**
   * Gets the server's own description of itself.
   */
  readonly serverVersion: string;

  /**
   * Lists a node's children.
   * @param path The node's path, or null for the top of the tree.
   * @returns Returns a promise resolving the children; it rejects with a message fit to show.
   */
  expand(path: string | null): Promise<readonly DatabaseNode[]>;

  /**
   * Runs text, statement by statement, stopping at the first error.
   * @param request The execution.
   * @returns Returns a promise resolving what it produced; it never rejects.
   */
  execute(request: ExecuteRequest): Promise<EngineExecution>;

  /**
   * Stops a running execution, when the engine can.
   * @param id The execution's identifier.
   */
  cancel(id: string): void;

  /**
   * Runs a node action.
   * @param path The node's path.
   * @param action The action's identifier.
   * @returns Returns a promise resolving what it produced.
   */
  action(path: string, action: string): Promise<NodeActionOutcome>;

  /**
   * Closes the connection.
   */
  close(): Promise<void>;
}

/**
 * The most rows a single result set holds. A query returning more is truncated with a message, rather
 * than allowed to exhaust the process — the explorer is for reading results, not for exporting tables.
 */
export const MAX_RESULT_ROWS: number = 100_000;

/**
 * Encodes a node path from its segments. Paths are opaque to Studio; inside an engine they are a JSON
 * array, which keeps names with any punctuation in them unambiguous.
 * @param segments The path's segments.
 * @returns Returns the encoded path.
 */
export function encodePath(...segments: readonly string[]): string {
  return JSON.stringify(segments);
}

/**
 * Decodes a node path into its segments.
 * @param path The encoded path.
 * @returns Returns the segments, or an empty list for a path this engine did not mint.
 */
export function decodePath(path: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(path);
    return Array.isArray(parsed) &&
      parsed.every((part: unknown): boolean => typeof part === 'string')
      ? (parsed as string[])
      : [];
  } catch {
    return [];
  }
}

/**
 * Renders a thrown value as a message fit to show the user.
 * @param error The thrown value.
 * @returns Returns the message.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Converts the bytes of a binary value into the typed cell the grid shows: its size and a short hex
 * preview, rather than the whole blob crossing IPC.
 * @param bytes The value's bytes.
 * @returns Returns the typed cell.
 */
export function bytesValue(bytes: Uint8Array): DatabaseValue {
  const preview: string = Array.from(bytes.subarray(0, 16))
    .map((byte: number): string => byte.toString(16).padStart(2, '0'))
    .join('');
  return { type: 'bytes', size: bytes.byteLength, preview };
}

/**
 * Converts a bigint into the typed cell the grid shows: a plain number when it fits exactly, and the
 * digits otherwise, so no row id is silently rounded.
 * @param value The value.
 * @returns Returns the typed cell.
 */
export function bigintValue(value: bigint): DatabaseValue {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : { type: 'bigint', value: value.toString() };
}

/**
 * Quotes an identifier for SQL with double quotes, doubling any it contains.
 * @param name The identifier.
 * @returns Returns the quoted identifier.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Reads a metadata cell as text: empty for NULL, the value itself for a primitive, and JSON for
 * anything structured — never `[object Object]`.
 * @param value The cell.
 * @returns Returns its text.
 */
export function text(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  return JSON.stringify(value) ?? '';
}
