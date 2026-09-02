import * as path from 'node:path';
import { app, ipcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import {
  consoleLevelToSeverity,
  LOG_LEVELS,
  LogChannel,
  LogEntry,
  LogLevel,
  LogOrigin,
  LogQuery,
  LogRecord,
  LogSession,
  SEVERITIES,
  StructuredLogInput,
} from '@shared/api/log-channels';
import { appendDetails } from '@shared/api/log-format';
import { LogArchive } from '@shared/electron/log-archive';
import { LogInput, LogStore } from '@shared/electron/log-store';

/**
 * Holds the flush window: how long side effects (disk appends, the renderer push) may coalesce
 * before they land. Short enough that the live audit still reads as live; long enough that a
 * watcher-driven trace storm costs a handful of writes per second instead of thousands.
 */
const FLUSH_INTERVAL_MS: number = 250;

/**
 * Caps how many lines may sit unflushed; a burst that outruns the flush window flushes early rather
 * than letting the buffers grow without bound.
 */
const MAX_PENDING_LINES: number = 512;

/**
 * Collects application log records for the current app session and serves the log audit.
 *
 * This is the thin electron adapter over two electron-free cores: the {@link LogStore} holds the live
 * per-session ring buffer and the query logic, and the {@link LogArchive} persists and reloads records
 * on disk. Every record is buffered immediately (the live audit source); its side effects are
 * coalesced on a short flush window so a logging burst costs one filesystem append per stream and one
 * IPC delivery, not four synchronous syscalls and a broadcast per record — which is what made heavy
 * trace traffic lag the whole app in packaged builds. On flush, records land in the session's
 * `logs/sessions/<sessionId>.jsonl` file, the human-readable lines land on stdout in development or
 * the rotating `studio.log` in packaged builds, and the batch is pushed only to renderers holding a
 * {@link LogChannel.Subscribe} — a window with no log audit open pays nothing. An error record
 * flushes immediately: a failure's context must be durable before anything else goes wrong, so
 * crash-adjacent records are never sitting in a buffer.
 *
 * Main-process code logs directly through {@link log} (or the {@link info}/{@link warn}/… helpers). The
 * renderer's console methods are intercepted by the ConsoleForwarder and arrive over
 * {@link LogChannel.Write}; the renderer's structured Log service arrives over {@link LogChannel.Append}.
 */
export class Logger {
  /**
   * Holds the current app session's identifier: a sortable timestamp with the process id appended so
   * concurrent instances cannot collide.
   */
  private readonly sessionId: string = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;

  /**
   * Holds the time the current session started, as an ISO-8601 string.
   */
  private readonly startedAt: string = new Date().toISOString();

  /**
   * Holds the session's records and the query logic.
   */
  private readonly store: LogStore = new LogStore(this.sessionId);

  /**
   * Holds the on-disk archive, created lazily so the user-data path is resolved only after the app is
   * ready.
   */
  private archiveInstance: LogArchive | null = null;

  /**
   * Resolves the web-contents identifier of the main window, so renderer records can be labelled
   * `main` versus a pop-out `window-<id>`. Null until wired by the main process.
   */
  private mainWebContentsId: (() => number | null) | null = null;

  /**
   * Holds the renderers subscribed to live record pushes. Only these receive
   * {@link LogChannel.Record} batches; with the set empty the broadcast side effect is skipped
   * entirely (records stay queryable through {@link LogChannel.Query}).
   */
  private readonly subscribers: Set<WebContents> = new Set<WebContents>();

  /**
   * Holds the records awaiting the next broadcast flush, oldest first.
   */
  private pendingBroadcast: LogRecord[] = [];

  /**
   * Holds the pending flush timer, or null when nothing is scheduled. Unref'd so an idle buffer
   * never holds the process open.
   */
  private flushTimer: NodeJS.Timeout | null = null;

  /**
   * Wires the resolver used to label renderer records by their originating window.
   * @param resolver Returns the main window's web-contents identifier, or null when unavailable.
   */
  public useMainWindow(resolver: () => number | null): void {
    this.mainWebContentsId = resolver;
  }

  /**
   * Registers the logging IPC channels: the renderer console forwarder ({@link LogChannel.Write}), the
   * renderer structured Log service ({@link LogChannel.Append}), and the audit queries
   * ({@link LogChannel.Query}, {@link LogChannel.Sessions}). All renderer payloads are untrusted and
   * validated before a record is created.
   */
  public register(): void {
    ipcMain.on(LogChannel.Write, (event: IpcMainEvent, entry: unknown): void => {
      const candidate: Partial<LogEntry> = (entry as Partial<LogEntry> | null) ?? {};
      if (!LOG_LEVELS.includes(candidate.level!) || typeof candidate.message !== 'string') {
        return;
      }
      this.log({
        origin: 'renderer',
        severity: consoleLevelToSeverity(candidate.level!),
        source: 'console',
        message: candidate.message,
        window: this.windowLabel(event.sender),
      });
    });

    ipcMain.on(LogChannel.Append, (event: IpcMainEvent, input: unknown): void => {
      const candidate: Partial<StructuredLogInput> =
        (input as Partial<StructuredLogInput> | null) ?? {};
      if (
        !SEVERITIES.includes(candidate.severity!) ||
        typeof candidate.source !== 'string' ||
        typeof candidate.message !== 'string'
      ) {
        return;
      }
      this.log({
        origin: 'renderer',
        severity: candidate.severity!,
        source: candidate.source,
        message: candidate.message,
        window: this.windowLabel(event.sender),
      });
    });

    ipcMain.handle(
      LogChannel.Query,
      (_event: IpcMainInvokeEvent, query: unknown): readonly LogRecord[] =>
        this.query((query as LogQuery | null) ?? {}),
    );

    ipcMain.handle(LogChannel.Sessions, (): readonly LogSession[] => this.sessions());

    ipcMain.on(LogChannel.Subscribe, (event: IpcMainEvent): void => {
      const sender: WebContents = event.sender;
      if (this.subscribers.has(sender)) {
        return;
      }
      this.subscribers.add(sender);
      sender.once('destroyed', (): void => {
        this.subscribers.delete(sender);
      });
    });

    ipcMain.on(LogChannel.Unsubscribe, (event: IpcMainEvent): void => {
      this.subscribers.delete(event.sender);
    });
  }

  /**
   * Records one structured log: buffers it into the live audit immediately, and enqueues the disk
   * and broadcast side effects for the next flush window. An error record flushes immediately so its
   * context is durable before anything else goes wrong. Never throws — logging must not be able to
   * take the app down.
   * @param input The record's origin, severity, source, message and optional originating window.
   */
  public log(input: LogInput): void {
    const record: LogRecord = this.store.add(input);
    // Each side effect is independently guarded: logging must never throw, even before the app is
    // ready (when `app.getPath`/`app.isPackaged` are unusable) or outside the Electron runtime.
    try {
      this.archive.enqueue(record);
    } catch {
      // A persistence failure is deliberately swallowed.
    }
    this.emitHuman(record);
    if (this.subscribers.size > 0) {
      this.pendingBroadcast.push(record);
    }
    if (record.severity === 'error' || this.pendingLines() >= MAX_PENDING_LINES) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Lands every enqueued side effect now: the batched disk appends and the batched renderer push.
   * Called on the flush window, immediately for an error record, and by the main process's teardown
   * so the final records of a session are never lost to the buffer. Never throws.
   */
  public flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      this.archive.flush();
    } catch {
      // An unavailable archive (before ready / outside Electron) is deliberately swallowed.
    }
    if (this.pendingBroadcast.length > 0) {
      const batch: readonly LogRecord[] = this.pendingBroadcast;
      this.pendingBroadcast = [];
      this.broadcast(batch);
    }
  }

  /**
   * Schedules a flush one window from now, unless one is already pending. The timer is unref'd so a
   * quiet buffer never keeps the process alive.
   */
  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout((): void => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref();
  }

  /**
   * Counts the lines awaiting a flush across the archive and broadcast buffers. Never throws.
   * @returns Returns the pending line count, or the broadcast backlog alone when the archive is
   * unavailable.
   */
  private pendingLines(): number {
    try {
      return this.archive.pendingCount + this.pendingBroadcast.length;
    } catch {
      return this.pendingBroadcast.length;
    }
  }

  /**
   * Writes one legacy console-shaped entry. Retained for existing main-process callers; maps the
   * console level onto a severity and records it with a coarse source.
   * @param origin The process the entry originated from.
   * @param level The console severity of the entry.
   * @param message The message text.
   */
  public write(origin: LogOrigin, level: LogLevel, message: string): void {
    this.log({ origin, severity: consoleLevelToSeverity(level), source: origin, message });
  }

  /**
   * Records a trace-severity main-process log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public trace(source: string, message: string, ...details: unknown[]): void {
    this.log({
      origin: 'main',
      severity: 'trace',
      source,
      message: appendDetails(message, details),
    });
  }

  /**
   * Records a debug-severity main-process log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public debug(source: string, message: string, ...details: unknown[]): void {
    this.log({
      origin: 'main',
      severity: 'debug',
      source,
      message: appendDetails(message, details),
    });
  }

  /**
   * Records an info-severity main-process log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public info(source: string, message: string, ...details: unknown[]): void {
    this.log({
      origin: 'main',
      severity: 'info',
      source,
      message: appendDetails(message, details),
    });
  }

  /**
   * Records a warning-severity main-process log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public warn(source: string, message: string, ...details: unknown[]): void {
    this.log({
      origin: 'main',
      severity: 'warning',
      source,
      message: appendDetails(message, details),
    });
  }

  /**
   * Records an error-severity main-process log. The conventional way to record a caught exception:
   * `logger.error(source, 'what failed', err)`.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   * @param details Extra values appended to the message; an `Error` keeps its stack.
   */
  public error(source: string, message: string, ...details: unknown[]): void {
    this.log({
      origin: 'main',
      severity: 'error',
      source,
      message: appendDetails(message, details),
    });
  }

  /**
   * Gets the directory the log files live in.
   * @returns Returns the `logs` directory under the application's user data.
   */
  public get logDirectory(): string {
    return path.join(app.getPath('userData'), 'logs');
  }

  /**
   * Returns records matching a query. The current session is served from the in-memory buffer; a past
   * session is read from its JSONL file.
   * @param query The filter to apply; an empty query returns the whole current session.
   * @returns Returns the matching records, newest last.
   */
  public query(query: LogQuery): readonly LogRecord[] {
    const source: readonly LogRecord[] =
      query.sessionId === undefined || query.sessionId === this.sessionId
        ? this.store.current()
        : this.archive.readSession(query.sessionId);
    return LogStore.filter(source, query);
  }

  /**
   * Lists the known app sessions, newest first, with the current session flagged live.
   * @returns Returns the known sessions.
   */
  public sessions(): readonly LogSession[] {
    return this.archive.sessions({ id: this.sessionId, startedAt: this.startedAt, current: true });
  }

  /**
   * Gets the on-disk archive, creating it on first use so the user-data path is resolved only after
   * the app is ready.
   * @returns Returns the archive.
   */
  private get archive(): LogArchive {
    return (this.archiveInstance ??= new LogArchive(this.logDirectory));
  }

  /**
   * Pushes one batch of records to every subscribed renderer over {@link LogChannel.Record}. Never
   * throws.
   * @param batch The records to push, oldest first.
   */
  private broadcast(batch: readonly LogRecord[]): void {
    try {
      for (const subscriber of this.subscribers) {
        if (!subscriber.isDestroyed()) {
          subscriber.send(LogChannel.Record, batch);
        }
      }
    } catch {
      // A subscriber torn down mid-send is deliberately swallowed.
    }
  }

  /**
   * Labels a renderer record by its originating window: `main` for the main window, `window-<id>` for
   * a pop-out, or `renderer` when the main window is not yet resolvable.
   * @param contents The web contents the record was forwarded from.
   * @returns Returns the window label.
   */
  private windowLabel(contents: WebContents): string {
    const mainId: number | null = this.mainWebContentsId?.() ?? null;
    if (mainId === null) {
      return 'renderer';
    }
    return contents.id === mainId ? 'main' : `window-${contents.id}`;
  }

  /**
   * Emits one record as a human-readable line: to stdout immediately in development, enqueued for
   * the rotating `studio.log` in packaged builds — the packaged file rides the same batched flush as
   * the session records, so it costs no per-record syscall. Never throws.
   * @param record The record to emit.
   */
  private emitHuman(record: LogRecord): void {
    try {
      const where: string = record.window ? `${record.origin}/${record.window}` : record.origin;
      const line: string = `${record.timestamp} [${where}:${record.severity}] ${record.source}: ${record.message}\n`;
      if (app.isPackaged) {
        this.archive.enqueueHuman(line);
      } else {
        process.stdout.write(line);
      }
    } catch {
      // A failed write (or an unavailable app before ready) is deliberately swallowed.
    }
  }
}

/**
 * The shared application logger. Main-process modules import this singleton to log — `main.ts` wires
 * it (window labelling + IPC) at start-up, and it is the single instance whose session buffer the
 * System Monitor's audit reads. There is exactly one so every subsystem's records land in the same
 * session.
 */
export const logger: Logger = new Logger();
