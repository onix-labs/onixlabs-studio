/**
 * Names the code-execution IPC channel, and the type its payload carries. This is the run capability's
 * slice of the IPC contract: the shared run-file task provider and the main-process code runner name
 * their channel from here, over the generic {@link import('./bridge').Bridge} transport. It writes an
 * editor buffer to a stable per-key temporary file so a language runner can execute it.
 */
export enum RunChannel {
  /**
   * Writes editor content to a per-key temporary file so a language runner can execute it (invoke).
   */
  WriteTempFile = 'run:write-temp-file',
}

/**
 * Describes the result of writing a temporary file for code execution.
 */
export interface TempFileResult {
  /**
   * Gets a value indicating whether the temporary file was written.
   */
  readonly success: boolean;

  /**
   * Gets the absolute path of the temporary file, when successful.
   */
  readonly path?: string;

  /**
   * Gets the error message, when the write failed.
   */
  readonly error?: string;
}
