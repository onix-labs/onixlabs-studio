import { TerminalKind } from '@shared/api/terminal-channels';
import { logger } from './logger';

/**
 * The interrupt character (Ctrl+C, ETX). The single input a read-only `task` session lets through to
 * its PTY, where the terminal line discipline turns it into SIGINT for the foreground process group.
 */
const INTERRUPT: string = '\x03';

/**
 * Holds the most arguments Shell Arguments may give a shell; anything longer is not a set of options.
 */
const MAX_SHELL_ARGUMENTS: number = 64;

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
 * @param shellArgs The arguments an interactive shell starts with (see {@link interactiveShellArgs}).
 * @returns Returns the spawn spec.
 */
export function buildSpawnSpec(
  platform: NodeJS.Platform,
  shell: string,
  command?: string,
  args?: readonly string[],
  shellArgs: readonly string[] = [],
): SpawnSpec {
  if (command === undefined) {
    logger.trace('terminal-spawn.buildSpawnSpec', `Interactive shell spawn: ${shell}`);
    return { file: shell, args: shellArgs };
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

/**
 * Builds the arguments an interactive shell starts with: `-l` first when it starts as a login shell
 * (outside Windows, which has none), then Shell Arguments.
 * @param platform The process platform.
 * @param shellArguments Shell Arguments as written, or undefined for none.
 * @param login Whether the shell starts as a login shell.
 * @returns Returns the arguments, or null when Shell Arguments cannot be read.
 */
export function interactiveShellArgs(
  platform: NodeJS.Platform,
  shellArguments: string | undefined,
  login: boolean,
): readonly string[] | null {
  const written: readonly string[] | null = splitShellArguments(shellArguments ?? '');
  if (written === null) {
    return null;
  }
  return login && platform !== 'win32' ? ['-l', ...written] : written;
}

/**
 * Splits arguments written as on a command line: separated by spaces, grouped by single or double
 * quotes, with a backslash taking the next character literally outside single quotes. Nothing is
 * expanded — no variables, no globs — since no shell reads the line.
 * @param text The arguments as written.
 * @returns Returns the arguments, or null when a quote is left open, a NUL appears, or there are more
 * than the shell is ever given.
 */
export function splitShellArguments(text: string): readonly string[] | null {
  if (text.includes('\0')) {
    return null;
  }
  const parsed: string[] = [];
  let current: string = '';
  let started: boolean = false;
  let quote: '"' | "'" | null = null;
  for (let index: number = 0; index < text.length; index++) {
    const character: string = text[index];
    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === '\\' && index + 1 < text.length) {
      current += text[++index];
      started = true;
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        parsed.push(current);
        current = '';
        started = false;
      }
    } else {
      current += character;
      started = true;
    }
  }
  if (quote !== null) {
    return null;
  }
  if (started) {
    parsed.push(current);
  }
  return parsed.length > MAX_SHELL_ARGUMENTS ? null : parsed;
}

/**
 * Determines whether two program names are one program: alike once a login shell's leading dash and a
 * Windows extension are dropped, and regardless of case.
 * @param running The foreground program's name.
 * @param shell The shell's name.
 * @returns Returns true when they are the same program.
 */
export function sameProgram(running: string, shell: string): boolean {
  const normal: (name: string) => string = (name: string): string =>
    name
      .replace(/^-/, '')
      .replace(/\.exe$/i, '')
      .toLowerCase();
  return normal(running) === normal(shell);
}
