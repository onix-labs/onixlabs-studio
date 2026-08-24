import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  LogChannel,
  LogQuery,
  LogRecord,
  LogSession,
  MAX_LOG_MESSAGE_LENGTH,
  Severity,
} from '@shared/api/log-channels';
import { appendDetails } from '@shared/api/log-format';

/**
 * The renderer's structured logging client: a thin, typed wrapper over the generic {@link Bridge} for
 * the {@link LogChannel} slice. Renderer code logs through {@link trace}/{@link debug}/{@link info}/
 * {@link warn}/{@link error} with a real source ("Where"); the System Monitor reads the audit through
 * {@link query}, {@link sessions} and {@link onRecord}.
 *
 * This is the structured complement to the ConsoleForwarder: the forwarder captures every `console.*`
 * automatically as a baseline (with a coarse `console` source), while this service is adopted at call
 * sites that want a meaningful source and an explicit severity. Outside Electron the bridge is absent
 * and every method degrades to a safe no-op.
 */
@Service()
export class Log {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Records a trace-severity log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public trace(source: string, message: string, ...details: unknown[]): void {
    this.emit('trace', source, message, details);
  }

  /**
   * Records a debug-severity log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public debug(source: string, message: string, ...details: unknown[]): void {
    this.emit('debug', source, message, details);
  }

  /**
   * Records an info-severity log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public info(source: string, message: string, ...details: unknown[]): void {
    this.emit('info', source, message, details);
  }

  /**
   * Records a warning-severity log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public warn(source: string, message: string, ...details: unknown[]): void {
    this.emit('warning', source, message, details);
  }

  /**
   * Records an error-severity log. The conventional way to record a caught exception:
   * `log.error(source, 'what failed', err)`.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public error(source: string, message: string, ...details: unknown[]): void {
    this.emit('error', source, message, details);
  }

  /**
   * Queries the log audit.
   * @param query The filter to apply; defaults to the whole current session.
   * @returns Returns the matching records, newest last, or an empty list when unavailable.
   */
  public query(query: LogQuery = {}): Promise<LogRecord[]> {
    return this.bridge?.invoke<LogRecord[]>(LogChannel.Query, query) ?? Promise.resolve([]);
  }

  /**
   * Lists the known app sessions, newest first.
   * @returns Returns the sessions, or an empty list when unavailable.
   */
  public sessions(): Promise<LogSession[]> {
    return this.bridge?.invoke<LogSession[]>(LogChannel.Sessions) ?? Promise.resolve([]);
  }

  /**
   * Subscribes to newly-recorded log records pushed from the main process.
   * @param listener The listener invoked with each new record.
   * @returns Returns a function that unsubscribes the listener; a no-op outside Electron.
   */
  public onRecord(listener: (record: LogRecord) => void): () => void {
    return (
      this.bridge?.on(LogChannel.Record, (...args: unknown[]): void =>
        listener(args[0] as LogRecord),
      ) ??
      ((): void => {
        // No bridge outside Electron; there is nothing to unsubscribe.
      })
    );
  }

  /**
   * Forwards one structured log over the bridge, never letting a logging failure surface to the
   * caller — logging must not be able to break the app.
   * @param severity The severity to record.
   * @param source The source of the record.
   * @param message The message text.
   * @param details The detail values appended to the message.
   */
  private emit(
    severity: Severity,
    source: string,
    message: string,
    details: readonly unknown[],
  ): void {
    if (this.bridge === undefined) {
      return;
    }
    try {
      this.bridge.send(LogChannel.Append, {
        severity,
        source,
        message: appendDetails(message, details).slice(0, MAX_LOG_MESSAGE_LENGTH),
      });
    } catch {
      // A failed forward is deliberately swallowed.
    }
  }
}
