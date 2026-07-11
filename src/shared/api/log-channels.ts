/**
 * Names the logging IPC channel and its payload contract. This is the logging capability's slice of
 * the IPC contract: the renderer console forwarder and the main-process logger both name their
 * channel from here, over the generic {@link import('./bridge').Bridge} transport. Logging lives in
 * main because only the main process can write files (dev runs log to stdout instead).
 */
export enum LogChannel {
  /**
   * Forwards one renderer console entry to the main-process logger (renderer→main, fire-and-forget).
   */
  Write = 'log:write',
}

/**
 * Names the console severities the logger accepts, mirroring the intercepted console methods.
 */
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/**
 * Holds every accepted {@link LogLevel}, for validation on the receiving side.
 */
export const LOG_LEVELS: readonly LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

/**
 * Caps a single forwarded message's length. The sender truncates before the IPC hop so an enormous
 * console payload (for example a dumped object graph) cannot bloat the message or the log file; the
 * receiver enforces the same cap on untrusted input.
 */
export const MAX_LOG_MESSAGE_LENGTH: number = 8192;

/**
 * Defines one forwarded console entry.
 */
export interface LogEntry {
  /**
   * Gets the console severity the entry was emitted with.
   */
  readonly level: LogLevel;

  /**
   * Gets the already-serialised, length-capped message text.
   */
  readonly message: string;
}
