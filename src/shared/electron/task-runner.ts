import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as os from 'node:os';
import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import { TaskChannel, TaskRunRequest, TaskRunResult } from '@shared/api/task-channels';

/**
 * How long, in milliseconds, a cancelled task is given to exit after `SIGTERM` before it is killed
 * outright. Long enough for a server to close its listeners, short enough that a wedged process does
 * not sit in the Stop menu indefinitely.
 */
const TERMINATE_GRACE_MS: number = 5000;

/**
 * Runs tasks as child processes for the renderer: spawns a command through the platform shell,
 * streams its standard output and error back over IPC, reports its exit, and answers cancel requests.
 * One instance is owned by the main process.
 *
 * The command is supplied by the renderer. This grants no capability the renderer does not already
 * have through the integrated terminal (which runs arbitrary shell input); the value of running tasks
 * here, rather than through the terminal, is that the output is captured so it can be rendered in the
 * Output panel and later parsed by problem matchers.
 */
export class TaskRunner {
  /**
   * Holds the function used to resolve the window that task output is sent to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the running task processes, keyed by run identifier.
   */
  private readonly runs: Map<string, ChildProcessWithoutNullStreams> = new Map<
    string,
    ChildProcessWithoutNullStreams
  >();

  /**
   * Holds the pending force-kill timers of cancelled runs, keyed by run identifier, so a task that
   * ignores `SIGTERM` is killed outright rather than lingering.
   */
  private readonly forceTimers: Map<string, NodeJS.Timeout> = new Map<string, NodeJS.Timeout>();

  /**
   * Initializes a new instance of the {@link TaskRunner} class.
   * @param windowGetter A function that returns the window task output is sent to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  /**
   * Registers the task-runner IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      TaskChannel.Run,
      (_event: IpcMainInvokeEvent, request: unknown): TaskRunResult => this.run(request),
    );
    ipcMain.handle(TaskChannel.Cancel, (_event: IpcMainInvokeEvent, runId: unknown): boolean =>
      typeof runId === 'string' ? this.cancel(runId) : false,
    );
  }

  /**
   * Terminates every running task. Called on application shutdown.
   */
  public disposeAll(): void {
    for (const timer of this.forceTimers.values()) {
      clearTimeout(timer);
    }
    this.forceTimers.clear();
    for (const child of this.runs.values()) {
      try {
        this.killTree(child, 'SIGKILL');
      } catch {
        // Best-effort cleanup on shutdown; ignore individual kill failures.
      }
    }
    this.runs.clear();
  }

  /**
   * Spawns a task process for the given request after validating its arguments. The command is run
   * through the platform shell so shell syntax (quoting, operators) behaves as the renderer expects.
   * @param request The run request from the renderer.
   * @returns Returns the result describing success and the spawned process, or an error.
   */
  private run(request: unknown): TaskRunResult {
    if (typeof request !== 'object' || request === null) {
      return { success: false, error: 'Invalid task request' };
    }
    const candidate: Partial<TaskRunRequest> = request;
    if (typeof candidate.runId !== 'string' || candidate.runId.length === 0) {
      return { success: false, error: 'Invalid task request' };
    }
    if (typeof candidate.command !== 'string' || candidate.command.length === 0) {
      return { success: false, error: 'Invalid task request' };
    }
    const runId: string = candidate.runId;
    if (this.runs.has(runId)) {
      return { success: false, error: 'A task with this identifier is already running' };
    }
    const cwd: string =
      typeof candidate.cwd === 'string' && candidate.cwd.length > 0 ? candidate.cwd : os.homedir();

    try {
      const child: ChildProcessWithoutNullStreams = spawn(candidate.command, {
        shell: true,
        cwd,
        env: process.env,
        // Give the task its own process group (POSIX) so cancelling can signal the whole tree. The
        // command runs through a shell, so signalling only the shell would leave its children — the
        // actual server or watcher — running, holding the output pipes open so the task never appears
        // to exit. Windows has no process groups here; `taskkill /T` walks the tree instead.
        detached: process.platform !== 'win32',
      });

      child.stdout.on('data', (data: Buffer): void => {
        this.send(TaskChannel.Output, runId, data.toString(), 'stdout');
      });
      child.stderr.on('data', (data: Buffer): void => {
        this.send(TaskChannel.Output, runId, data.toString(), 'stderr');
      });
      child.on('error', (error: Error): void => {
        this.send(TaskChannel.Output, runId, `${error.message}\n`, 'stderr');
      });
      child.on('close', (code: number | null, signal: NodeJS.Signals | null): void => {
        this.runs.delete(runId);
        this.clearForceTimer(runId);
        this.send(TaskChannel.Exit, runId, code, signal);
      });

      this.runs.set(runId, child);
      return { success: true, pid: child.pid };
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Cancels the task identified by the given run identifier by terminating its whole process tree, and
   * schedules a force-kill in case it ignores the polite signal. The run is *not* dropped here: it is
   * removed when its `close` event arrives, which is also what tells the renderer the run has ended.
   * @param runId The run identifier.
   * @returns Returns true when the run existed and was signalled.
   */
  private cancel(runId: string): boolean {
    const child: ChildProcessWithoutNullStreams | undefined = this.runs.get(runId);
    if (child === undefined) {
      return false;
    }
    this.killTree(child, 'SIGTERM');
    if (!this.forceTimers.has(runId)) {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        this.forceTimers.delete(runId);
        const pending: ChildProcessWithoutNullStreams | undefined = this.runs.get(runId);
        if (pending !== undefined) {
          this.killTree(pending, 'SIGKILL');
        }
      }, TERMINATE_GRACE_MS);
      // Do not hold the process open on account of a pending force-kill.
      timer.unref?.();
      this.forceTimers.set(runId, timer);
    }
    return true;
  }

  /**
   * Clears a run's pending force-kill timer, if it has one.
   * @param runId The run identifier.
   */
  private clearForceTimer(runId: string): void {
    const timer: NodeJS.Timeout | undefined = this.forceTimers.get(runId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.forceTimers.delete(runId);
    }
  }

  /**
   * Terminates a task's whole process tree, not merely the shell that fronts it. On POSIX the child was
   * spawned into its own process group, so signalling the negated pid reaches every descendant; on
   * Windows `taskkill /T` walks the tree. Falls back to signalling the child alone when the group
   * signal fails (for example when the group has already gone).
   * @param child The task's child process.
   * @param signal The signal to send.
   */
  private killTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
    const pid: number | undefined = child.pid;
    if (pid === undefined) {
      return;
    }
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
      } catch {
        // Fall through to the direct kill below.
      }
    } else {
      try {
        process.kill(-pid, signal);
        return;
      } catch {
        // The group may already be gone, or the child may not have become a group leader.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // Nothing further to try; the close handler still reports whatever the process does.
    }
  }

  /**
   * Sends a message to the renderer window, if one is available and not destroyed.
   * @param channel The IPC channel to send on.
   * @param args The arguments to send.
   */
  private send(channel: TaskChannel, ...args: readonly unknown[]): void {
    const window: BrowserWindow | null = this.windowGetter();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  }
}
