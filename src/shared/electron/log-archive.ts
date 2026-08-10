import * as fs from 'node:fs';
import * as path from 'node:path';
import { LogRecord, LogSession } from '@shared/api/log-channels';

/**
 * Caps the size of the active human-readable log file; when an append would cross it, the files
 * rotate first.
 */
const DEFAULT_MAX_FILE_BYTES: number = 5 * 1024 * 1024;

/**
 * Holds the default number of rotated human-readable log files kept beside the active one.
 */
const DEFAULT_MAX_ROTATED: number = 5;

/**
 * Persists log records to disk and reads them back: one JSONL file per app session under
 * `<directory>/sessions`, plus the rotating human-readable `<directory>/studio.log`. Deliberately free
 * of the electron module — it takes its base directory as a constructor argument, so it is
 * unit-testable against a temporary directory (the {@link import('./logger').Logger} constructs it with
 * the app's `userData/logs`). Every method swallows I/O failures: logging must not be able to take the
 * app down.
 */
export class LogArchive {
  /**
   * Holds the byte size of the active human-readable log file, tracked so rotation does not stat on
   * every write. Null until the first write resolves it from disk.
   */
  private currentFileBytes: number | null = null;

  /**
   * Initializes a new instance of the {@link LogArchive} class.
   * @param directory The base `logs` directory.
   * @param maxFileBytes The size cap for the active human-readable file before it rotates.
   * @param maxRotated The number of rotated human-readable files kept beside the active one.
   */
  public constructor(
    private readonly directory: string,
    private readonly maxFileBytes: number = DEFAULT_MAX_FILE_BYTES,
    private readonly maxRotated: number = DEFAULT_MAX_ROTATED,
  ) {}

  /**
   * Gets the directory the per-session JSONL record files live in.
   * @returns Returns the `sessions` directory under the base directory.
   */
  public get sessionsDirectory(): string {
    return path.join(this.directory, 'sessions');
  }

  /**
   * Appends one record as a JSON line to its session's JSONL file, creating the directory on first
   * use. Never throws.
   * @param record The record to persist.
   */
  public persist(record: LogRecord): void {
    try {
      fs.mkdirSync(this.sessionsDirectory, { recursive: true });
      fs.appendFileSync(this.sessionFile(record.sessionId), `${JSON.stringify(record)}\n`);
    } catch {
      // A failed record write (disk full, permissions) is deliberately swallowed.
    }
  }

  /**
   * Reads a session's records from its JSONL file. Malformed lines are skipped. Never throws.
   * @param sessionId The session to read.
   * @returns Returns the session's records, or an empty array when unreadable.
   */
  public readSession(sessionId: string): readonly LogRecord[] {
    try {
      const records: LogRecord[] = [];
      for (const line of fs.readFileSync(this.sessionFile(sessionId), 'utf8').split('\n')) {
        if (line.length === 0) {
          continue;
        }
        try {
          records.push(JSON.parse(line) as LogRecord);
        } catch {
          // Skip a truncated or malformed line.
        }
      }
      return records;
    } catch {
      return [];
    }
  }

  /**
   * Lists the known sessions, newest first: the supplied current (live) session plus every past
   * session discovered from its JSONL file and dated by file metadata. Never throws.
   * @param current The live session to include and flag.
   * @returns Returns the known sessions, newest first.
   */
  public sessions(current: LogSession): readonly LogSession[] {
    const found: LogSession[] = [current];
    try {
      for (const name of fs.readdirSync(this.sessionsDirectory)) {
        if (!name.endsWith('.jsonl')) {
          continue;
        }
        const id: string = name.slice(0, -'.jsonl'.length);
        if (id === current.id) {
          continue;
        }
        const stat: fs.Stats = fs.statSync(path.join(this.sessionsDirectory, name));
        found.push({
          id,
          startedAt: new Date(stat.birthtimeMs || stat.mtimeMs).toISOString(),
          current: false,
        });
      }
    } catch {
      // Missing directory or unreadable entries leave only the current session.
    }
    return found.sort((a: LogSession, b: LogSession): number => b.startedAt.localeCompare(a.startedAt));
  }

  /**
   * Appends one line to the active human-readable log file, creating the directory on first use and
   * rotating the files when the append would cross the size cap. Never throws.
   * @param line The fully formatted line, terminated with a newline.
   */
  public appendHuman(line: string): void {
    try {
      const file: string = path.join(this.directory, 'studio.log');
      fs.mkdirSync(this.directory, { recursive: true });
      this.currentFileBytes ??= fs.existsSync(file) ? fs.statSync(file).size : 0;
      const lineBytes: number = Buffer.byteLength(line);
      if (this.currentFileBytes + lineBytes > this.maxFileBytes) {
        this.rotate(file);
        this.currentFileBytes = 0;
      }
      fs.appendFileSync(file, line);
      this.currentFileBytes += lineBytes;
    } catch {
      // A failed log write (disk full, permissions) is deliberately swallowed.
    }
  }

  /**
   * Gets a session's JSONL file path.
   * @param sessionId The session identifier.
   * @returns Returns the file path.
   */
  private sessionFile(sessionId: string): string {
    return path.join(this.sessionsDirectory, `${sessionId}.jsonl`);
  }

  /**
   * Rotates the human-readable log files: the oldest (`studio.<max>.log`) is deleted, each numbered
   * file shifts up one, and the active file becomes `studio.1.log`.
   * @param file The active log file's path.
   */
  private rotate(file: string): void {
    const numbered: (index: number) => string = (index: number): string =>
      path.join(this.directory, `studio.${index}.log`);
    fs.rmSync(numbered(this.maxRotated), { force: true });
    for (let index: number = this.maxRotated - 1; index >= 1; index -= 1) {
      if (fs.existsSync(numbered(index))) {
        fs.renameSync(numbered(index), numbered(index + 1));
      }
    }
    if (fs.existsSync(file)) {
      fs.renameSync(file, numbered(1));
    }
  }
}
