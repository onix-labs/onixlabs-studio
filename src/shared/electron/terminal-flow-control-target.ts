/**
 * Describes the side of a terminal session that can be told to stop producing: a PTY, whose child
 * blocks on a full pipe once its output stops being read.
 */
export interface TerminalFlowControlTarget {
  /**
   * Stops reading the session's output.
   */
  pause(): void;

  /**
   * Starts reading the session's output again.
   */
  resume(): void;
}
