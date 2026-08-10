import { TerminalKind } from '@shared/api/terminal-channels';
import { logger } from './logger';

/**
 * The interrupt character (Ctrl+C, ETX). The single input a read-only `task` session lets through to
 * its PTY, where the terminal line discipline turns it into SIGINT for the foreground process group.
 */
const INTERRUPT: string = '\x03';

/**
 * The executable and argument vector a pseudo-terminal spawns.
 */
export interface SpawnSpec {
  /**
   * Gets the file to execute.
   */
  readonly file: string;

  /**
   * Gets the argument vector.
   */
  readonly args: readonly string[];
}

/**
 * Builds the spawn spec for a session: an interactive shell when no command is given; the platform
 * shell running the command non-interactively when a bare command string is given (so `&&` chains and
 * quoting behave as they would at a prompt, and children share the PTY's process group for tree
 * signalling); or the command spawned directly when an argument vector accompanies it.
 * @param platform The process platform (`win32` picks the cmd.exe command syntax).
 * @param shell The resolved shell executable (the interactive shell, and the `-c` host for commands).
 * @param command The command line (or executable) to run, or undefined for an interactive shell.
 * @param args The argument vector for a direct spawn, or undefined to run the command via the shell.
 * @returns Returns the spawn spec.
 */
export function buildSpawnSpec(
  platform: NodeJS.Platform,
  shell: string,
  command?: string,
  args?: readonly string[],
): SpawnSpec {
  if (command === undefined) {
    logger.trace('terminal-spawn.buildSpawnSpec', `Interactive shell spawn: ${shell}`);
    return { file: shell, args: [] };
  }
  if (args !== undefined) {
    logger.trace('terminal-spawn.buildSpawnSpec', `Direct command spawn: ${command}`);
    return { file: command, args };
  }
  logger.trace('terminal-spawn.buildSpawnSpec', `Shell-hosted command spawn via ${shell}`);
  return platform === 'win32'
    ? { file: shell, args: ['/d', '/s', '/c', command] }
    : { file: shell, args: ['-c', command] };
}

/**
 * Determines whether an input chunk may be written to a session of the given kind. `shell` and `run`
 * sessions accept everything; a read-only `task` session accepts only the bare interrupt character
 * (Ctrl+C — "no typing, but Ctrl+C cancels"), so pastes or stray keystrokes never reach the process.
 * @param kind The session kind.
 * @param data The input chunk.
 * @returns Returns true when the input may be written.
 */
export function allowsInput(kind: TerminalKind, data: string): boolean {
  return kind !== 'task' || data === INTERRUPT;
}
