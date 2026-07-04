/**
 * Names the task-runner IPC channels, and the types their payloads carry. This is the task
 * capability's slice of the IPC contract: the shared build/task client and the main-process task
 * runner name their channels from here, over the generic {@link import('./bridge').Bridge} transport.
 * A task runs as a child process in the main process; its output and exit stream back to the renderer.
 */
export enum TaskChannel {
  /**
   * Runs a task as a child process (renderer→main, invoke).
   */
  Run = 'tasks:run',

  /**
   * Cancels a running task, terminating its process (renderer→main, invoke).
   */
  Cancel = 'tasks:cancel',

  /**
   * Streams a chunk of a task's output to the renderer (main→renderer, send).
   */
  Output = 'tasks:output',

  /**
   * Notifies the renderer that a task process exited (main→renderer, send).
   */
  Exit = 'tasks:exit',
}

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
