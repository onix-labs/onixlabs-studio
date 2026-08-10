import * as path from 'node:path';
import { app, BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
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
import { LogArchive } from '@shared/electron/log-archive';
import { LogInput, LogStore } from '@shared/electron/log-store';

/**
 * Collects application log records for the current app session and serves the log audit.
 *
 * This is the thin electron adapter over two electron-free cores: the {@link LogStore} holds the live
 * per-session ring buffer and the query logic, and the {@link LogArchive} persists and reloads records
 * on disk. Every record is buffered (the live audit source), persisted as one JSON line to the
 * session's `logs/sessions/<sessionId>.jsonl` file, written as a human-readable line to stdout in
 * development or the rotating `studio.log` in packaged builds, and pushed to every renderer window
 * over {@link LogChannel.Record}.
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
      const candidate: Partial<StructuredLogInput> = (input as Partial<StructuredLogInput> | null) ?? {};
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
  }

  /**
   * Records one structured log: buffers it, persists it, writes the human-readable line and pushes it
   * to the renderers. Never throws — logging must not be able to take the app down.
   * @param input The record's origin, severity, source, message and optional originating window.
   */
  public log(input: LogInput): void {
    const record: LogRecord = this.store.add(input);
    this.archive.persist(record);
    this.emitHuman(record);
    this.broadcast(record);
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
   */
  public trace(source: string, message: string): void {
    this.log({ origin: 'main', severity: 'trace', source, message });
  }

  /**
   * Records a debug-severity main-process log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   */
  public debug(source: string, message: string): void {
    this.log({ origin: 'main', severity: 'debug', source, message });
  }

  /**
   * Records an info-severity main-process log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   */
  public info(source: string, message: string): void {
    this.log({ origin: 'main', severity: 'info', source, message });
  }

  /**
   * Records a warning-severity main-process log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   */
  public warn(source: string, message: string): void {
    this.log({ origin: 'main', severity: 'warning', source, message });
  }

  /**
   * Records an error-severity main-process log.
   * @param source The source of the record — the "Where".
   * @param message The message text.
   */
  public error(source: string, message: string): void {
    this.log({ origin: 'main', severity: 'error', source, message });
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
   * Pushes one record to every live renderer window over {@link LogChannel.Record}. Never throws.
   * @param record The record to broadcast.
   */
  private broadcast(record: LogRecord): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        try {
          window.webContents.send(LogChannel.Record, record);
        } catch {
          // A window torn down mid-send is ignored.
        }
      }
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
   * Writes one record as a human-readable line: to stdout in development, to the rotating
   * `studio.log` in packaged builds. Never throws.
   * @param record The record to write.
   */
  private emitHuman(record: LogRecord): void {
    const where: string = record.window ? `${record.origin}/${record.window}` : record.origin;
    const line: string = `${record.timestamp} [${where}:${record.severity}] ${record.source}: ${record.message}\n`;
    if (app.isPackaged) {
      this.archive.appendHuman(line);
    } else {
      try {
        process.stdout.write(line);
      } catch {
        // A failed stdout write is deliberately swallowed.
      }
    }
  }
}
