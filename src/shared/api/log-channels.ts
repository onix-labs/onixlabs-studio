/**
 * Names the logging IPC channels and their payload contracts. This is the logging capability's slice
 * of the IPC contract: the renderer console forwarder, the renderer {@link import('../angular/services/log/log').Log}
 * service and the main-process logger all name their channels from here, over the generic
 * {@link import('./bridge').Bridge} transport. Logging lives in main because only the main process
 * can write files (dev runs log to stdout as well) and because it owns the per-session record store.
 */
export enum LogChannel {
  /**
   * Forwards one renderer console entry to the main-process logger (renderer→main, fire-and-forget).
   * The payload is a {@link LogEntry}; the main process maps its console level onto a {@link Severity}.
   */
  Write = 'log:write',

  /**
   * Forwards one structured renderer log record to the main-process logger (renderer→main,
   * fire-and-forget). The payload is a {@link StructuredLogInput} carrying a real {@link Severity} and
   * source ("Where"); the main process stamps the session, timestamp and origin window.
   */
  Append = 'log:append',

  /**
   * Pushes newly-recorded records to the subscribed renderers (main→renderer). The payload is a
   * readonly {@link LogRecord} array — records are coalesced on a short flush window so a burst of
   * logging costs one IPC delivery, not one per record. Drives the System Monitor's live log audit,
   * and is only sent while at least one renderer holds a {@link Subscribe}.
   */
  Record = 'log:record',

  /**
   * Registers the sending renderer for {@link Record} pushes (renderer→main, fire-and-forget). The
   * renderer Log service sends this when its first live-record listener attaches, so windows that
   * show no log audit never pay for the stream.
   */
  Subscribe = 'log:subscribe',

  /**
   * Withdraws the sending renderer's {@link Subscribe} (renderer→main, fire-and-forget). Sent when
   * the renderer Log service's last live-record listener detaches.
   */
  Unsubscribe = 'log:unsubscribe',

  /**
   * Queries the current session's buffered records, optionally filtered (renderer→main, request/reply).
   * The payload is a {@link LogQuery}; the reply is a readonly {@link LogRecord} array.
   */
  Query = 'log:query',

  /**
   * Lists the known app sessions, newest first (renderer→main, request/reply). The reply is a readonly
   * {@link LogSession} array.
   */
  Sessions = 'log:sessions',
}

/**
 * Names the console severities the legacy forwarder emits, mirroring the intercepted console methods.
 * Distinct from {@link Severity}: this is the console-shaped level carried by {@link LogEntry}, which
 * the main process maps onto a {@link Severity} via {@link consoleLevelToSeverity}.
 */
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/**
 * Holds every accepted {@link LogLevel}, for validation on the receiving side.
 */
export const LOG_LEVELS: readonly LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

/**
 * Names the application's log severities, ordered least to most severe. This is the taxonomy the log
 * audit surfaces and filters on; console levels are mapped onto it and structured logs emit it
 * directly.
 */
export type Severity = 'trace' | 'debug' | 'info' | 'warning' | 'error';

/**
 * Holds every {@link Severity} in ascending order of severity, for validation and filter ordering.
 */
export const SEVERITIES: readonly Severity[] = ['trace', 'debug', 'info', 'warning', 'error'];

/**
 * Names the process a {@link LogRecord} originated in.
 */
export type LogOrigin = 'main' | 'renderer';

/**
 * Caps a single forwarded message's length. The sender truncates before the IPC hop so an enormous
 * console payload (for example a dumped object graph) cannot bloat the message or the log file; the
 * receiver enforces the same cap on untrusted input.
 */
export const MAX_LOG_MESSAGE_LENGTH: number = 8192;

/**
 * Defines one forwarded console entry (the legacy {@link LogChannel.Write} payload).
 */
export interface LogEntry {
  /**
   * Gets the console severity the entry was emitted with.
   */
  readonly level: LogLevel;

  /**
   * Gets the already-serialised, length-capped message text.
   */
  readonly message: string;
}

/**
 * Defines one structured log emitted by the renderer {@link LogChannel.Append} channel. The main
 * process supplies the session, timestamp, origin and window; the renderer supplies only what it
 * alone knows.
 */
export interface StructuredLogInput {
  /**
   * Gets the severity the record is emitted with.
   */
  readonly severity: Severity;

  /**
   * Gets the source of the record — the "Where" (for example a component or service name). Length is
   * capped by the receiver.
   */
  readonly source: string;

  /**
   * Gets the already-serialised, length-capped message text.
   */
  readonly message: string;
}

/**
 * Defines one persisted, queryable log record: the shape of a row in the System Monitor's audit
 * table. Records are collected per app session, held in a bounded in-memory buffer and appended to a
 * per-session JSONL file.
 */
export interface LogRecord {
  /**
   * Gets the record's identifier, monotonic within its session.
   */
  readonly id: number;

  /**
   * Gets the identifier of the app session the record belongs to.
   */
  readonly sessionId: string;

  /**
   * Gets the time the record was created, as an ISO-8601 string.
   */
  readonly timestamp: string;

  /**
   * Gets the record's severity.
   */
  readonly severity: Severity;

  /**
   * Gets the process the record originated in.
   */
  readonly origin: LogOrigin;

  /**
   * Gets a label for the renderer window the record came from (for example `main` or `window-3`), or
   * undefined for main-process records.
   */
  readonly window?: string;

  /**
   * Gets the source of the record — the "Where". For auto-captured console output this is coarse
   * (`console`); structured logs supply a meaningful source.
   */
  readonly source: string;

  /**
   * Gets the record's message text.
   */
  readonly message: string;
}

/**
 * Describes a filter over the current session's records for {@link LogChannel.Query}. Omitted fields
 * do not constrain the result.
 */
export interface LogQuery {
  /**
   * Gets the session to query; defaults to the current session when omitted.
   */
  readonly sessionId?: string;

  /**
   * Gets the severities to include; all severities are included when omitted or empty.
   */
  readonly severities?: readonly Severity[];

  /**
   * Gets a case-insensitive substring the message or source must contain.
   */
  readonly text?: string;

  /**
   * Gets the maximum number of records to return, newest kept; unbounded when omitted.
   */
  readonly limit?: number;
}

/**
 * Describes one known app session for {@link LogChannel.Sessions}.
 */
export interface LogSession {
  /**
   * Gets the session identifier.
   */
  readonly id: string;

  /**
   * Gets the time the session started, as an ISO-8601 string.
   */
  readonly startedAt: string;

  /**
   * Gets a value indicating whether this is the current (live) session.
   */
  readonly current: boolean;
}

/**
 * Maps a console {@link LogLevel} onto the application {@link Severity} taxonomy. `log` and `info`
 * both surface as informational; `warn` becomes a warning; the rest map by name.
 * @param level The console level to map.
 * @returns Returns the corresponding severity.
 */
export function consoleLevelToSeverity(level: LogLevel): Severity {
  switch (level) {
    case 'error':
      return 'error';
    case 'warn':
      return 'warning';
    case 'debug':
      return 'debug';
    default:
      return 'info';
  }
}
