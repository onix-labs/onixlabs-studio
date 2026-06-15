// Shared task-runner types used between the Electron main process and the renderer.
// Keep this module platform-neutral (no Node or DOM dependencies) so both compilation targets can
// import it.

/**
 * Identifies which stream a chunk of task output came from.
 */
export type TaskOutputStream = 'stdout' | 'stderr';

/**
 * Describes a request to run a task as a child process whose output streams back to the renderer.
 * The command is supplied by the renderer (the same capability it already has through the integrated
 * terminal) and run through the platform shell.
 */
export interface TaskRunRequest {
  /**
   * Gets the renderer-minted identifier the run is keyed by, used to route output and exit back and
   * to cancel the run.
   */
  readonly runId: string;

  /**
   * Gets the shell command line to run.
   */
  readonly command: string;

  /**
   * Gets the working directory to run in, or undefined to use the user's home directory.
   */
  readonly cwd?: string;
}

/**
 * Reports the outcome of starting a task run.
 */
export interface TaskRunResult {
  /**
   * Gets a value indicating whether the task process spawned.
   */
  readonly success: boolean;

  /**
   * Gets the process identifier of the spawned task, when successful.
   */
  readonly pid?: number;

  /**
   * Gets the failure reason, when the task did not start.
   */
  readonly error?: string;
}

/**
 * Defines the task-runner operations exposed to the renderer process. A task runs as a child process
 * in the main process; its output and exit are delivered through listener subscriptions, each
 * returning a function that removes the listener.
 */
export interface TaskApi {
  /**
   * Runs a task as a child process.
   * @param request The run identifier, command, and working directory.
   * @returns Returns the result describing success and the spawned process.
   */
  run(request: TaskRunRequest): Promise<TaskRunResult>;

  /**
   * Cancels a running task, terminating its process.
   * @param runId The run to cancel.
   * @returns Returns true when the run existed and was cancelled.
   */
  cancel(runId: string): Promise<boolean>;

  /**
   * Subscribes to output chunks from running tasks.
   * @param listener Receives the run identifier, the output chunk, and the stream it came from.
   * @returns Returns a function that removes the listener.
   */
  onOutput(listener: (runId: string, chunk: string, stream: TaskOutputStream) => void): () => void;

  /**
   * Subscribes to task-process exits.
   * @param listener Receives the run identifier, exit code (or null on signal), and signal (or null).
   * @returns Returns a function that removes the listener.
   */
  onExit(listener: (runId: string, code: number | null, signal: string | null) => void): () => void;
}
