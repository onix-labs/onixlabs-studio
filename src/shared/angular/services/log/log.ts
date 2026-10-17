import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  LogChannel,
  LogLevelSetting,
  LogQuery,
  LogRecord,
  LogSession,
  MAX_LOG_MESSAGE_LENGTH,
  meetsFloor,
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
 *
 * A record below the severity floor is dropped before its message is built or sent, so a suppressed
 * trace costs a comparison. The floor starts at the one the main process resolved for this launch
 * and follows the log level setting through {@link setLevel}.
 */
@Service()
export class Log {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Counts the live {@link onRecord} listeners, so the main process's record stream is subscribed
   * while the first is attached and withdrawn when the last detaches — a session with no log audit
   * open costs no record IPC at all.
   */
  private recordListeners: number = 0;

  /**
   * Holds the minimum severity forwarded: the floor the main process resolved when this window opened,
   * or `trace` outside Electron. A record below it is dropped before its message is built or sent.
   */
  private floor: Severity = window.host?.logFloor ?? 'trace';

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
   * Determines whether a severity is recorded at the current floor, so a caller can skip building an
   * expensive diagnostic that would only be dropped.
   * @param severity The severity to test.
   * @returns Returns true when records of the severity are kept.
   */
  public enabled(severity: Severity): boolean {
    return meetsFloor(severity, this.floor);
  }

  /**
   * Chooses the log level: the main process persists the choice, applies it, and replies with the
   * floor now in force, which this window adopts. The reply is what counts, not the choice — the
   * `STUDIO_LOG_LEVEL` environment variable overrides the setting for a launch. A no-op outside
   * Electron.
   * @param setting The log-level choice.
   * @returns Returns a promise resolving once the floor is in force.
   */
  public async setLevel(setting: LogLevelSetting): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    try {
      this.floor = await this.bridge.invoke<Severity>(LogChannel.SetLevel, setting);
    } catch {
      // A failed change leaves the current floor in force.
    }
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
   * Subscribes to newly-recorded log records pushed from the main process. Records arrive batched
   * per flush window; the listener is invoked once per record, oldest first. The first listener
   * opens the main-process stream ({@link LogChannel.Subscribe}) and the last to detach closes it,
   * so nothing is pushed while no one is watching.
   * @param listener The listener invoked with each new record.
   * @returns Returns a function that unsubscribes the listener; a no-op outside Electron.
   */
  public onRecord(listener: (record: LogRecord) => void): () => void {
    if (this.bridge === undefined) {
      return (): void => {
        // No bridge outside Electron; there is nothing to unsubscribe.
      };
    }
    const detach: () => void = this.bridge.on(LogChannel.Record, (...args: unknown[]): void => {
      for (const record of args[0] as readonly LogRecord[]) {
        listener(record);
      }
    });
    this.recordListeners += 1;
    if (this.recordListeners === 1) {
      this.sendSafely(LogChannel.Subscribe);
    }
    let detached: boolean = false;
    return (): void => {
      if (detached) {
        return;
      }
      detached = true;
      detach();
      this.recordListeners -= 1;
      if (this.recordListeners === 0) {
        this.sendSafely(LogChannel.Unsubscribe);
      }
    };
  }

  /**
   * Sends one payload-less message over the bridge, never letting a transport failure surface.
   * @param channel The channel to send on.
   */
  private sendSafely(channel: LogChannel): void {
    try {
      this.bridge?.send(channel);
    } catch {
      // A failed send is deliberately swallowed.
    }
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
    if (this.bridge === undefined || !this.enabled(severity)) {
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
