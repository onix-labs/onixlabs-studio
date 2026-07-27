import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as pty from 'node-pty';
import { readFileSync } from 'node:fs';
import {
  ShellInfo,
  TerminalChannel,
  TerminalCreateResult,
  TerminalKind,
  TerminalReplay,
} from '@shared/api/terminal-channels';
import { TerminalScrollback } from './terminal-scrollback';
import { allowsInput, buildSpawnSpec, SpawnSpec } from './terminal-spawn';

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
 * Specifies the grace period, in milliseconds, between SIGTERM and SIGKILL when terminating a
 * session's process tree. Mirrors the task runner's escalation.
 */
const TERMINATE_GRACE_MS: number = 5000;

/**
 * Holds the recognised session kinds, used to validate renderer-supplied create options.
 */
const TERMINAL_KINDS: ReadonlySet<string> = new Set<string>(['shell', 'run', 'task']);

/**
 * Manages pseudo-terminal sessions for the renderer: spawns node-pty instances, forwards their I/O
 * over IPC, and answers resize/dispose/cwd requests. One instance is owned by the main process.
 */
export class TerminalManager {
  /**
   * Holds the function used to resolve the window session output and exits are sent to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the running pseudo-terminal sessions, keyed by terminal identifier.
   */
  private readonly terminals: Map<string, pty.IPty> = new Map<string, pty.IPty>();

  /**
   * Holds each session's retained scrollback, so a re-attaching renderer pane can replay the output
   * it missed while unmounted. Records outlive process exit and are removed only on dispose.
   */
  private readonly scrollback: TerminalScrollback = new TerminalScrollback();

  /**
   * Holds each session's kind, so the write gate can drop input to read-only `task` sessions.
   */
  private readonly kinds: Map<string, TerminalKind> = new Map<string, TerminalKind>();

  /**
   * Holds the pending SIGKILL escalation timers of terminating sessions, cleared when the process
   * exits within the grace period (or the session is disposed).
   */
  private readonly killTimers: Map<string, NodeJS.Timeout> = new Map<string, NodeJS.Timeout>();

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
      TerminalChannel.Create,
      (_event: IpcMainInvokeEvent, options: unknown): TerminalCreateResult => this.create(options),
    );
    ipcMain.handle(
      TerminalChannel.Write,
      (_event: IpcMainInvokeEvent, id: unknown, data: unknown): boolean =>
        typeof id === 'string' && typeof data === 'string' ? this.write(id, data) : false,
    );
    ipcMain.handle(
      TerminalChannel.Resize,
      (_event: IpcMainInvokeEvent, id: unknown, cols: unknown, rows: unknown): boolean =>
        typeof id === 'string' && this.isDimension(cols) && this.isDimension(rows)
          ? this.resize(id, cols, rows)
          : false,
    );
    ipcMain.handle(TerminalChannel.Dispose, (_event: IpcMainInvokeEvent, id: unknown): boolean =>
      typeof id === 'string' ? this.dispose(id) : false,
    );
    ipcMain.handle(TerminalChannel.Terminate, (_event: IpcMainInvokeEvent, id: unknown): boolean =>
      typeof id === 'string' ? this.terminate(id) : false,
    );
    ipcMain.handle(
      TerminalChannel.GetCwd,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<string | null> =>
        typeof id === 'string' ? this.getCwd(id) : Promise.resolve(null),
    );
    ipcMain.handle(TerminalChannel.ListShells, (): readonly ShellInfo[] => this.listShells());
    ipcMain.handle(
      TerminalChannel.Replay,
      (_event: IpcMainInvokeEvent, id: unknown): TerminalReplay =>
        typeof id === 'string'
          ? this.scrollback.snapshot(id)
          : { data: '', seq: 0, exitCode: null, signal: null },
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
    this.scrollback.clear();
    this.kinds.clear();
    for (const timer of this.killTimers.values()) {
      clearTimeout(timer);
    }
    this.killTimers.clear();
  }

  /**
   * Spawns a new session for the given options, wiring its data and exit events to the renderer, or
   * reuses an existing session with the same id. The options come from the renderer and are validated
   * here: a string id is required, and the dimensions and working directory fall back to safe defaults
   * when absent or malformed. The shell is resolved by the main process, never supplied by the caller.
   * A `run` or `task` session executes its command instead of an interactive shell — via the platform
   * shell for a bare command line, or directly when an argument vector is given — with any supplied
   * environment layered over the application's. A command spawn failure is written into the session's
   * scrollback (with a recorded exit) so an attached pane shows it rather than a silent no-op.
   * @param options The terminal creation options from the renderer.
   * @returns Returns the result describing success and the spawned executable, or an error.
   */
  private create(options: unknown): TerminalCreateResult {
    if (typeof options !== 'object' || options === null) {
      return { success: false, error: 'Invalid terminal options' };
    }
    const candidate: {
      id?: unknown;
      kind?: unknown;
      cols?: unknown;
      rows?: unknown;
      cwd?: unknown;
      shell?: unknown;
      command?: unknown;
      args?: unknown;
      env?: unknown;
    } = options;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      return { success: false, error: 'Invalid terminal options' };
    }
    const id: string = candidate.id;

    const existing: pty.IPty | undefined = this.terminals.get(id);
    if (existing !== undefined) {
      return { success: true, pid: existing.pid, shell: existing.process };
    }

    const kind: TerminalKind =
      typeof candidate.kind === 'string' && TERMINAL_KINDS.has(candidate.kind)
        ? (candidate.kind as TerminalKind)
        : 'shell';
    const command: string | undefined =
      typeof candidate.command === 'string' && candidate.command.length > 0
        ? candidate.command
        : undefined;
    const args: readonly string[] | undefined =
      command !== undefined &&
      Array.isArray(candidate.args) &&
      candidate.args.every((entry: unknown): entry is string => typeof entry === 'string')
        ? candidate.args
        : undefined;
    const env: Readonly<Record<string, string>> =
      typeof candidate.env === 'object' && candidate.env !== null
        ? Object.fromEntries(
            Object.entries(candidate.env).filter(
              (entry: [string, unknown]): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {};

    // Honour a caller-chosen shell only when it is a usable executable; otherwise fall back to the
    // resolved platform default, so a stale or bogus choice never surfaces as a cryptic spawn failure.
    const shell: string = this.isUsableShell(
      typeof candidate.shell === 'string' ? candidate.shell : undefined,
    )
      ? (candidate.shell as string).trim()
      : this.resolveShell();
    const cols: number = this.isDimension(candidate.cols) ? candidate.cols : DEFAULT_COLS;
    const rows: number = this.isDimension(candidate.rows) ? candidate.rows : DEFAULT_ROWS;
    const cwd: string =
      typeof candidate.cwd === 'string' && candidate.cwd.length > 0 ? candidate.cwd : os.homedir();
    const spec: SpawnSpec = buildSpawnSpec(process.platform, shell, command, args);

    try {
      const terminal: pty.IPty = pty.spawn(spec.file, [...spec.args], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, ...env },
      });

      // A fresh spawn starts a fresh scrollback record, so a session re-created under a reused
      // identifier never replays its predecessor's output.
      this.scrollback.reset(id);

      if (command !== undefined) {
        // Echo what the session runs, like a prompt would: without it, a command that fails before
        // printing (a missing binary execs then exits instantly) would leave nothing but a bare exit
        // banner to diagnose from.
        const display: string = args !== undefined ? [command, ...args].join(' ') : command;
        const header: string = `\x1b[90m> ${display}\x1b[0m\r\n`;
        const headerSeq: number = this.scrollback.append(id, header);
        this.sendToWindow(TerminalChannel.Data, id, header, headerSeq);
      }

      terminal.onData((data: string): void => {
        const seq: number = this.scrollback.append(id, data);
        this.sendToWindow(TerminalChannel.Data, id, data, seq);
      });

      terminal.onExit((event: { exitCode: number; signal?: number }): void => {
        // A disposed session was already removed (and possibly replaced under the same id by a
        // relaunch): its late exit must stay silent, or it would masquerade as the successor's.
        if (this.terminals.get(id) !== terminal) {
          return;
        }
        // A process that exited within the grace period needs no SIGKILL escalation.
        const pendingKill: NodeJS.Timeout | undefined = this.killTimers.get(id);
        if (pendingKill !== undefined) {
          clearTimeout(pendingKill);
          this.killTimers.delete(id);
        }
        // node-pty reports signal 0 (not undefined) for a plain exit; only a real signal number means
        // the process was terminated — 0 must not read as one, or every success would.
        const endedBy: number | null =
          typeof event.signal === 'number' && event.signal !== 0 ? event.signal : null;
        // Keep the scrollback (with the exit recorded) so a pane re-attaching later still shows the
        // session's output and exit banner; only dispose removes it.
        this.scrollback.markExited(id, event.exitCode, endedBy);
        this.sendToWindow(TerminalChannel.Exit, id, event.exitCode, endedBy);
        this.terminals.delete(id);
      });

      this.terminals.set(id, terminal);
      this.kinds.set(id, kind);
      return { success: true, pid: terminal.pid, shell: spec.file };
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : 'Unknown error';
      if (command !== undefined) {
        // A failed command spawn must be visible in the session's pane, not a silent no-op: record
        // the failure in the scrollback with an exit — streamed live too, for an attached pane —
        // so the pane shows it now or on replay.
        this.scrollback.reset(id);
        const line: string = `\x1b[31mFailed to start: ${message}\x1b[0m\r\n`;
        const seq: number = this.scrollback.append(id, line);
        this.sendToWindow(TerminalChannel.Data, id, line, seq);
        this.scrollback.markExited(id, 1);
        this.sendToWindow(TerminalChannel.Exit, id, 1, null);
      }
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
   * Writes input data to the session identified by the given id. This is the single choke point for
   * every input source (keystrokes, paste, agent writes), so the read-only gate for `task` sessions
   * lives here: only a bare Ctrl+C passes — the line discipline turns it into SIGINT — and everything
   * else is dropped.
   * @param id The terminal identifier.
   * @param data The data to write.
   * @returns Returns true when the session exists and the data was written.
   */
  private write(id: string, data: string): boolean {
    const terminal: pty.IPty | undefined = this.terminals.get(id);
    if (terminal === undefined) {
      return false;
    }
    if (!allowsInput(this.kinds.get(id) ?? 'shell', data)) {
      return false;
    }
    terminal.write(data);
    return true;
  }

  /**
   * Terminates a session's process tree while keeping the session (its tab, scrollback, and the exit
   * banner the exit event produces): SIGTERM to the PTY's process group, escalating to SIGKILL after
   * a grace period when it has not exited; Windows uses taskkill's forced tree kill. The PTY child is
   * a session leader, so signalling its negated pid reaches the whole group a non-interactive shell
   * runs its children in.
   * @param id The terminal identifier.
   * @returns Returns true when the session exists and was signalled.
   */
  private terminate(id: string): boolean {
    const terminal: pty.IPty | undefined = this.terminals.get(id);
    if (terminal === undefined) {
      return false;
    }
    const pid: number = terminal.pid;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], (): void => undefined);
      return true;
    }
    this.signalTree(pid, 'SIGTERM');
    if (!this.killTimers.has(id)) {
      this.killTimers.set(
        id,
        setTimeout((): void => {
          this.killTimers.delete(id);
          if (this.terminals.get(id) === terminal) {
            this.signalTree(pid, 'SIGKILL');
          }
        }, TERMINATE_GRACE_MS),
      );
    }
    return true;
  }

  /**
   * Signals a process group by its leader's pid, falling back to the single process when the group
   * signal fails.
   * @param pid The group leader's process identifier.
   * @param signal The signal to deliver.
   */
  private signalTree(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // The process is already gone; nothing to signal.
      }
    }
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
   * Disposes (kills) the session identified by the given id, discarding its retained scrollback. An
   * already-exited session no longer has a process, but disposing it still clears its scrollback.
   * @param id The terminal identifier.
   * @returns Returns true when a session (or its retained scrollback) existed and was removed.
   */
  private dispose(id: string): boolean {
    const hadScrollback: boolean = this.scrollback.delete(id);
    this.kinds.delete(id);
    const pendingKill: NodeJS.Timeout | undefined = this.killTimers.get(id);
    if (pendingKill !== undefined) {
      clearTimeout(pendingKill);
      this.killTimers.delete(id);
    }
    const terminal: pty.IPty | undefined = this.terminals.get(id);
    if (terminal === undefined) {
      return hadScrollback;
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
   * Enumerates the shells installed on the host for the shell picker. On POSIX the canonical list is
   * `/etc/shells`; on Windows there is no such registry, so a small set of well-known interpreters is
   * probed. The user's current default (`$SHELL`, or the resolved fallback) is always included and
   * listed first. Every entry is verified to be an executable, and duplicates are collapsed by path.
   * @returns Returns the installed shells, most-preferred first.
   */
  private listShells(): readonly ShellInfo[] {
    const candidates: string[] =
      process.platform === 'win32' ? this.windowsShellCandidates() : this.posixShellCandidates();

    // Lead with the active default so the picker highlights what a new terminal would use.
    const ordered: string[] = [this.resolveShell(), ...candidates];

    const seen: Set<string> = new Set<string>();
    const shells: ShellInfo[] = [];
    for (const candidate of ordered) {
      const trimmed: string = candidate.trim();
      if (seen.has(trimmed) || !this.isUsableShell(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      shells.push({ name: path.basename(trimmed, path.extname(trimmed)), path: trimmed });
    }
    return shells;
  }

  /**
   * Reads the POSIX shell registry (`/etc/shells`), ignoring comments and blank lines. A missing or
   * unreadable file yields an empty list, leaving only the resolved default in the picker.
   * @returns Returns the absolute shell paths listed in `/etc/shells`.
   */
  private posixShellCandidates(): string[] {
    try {
      return readFileSync('/etc/shells', 'utf-8')
        .split('\n')
        .map((line: string): string => line.trim())
        .filter((line: string): boolean => line.length > 0 && !line.startsWith('#'));
    } catch {
      return [];
    }
  }

  /**
   * Lists the well-known Windows shell interpreters to probe. Both are given as absolute paths so the
   * caller's executable check can validate them; PowerShell 7 (`pwsh`) is left out because it needs
   * PATH resolution the picker cannot safely do here.
   * @returns Returns the candidate Windows shell paths.
   */
  private windowsShellCandidates(): string[] {
    const system: string = process.env['SystemRoot'] ?? 'C:\\Windows';
    return [
      process.env['COMSPEC'] ?? path.join(system, 'System32', 'cmd.exe'),
      path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ];
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
   * Sends a session's message to the renderer window, when it is still alive.
   * @param channel The IPC channel to send on.
   * @param args The arguments to send.
   */
  private sendToWindow(channel: TerminalChannel, ...args: readonly unknown[]): void {
    const window: BrowserWindow | null = this.windowGetter();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  }
}
