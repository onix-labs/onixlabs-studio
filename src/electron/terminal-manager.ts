import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as pty from 'node-pty';
import { IpcChannel } from '../shared/ipc-channels';
import { TerminalCreateResult } from '../shared/studio-api';

/**
 * Specifies the default terminal column count when none is provided.
 */
const DEFAULT_COLS: number = 80;

/**
 * Specifies the default terminal row count when none is provided.
 */
const DEFAULT_ROWS: number = 24;

/**
 * Specifies the smallest valid terminal dimension; values at or below this are rejected.
 */
const MIN_DIMENSION: number = 0;

/**
 * Specifies the timeout, in milliseconds, for the macOS lsof working-directory lookup.
 */
const LSOF_TIMEOUT_MS: number = 1000;

/**
 * Manages pseudo-terminal sessions for the renderer: spawns node-pty instances, forwards their I/O
 * over IPC, and answers resize/dispose/cwd requests. One instance is owned by the main process.
 */
export class TerminalManager {
  /**
   * Holds the function used to resolve the window that terminal output is sent to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the running pseudo-terminal sessions, keyed by terminal identifier.
   */
  private readonly terminals: Map<string, pty.IPty> = new Map<string, pty.IPty>();

  /**
   * Initializes a new instance of the {@link TerminalManager} class.
   * @param windowGetter A function that returns the window terminal output is sent to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  /**
   * Registers the terminal IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      IpcChannel.TerminalCreate,
      (_event: IpcMainInvokeEvent, options: unknown): TerminalCreateResult => this.create(options),
    );
    ipcMain.handle(
      IpcChannel.TerminalWrite,
      (_event: IpcMainInvokeEvent, id: unknown, data: unknown): boolean =>
        typeof id === 'string' && typeof data === 'string' ? this.write(id, data) : false,
    );
    ipcMain.handle(
      IpcChannel.TerminalResize,
      (_event: IpcMainInvokeEvent, id: unknown, cols: unknown, rows: unknown): boolean =>
        typeof id === 'string' && this.isDimension(cols) && this.isDimension(rows)
          ? this.resize(id, cols, rows)
          : false,
    );
    ipcMain.handle(IpcChannel.TerminalDispose, (_event: IpcMainInvokeEvent, id: unknown): boolean =>
      typeof id === 'string' ? this.dispose(id) : false,
    );
    ipcMain.handle(
      IpcChannel.TerminalGetCwd,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<string | null> =>
        typeof id === 'string' ? this.getCwd(id) : Promise.resolve(null),
    );
  }

  /**
   * Disposes every running session. Called on application shutdown.
   */
  public disposeAll(): void {
    for (const terminal of this.terminals.values()) {
      try {
        terminal.kill();
      } catch {
        // Best-effort cleanup on shutdown; ignore individual kill failures.
      }
    }
    this.terminals.clear();
  }

  /**
   * Spawns a new session for the given options, wiring its data and exit events to the renderer, or
   * reuses an existing session with the same id. The options come from the renderer and are validated
   * here: a string id is required, and the dimensions and working directory fall back to safe defaults
   * when absent or malformed. The shell is resolved by the main process, never supplied by the caller.
   * @param options The terminal creation options from the renderer.
   * @returns Returns the result describing success and the spawned shell, or an error.
   */
  private create(options: unknown): TerminalCreateResult {
    if (typeof options !== 'object' || options === null) {
      return { success: false, error: 'Invalid terminal options' };
    }
    const candidate: { id?: unknown; cols?: unknown; rows?: unknown; cwd?: unknown } = options;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      return { success: false, error: 'Invalid terminal options' };
    }
    const id: string = candidate.id;

    const existing: pty.IPty | undefined = this.terminals.get(id);
    if (existing !== undefined) {
      return { success: true, pid: existing.pid, shell: existing.process };
    }

    const shell: string = this.resolveShell();
    const cols: number = this.isDimension(candidate.cols) ? candidate.cols : DEFAULT_COLS;
    const rows: number = this.isDimension(candidate.rows) ? candidate.rows : DEFAULT_ROWS;
    const cwd: string =
      typeof candidate.cwd === 'string' && candidate.cwd.length > 0 ? candidate.cwd : os.homedir();

    try {
      const terminal: pty.IPty = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env,
      });

      terminal.onData((data: string): void => {
        this.send(IpcChannel.TerminalData, id, data);
      });

      terminal.onExit((event: { exitCode: number; signal?: number }): void => {
        this.send(IpcChannel.TerminalExit, id, event.exitCode, event.signal ?? null);
        this.terminals.delete(id);
      });

      this.terminals.set(id, terminal);
      return { success: true, pid: terminal.pid, shell };
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Determines whether a value is a usable terminal dimension: a finite number greater than the
   * minimum.
   * @param value The candidate dimension from the renderer.
   * @returns Returns true when the value is a valid dimension.
   */
  private isDimension(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > MIN_DIMENSION;
  }

  /**
   * Writes input data to the session identified by the given id.
   * @param id The terminal identifier.
   * @param data The data to write.
   * @returns Returns true when the session exists and the data was written.
   */
  private write(id: string, data: string): boolean {
    const terminal: pty.IPty | undefined = this.terminals.get(id);
    if (terminal === undefined) {
      return false;
    }
    terminal.write(data);
    return true;
  }

  /**
   * Resizes the session identified by the given id.
   * @param id The terminal identifier.
   * @param cols The new column count.
   * @param rows The new row count.
   * @returns Returns true when the session exists and was resized.
   */
  private resize(id: string, cols: number, rows: number): boolean {
    const terminal: pty.IPty | undefined = this.terminals.get(id);
    if (terminal === undefined || cols <= MIN_DIMENSION || rows <= MIN_DIMENSION) {
      return false;
    }
    try {
      terminal.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Disposes (kills) the session identified by the given id.
   * @param id The terminal identifier.
   * @returns Returns true when the session existed and was disposed.
   */
  private dispose(id: string): boolean {
    const terminal: pty.IPty | undefined = this.terminals.get(id);
    if (terminal === undefined) {
      return false;
    }
    try {
      terminal.kill();
    } catch {
      // Ignore kill failures; the session is removed regardless.
    }
    this.terminals.delete(id);
    return true;
  }

  /**
   * Resolves the working directory of the session's shell process.
   * @param id The terminal identifier.
   * @returns Returns the working directory, or null when it cannot be determined on this platform.
   */
  private async getCwd(id: string): Promise<string | null> {
    const terminal: pty.IPty | undefined = this.terminals.get(id);
    if (terminal === undefined) {
      return null;
    }
    const pid: number = terminal.pid;

    if (process.platform === 'linux') {
      try {
        return await fs.readlink(`/proc/${pid}/cwd`);
      } catch {
        return null;
      }
    }

    if (process.platform === 'darwin') {
      return this.getCwdViaLsof(pid);
    }

    return null;
  }

  /**
   * Resolves a process's working directory on macOS via lsof.
   * @param pid The process identifier.
   * @returns Returns the working directory, or null when it cannot be determined.
   */
  private getCwdViaLsof(pid: number): Promise<string | null> {
    return new Promise<string | null>((resolve: (value: string | null) => void): void => {
      execFile(
        'lsof',
        ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
        { timeout: LSOF_TIMEOUT_MS },
        (error: Error | null, stdout: string): void => {
          if (error !== null) {
            resolve(null);
            return;
          }
          const line: string | undefined = stdout
            .split('\n')
            .find((candidate: string): boolean => candidate.startsWith('n'));
          resolve(line !== undefined ? line.slice(1) : null);
        },
      );
    });
  }

  /**
   * Picks a usable default shell for the current platform, walking a fallback chain so an empty or
   * stale environment variable does not surface as a cryptic spawn failure.
   * @returns Returns the resolved shell executable path or name.
   */
  private resolveShell(): string {
    const candidates: (string | undefined)[] =
      process.platform === 'win32'
        ? [process.env['COMSPEC'], 'cmd.exe']
        : [process.env['SHELL'], '/bin/bash', '/bin/sh'];

    for (const candidate of candidates) {
      if (this.isUsableShell(candidate)) {
        return candidate.trim();
      }
    }

    return process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  }

  /**
   * Determines whether a shell candidate is usable: a non-empty string that, when it is an absolute
   * path, points at an executable file.
   * @param candidate The shell candidate to validate.
   * @returns Returns true when the candidate can be used as a shell.
   */
  private isUsableShell(candidate: string | undefined): candidate is string {
    if (candidate === undefined) {
      return false;
    }
    const trimmed: string = candidate.trim();
    if (trimmed.length === 0) {
      return false;
    }
    if (!path.isAbsolute(trimmed)) {
      return true;
    }
    try {
      accessSync(trimmed, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sends a message to the renderer window, if one is available and not destroyed.
   * @param channel The IPC channel to send on.
   * @param args The arguments to send.
   */
  private send(channel: IpcChannel, ...args: readonly unknown[]): void {
    const window: BrowserWindow | null = this.windowGetter();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  }
}
