// Drives the user's Claude sign-in from inside the app, without ever leaving for a terminal and without
// reimplementing Anthropic's OAuth. The installed `claude` CLI stays the login engine: this module reads
// the authoritative sign-in status (`claude auth status --json`) to tell an expired/absent login apart
// from any other run failure, and runs the CLI's own login (`claude auth login --claudeai`) in a hidden
// pseudo-terminal so the CLI opens the browser and, on success, writes credentials in exactly the place
// and format the Agent SDK later reads. The renderer sees only a modal and the browser; the PTY is never
// shown as a dock terminal.

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import * as pty from 'node-pty';
import type { ClaudeAuthStatus, ClaudeLoginStatus } from '@shared/api/ai-types';
import { logger } from '../logger';
import { resolveBundledClaudeExecutable, resolveExecutableOnPath } from './claude-executable';
import { extractLoginUrl, parseLoggedIn } from './claude-login-parse';

/**
 * The largest amount of CLI output retained while scanning for the sign-in URL and, on failure, for the
 * error tail. A login exchange is a few lines; this bound keeps a misbehaving process from growing the
 * buffer without limit.
 */
const MAX_OUTPUT_CHARS: number = 16_384;

/**
 * Resolves the `claude` executable used for login and the status check. The system CLI on the PATH is
 * preferred (it is the full CLI with the `auth` subcommand and self-updates), falling back to the CLI
 * bundled with a packaged build, and finally to the bare name for the OS to resolve. Any of them writes
 * to the same shared credential store, so which one performs the login does not matter.
 * @returns Returns the executable path or name.
 */
function resolveLoginExecutable(): string {
  return resolveExecutableOnPath('claude') ?? resolveBundledClaudeExecutable() ?? 'claude';
}

/**
 * Reads the user's Claude sign-in status by invoking `claude auth status --json`. A missing CLI, a
 * non-zero exit, or an unparseable payload all read as signed-out so the caller fails safe.
 * @returns Returns the sign-in status.
 */
export function readClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
  const file: string = resolveLoginExecutable();
  return new Promise<ClaudeAuthStatus>((resolve): void => {
    execFile(
      file,
      ['auth', 'status', '--json'],
      { timeout: 15_000, windowsHide: true },
      (error: unknown, stdout: string): void => {
        if (error !== null && error !== undefined) {
          logger.debug('claude-login', 'auth status check failed; treating as signed-out', error);
          resolve({ loggedIn: false });
          return;
        }
        resolve(parseLoggedIn(stdout));
      },
    );
  });
}

/**
 * Signs the user out of Claude by invoking `claude auth logout` (a non-interactive command, so a plain
 * child process suffices — no PTY). Used to test the sign-in flow from within the app.
 * @returns Returns whether the logout command succeeded.
 */
export function runClaudeLogout(): Promise<boolean> {
  const file: string = resolveLoginExecutable();
  return new Promise<boolean>((resolve): void => {
    execFile(
      file,
      ['auth', 'logout'],
      { timeout: 15_000, windowsHide: true },
      (error: unknown): void => {
        if (error !== null && error !== undefined) {
          logger.warn('claude-login', 'auth logout failed', error);
          resolve(false);
          return;
        }
        logger.info('claude-login', 'Signed out of Claude');
        resolve(true);
      },
    );
  });
}

/**
 * Runs the `claude` CLI's own login flow in a hidden pseudo-terminal and reports its progress, so the
 * user signs in from the app's modal and browser without a visible terminal. A single login runs at a
 * time; a second {@link start} while one is in flight is ignored.
 */
export class ClaudeLoginDriver {
  /**
   * Holds the running login process, or null when idle.
   */
  private terminal: pty.IPty | null = null;

  /**
   * Holds the CLI output accumulated so far, capped at {@link MAX_OUTPUT_CHARS}, for URL scanning and the
   * failure tail.
   */
  private output: string = '';

  /**
   * Holds a value indicating whether the browser phase (with any scanned URL) has been announced.
   */
  private announcedUrl: boolean = false;

  /**
   * Initializes a new instance of the {@link ClaudeLoginDriver} class.
   * @param emit The sink each progress update is sent to (the renderer stream).
   */
  public constructor(private readonly emit: (status: ClaudeLoginStatus) => void) {}

  /**
   * Starts the login flow. Spawns `claude auth login --claudeai` (Claude subscription; skips the account
   * picker) in a hidden PTY, which opens the browser; the flow resolves to `success` when a valid session
   * exists afterwards, or `error` otherwise.
   */
  public start(): void {
    if (this.terminal !== null) {
      logger.debug('claude-login', 'Login already in progress; ignoring start');
      return;
    }
    const file: string = resolveLoginExecutable();
    this.output = '';
    this.announcedUrl = false;
    logger.info('claude-login', `Starting Claude login via ${file}`);
    this.emit({ phase: 'starting' });
    try {
      const terminal: pty.IPty = pty.spawn(file, ['auth', 'login', '--claudeai'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: homedir(),
        env: process.env,
      });
      this.terminal = terminal;
      terminal.onData((data: string): void => this.onData(data));
      terminal.onExit((event: { exitCode: number }): void => {
        void this.onExit(event.exitCode, terminal);
      });
    } catch (error: unknown) {
      logger.error('claude-login', 'Failed to spawn Claude login', error);
      this.terminal = null;
      this.emit({
        phase: 'error',
        message: 'Could not start the Claude login. Is the Claude CLI installed?',
      });
    }
  }

  /**
   * Cancels an in-flight login, killing the process. No-op when none is running.
   */
  public cancel(): void {
    const terminal: pty.IPty | null = this.terminal;
    if (terminal === null) {
      return;
    }
    logger.info('claude-login', 'Cancelling Claude login');
    this.terminal = null;
    try {
      terminal.kill();
    } catch (error: unknown) {
      logger.debug('claude-login', 'Error killing login process (already exited?)', error);
    }
  }

  /**
   * Disposes the driver, cancelling any in-flight login (called on shutdown).
   */
  public dispose(): void {
    this.cancel();
  }

  /**
   * Accumulates CLI output and, once the CLI is talking, announces the browser phase — carrying the
   * scanned sign-in URL when one is present so the modal can offer a manual open.
   * @param data The output chunk.
   */
  private onData(data: string): void {
    this.output = (this.output + data).slice(-MAX_OUTPUT_CHARS);
    if (this.announcedUrl) {
      return;
    }
    const url: string | undefined = extractLoginUrl(this.output);
    // Announce the browser phase on the first sign the CLI has started (a URL, or any output at all).
    this.announcedUrl = url !== undefined;
    this.emit(url === undefined ? { phase: 'browser' } : { phase: 'browser', url });
  }

  /**
   * Settles the flow when the login process exits: a valid session afterwards is a success, anything else
   * an error carrying the output's tail.
   * @param exitCode The process exit code.
   * @param terminal The process that exited, ignored when it is a superseded one.
   */
  private async onExit(exitCode: number, terminal: pty.IPty): Promise<void> {
    if (this.terminal !== terminal) {
      // A cancelled/superseded process: its late exit must stay silent.
      return;
    }
    this.terminal = null;
    logger.info('claude-login', `Claude login process exited (code ${exitCode})`);
    const status: ClaudeAuthStatus = await readClaudeAuthStatus();
    if (status.loggedIn) {
      this.emit({ phase: 'success' });
      return;
    }
    const tail: string = this.output.trim().split('\n').slice(-3).join(' ').slice(-200);
    this.emit({
      phase: 'error',
      message: tail.length > 0 ? tail : 'Sign-in did not complete.',
    });
  }
}
