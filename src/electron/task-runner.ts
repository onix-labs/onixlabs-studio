import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as os from 'node:os';
import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import { IpcChannel } from '../shared/ipc-channels';
import { TaskRunRequest, TaskRunResult } from '../shared/task-types';

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
      IpcChannel.TaskRun,
      (_event: IpcMainInvokeEvent, request: unknown): TaskRunResult => this.run(request),
    );
    ipcMain.handle(IpcChannel.TaskCancel, (_event: IpcMainInvokeEvent, runId: unknown): boolean =>
      typeof runId === 'string' ? this.cancel(runId) : false,
    );
  }

  /**
   * Terminates every running task. Called on application shutdown.
   */
  public disposeAll(): void {
    for (const child of this.runs.values()) {
      try {
        child.kill();
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
      });

      child.stdout.on('data', (data: Buffer): void => {
        this.send(IpcChannel.TaskOutput, runId, data.toString(), 'stdout');
      });
      child.stderr.on('data', (data: Buffer): void => {
        this.send(IpcChannel.TaskOutput, runId, data.toString(), 'stderr');
      });
      child.on('error', (error: Error): void => {
        this.send(IpcChannel.TaskOutput, runId, `${error.message}\n`, 'stderr');
      });
      child.on('close', (code: number | null, signal: NodeJS.Signals | null): void => {
        this.runs.delete(runId);
        this.send(IpcChannel.TaskExit, runId, code, signal);
      });

      this.runs.set(runId, child);
      return { success: true, pid: child.pid };
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Cancels (kills) the task identified by the given run identifier.
   * @param runId The run identifier.
   * @returns Returns true when the run existed and was cancelled.
   */
  private cancel(runId: string): boolean {
    const child: ChildProcessWithoutNullStreams | undefined = this.runs.get(runId);
    if (child === undefined) {
      return false;
    }
    try {
      child.kill();
    } catch {
      // Ignore kill failures; the run is removed regardless.
    }
    this.runs.delete(runId);
    return true;
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
