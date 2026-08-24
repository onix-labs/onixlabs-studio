import {
  LogOrigin,
  LogQuery,
  LogRecord,
  MAX_LOG_MESSAGE_LENGTH,
  Severity,
} from '@shared/api/log-channels';

/**
 * Caps a record's source ("Where") length, so a runaway source string cannot bloat a record.
 */
const MAX_SOURCE_LENGTH: number = 256;

/**
 * Describes the fields a caller supplies when recording a log; the store stamps the session, id and
 * timestamp.
 */
export interface LogInput {
  /**
   * Gets the process the record originated in.
   */
  readonly origin: LogOrigin;

  /**
   * Gets the severity to record.
   */
  readonly severity: Severity;

  /**
   * Gets the source of the record — the "Where".
   */
  readonly source: string;

  /**
   * Gets the message text.
   */
  readonly message: string;

  /**
   * Gets a label for the renderer window the record came from, or undefined for main-process records.
   */
  readonly window?: string;
}

/**
 * Holds one app session's log records: an in-memory ring buffer bounded to a cap, with monotonic
 * record identifiers and pure query filtering. This is the logic core of the logger, deliberately free
 * of the electron and filesystem modules so it is unit-testable in isolation (the {@link import('./logger').Logger}
 * wraps it with the IPC, persistence and broadcast side effects).
 */
export class LogStore {
  /**
   * Holds the session's records, newest last, bounded to {@link max}.
   */
  private readonly records: LogRecord[] = [];

  /**
   * Holds the last record identifier minted; identifiers are monotonic within the session.
   */
  private sequence: number = 0;

  /**
   * Initializes a new instance of the {@link LogStore} class.
   * @param sessionId The identifier of the session the records belong to.
   * @param max The maximum number of records held before the oldest is evicted.
   * @param now Returns the current time as an ISO-8601 string; injectable so tests are deterministic.
   */
  public constructor(
    private readonly sessionId: string,
    private readonly max: number = 5000,
    private readonly now: () => string = (): string => new Date().toISOString(),
  ) {}

  /**
   * Gets the session identifier the store records under.
   */
  public get id(): string {
    return this.sessionId;
  }

  /**
   * Builds a record from an input, stamping the session, a monotonic id and the timestamp, appends it
   * to the buffer (evicting the oldest past the cap) and returns it.
   * @param input The record fields the caller supplies.
   * @returns Returns the built record.
   */
  public add(input: LogInput): LogRecord {
    const record: LogRecord = {
      id: (this.sequence += 1),
      sessionId: this.sessionId,
      timestamp: this.now(),
      severity: input.severity,
      origin: input.origin,
      window: input.window,
      source: input.source.slice(0, MAX_SOURCE_LENGTH),
      message: input.message.slice(0, MAX_LOG_MESSAGE_LENGTH),
    };
    this.records.push(record);
    if (this.records.length > this.max) {
      this.records.shift();
    }
    return record;
  }

  /**
   * Gets the session's buffered records, newest last.
   * @returns Returns the records.
   */
  public current(): readonly LogRecord[] {
    return this.records;
  }

  /**
   * Filters records by a query: by severity set, by a case-insensitive substring of the source or
   * message, and to a trailing limit. Pure — the same logic serves the live buffer and a reloaded
   * past session.
   * @param records The records to filter.
   * @param query The filter to apply; an empty query returns the records unchanged.
   * @returns Returns the matching records, newest last.
   */
  public static filter(records: readonly LogRecord[], query: LogQuery): LogRecord[] {
    const severities: ReadonlySet<Severity> | null =
      query.severities && query.severities.length > 0 ? new Set(query.severities) : null;
    const needle: string | null = query.text ? query.text.toLowerCase() : null;
    const matched: LogRecord[] = records.filter((record: LogRecord): boolean => {
      if (severities !== null && !severities.has(record.severity)) {
        return false;
      }
      if (needle !== null && !`${record.source} ${record.message}`.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
    return query.limit !== undefined && query.limit >= 0 ? matched.slice(-query.limit) : matched;
  }
}
