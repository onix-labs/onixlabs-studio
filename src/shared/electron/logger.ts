import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, ipcMain, IpcMainEvent } from 'electron';
import {
  LOG_LEVELS,
  LogChannel,
  LogEntry,
  LogLevel,
  MAX_LOG_MESSAGE_LENGTH,
} from '@shared/api/log-channels';

/**
 * Caps the size of the active log file; when an append would cross it, the files rotate first.
 */
const MAX_LOG_FILE_BYTES: number = 5 * 1024 * 1024;

/**
 * Holds the number of rotated log files kept beside the active one (`studio.1.log` …
 * `studio.<n>.log`, oldest last); rotating past the cap deletes the oldest.
 */
const MAX_ROTATED_FILES: number = 5;

/**
 * Writes application log lines to stdout in development and to size-rotated files under
 * `userData/logs` in packaged builds, and receives the renderer's forwarded console entries over
 * IPC. Main-process code can log directly through {@link write}; the renderer's console methods are
 * intercepted by the ConsoleForwarder service and arrive via {@link LogChannel.Write}.
 */
export class Logger {
  /**
   * Holds the byte size of the active log file, tracked so rotation does not stat on every write.
   * Null until the first packaged-build write resolves it from disk.
   */
  private currentFileBytes: number | null = null;

  /**
   * Registers the renderer→main log channel. Payloads are untrusted: the level must be a known
   * console severity and the message is coerced and re-capped before it is written.
   */
  public register(): void {
    ipcMain.on(LogChannel.Write, (_event: IpcMainEvent, entry: unknown): void => {
      const candidate: Partial<LogEntry> = entry ?? {};
      if (!LOG_LEVELS.includes(candidate.level!)) {
        return;
      }
      if (typeof candidate.message !== 'string') {
        return;
      }
      this.write('renderer', candidate.level!, candidate.message);
    });
  }

  /**
   * Writes one timestamped log line: to stdout in development, to the rotating file in packaged
   * builds. Never throws — logging must not be able to take the app down.
   * @param source The process the entry originated from.
   * @param level The console severity of the entry.
   * @param message The message text; capped to {@link MAX_LOG_MESSAGE_LENGTH}.
   */
  public write(source: 'renderer' | 'main', level: LogLevel, message: string): void {
    const capped: string = message.slice(0, MAX_LOG_MESSAGE_LENGTH);
    const line: string = `${new Date().toISOString()} [${source}:${level}] ${capped}\n`;
    try {
      if (app.isPackaged) {
        this.appendToFile(line);
      } else {
        process.stdout.write(line);
      }
    } catch {
      // A failed log write (disk full, permissions) is deliberately swallowed.
    }
  }

  /**
   * Gets the directory the packaged build's log files live in.
   * @returns Returns the `logs` directory under the application's user data.
   */
  public get logDirectory(): string {
    return path.join(app.getPath('userData'), 'logs');
  }

  /**
   * Appends one line to the active log file, creating the directory on first use and rotating the
   * files when the append would cross the size cap.
   * @param line The fully formatted line, terminated with a newline.
   */
  private appendToFile(line: string): void {
    const file: string = path.join(this.logDirectory, 'studio.log');
    fs.mkdirSync(this.logDirectory, { recursive: true });
    this.currentFileBytes ??= fs.existsSync(file) ? fs.statSync(file).size : 0;
    const lineBytes: number = Buffer.byteLength(line);
    if (this.currentFileBytes + lineBytes > MAX_LOG_FILE_BYTES) {
      this.rotate(file);
      this.currentFileBytes = 0;
    }
    fs.appendFileSync(file, line);
    this.currentFileBytes += lineBytes;
  }

  /**
   * Rotates the log files: the oldest (`studio.<max>.log`) is deleted, each numbered file shifts up
   * one, and the active file becomes `studio.1.log`.
   * @param file The active log file's path.
   */
  private rotate(file: string): void {
    const numbered: (index: number) => string = (index: number): string =>
      path.join(this.logDirectory, `studio.${index}.log`);
    fs.rmSync(numbered(MAX_ROTATED_FILES), { force: true });
    for (let index: number = MAX_ROTATED_FILES - 1; index >= 1; index -= 1) {
      if (fs.existsSync(numbered(index))) {
        fs.renameSync(numbered(index), numbered(index + 1));
      }
    }
    if (fs.existsSync(file)) {
      fs.renameSync(file, numbered(1));
    }
  }
}
