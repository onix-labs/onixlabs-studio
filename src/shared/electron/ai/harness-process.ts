import { ChildProcess, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { logger } from '@shared/electron/logger';
import { pidJournal } from '../pid-journal';
import { detachedSpawnOptions, killProcessTree } from '../process-tree';
import type { HarnessTransport } from './harness-host';

/**
 * How to start a harness process.
 */
export interface HarnessSpawnSpec {
  /**
   * Gets the executable to run.
   */
  readonly command: string;

  /**
   * Gets the arguments to pass.
   */
  readonly args: readonly string[];

  /**
   * Gets the working directory, or undefined to inherit.
   */
  readonly cwd?: string;

  /**
   * Gets the environment, or undefined to inherit the process's own.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * The largest line a harness may send, in bytes.
 *
 * A harness is another program and its output is not bounded by anything Studio controls. Without a
 * ceiling a runaway or hostile one could take the main process's memory with it, and the main process
 * is where every window's input is delivered from.
 */
const MAXIMUM_LINE_BYTES: number = 8 * 1024 * 1024;

/**
 * How long a harness gets to exit cleanly before its tree is killed.
 */
const CLOSE_GRACE_MS: number = 2_000;

/**
 * Runs a harness as a child process and carries the protocol over its stdio.
 *
 * The counterpart of `HarnessHost`, which knows the protocol and nothing about processes; this knows
 * processes and nothing about the protocol. Keeping them apart is what lets the host be driven by a
 * fake in tests, and what would let a harness arrive over something other than a pipe later without
 * the protocol noticing.
 *
 * **Process-group leader, journalled**, exactly as the Claude CLI is spawned. Ending a harness must end
 * its whole tool subtree — a harness mid-build must not keep building headless — and a force-killed
 * Studio's surviving harnesses are reaped at the next startup.
 *
 * ⚠️ **stderr is drained, never parsed.** It is a pipe, so it must have a reader or it fills and stalls
 * the harness; and it is not the protocol, so a harness writing a warning there cannot be mistaken for
 * one speaking. That is the same failure #541 was: a CLI's diagnostics arriving where content was
 * expected.
 */
export class HarnessProcess implements HarnessTransport {
  /**
   * Holds the child process.
   */
  private readonly child: ChildProcess;

  /**
   * Holds the line handler, once registered.
   */
  private lineHandler: ((line: string) => void) | null = null;

  /**
   * Holds the close handler, once registered.
   */
  private closeHandler: ((reason: string) => void) | null = null;

  /**
   * Holds whether the process has ended, so a close is reported once.
   */
  private ended: boolean = false;

  /**
   * Initializes a new instance of the {@link HarnessProcess} class, starting the harness.
   * @param spec How to start the harness.
   */
  public constructor(spec: HarnessSpawnSpec) {
    logger.info('HarnessProcess', `Starting harness: ${spec.command}`);
    this.child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env === undefined ? process.env : { ...process.env, ...spec.env },
      // stdin and stdout carry the protocol; stderr is a pipe so it can be drained to the log rather
      // than left to fill.
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...detachedSpawnOptions(),
    });
    pidJournal()?.register(this.child.pid, 'agent', spec.command);
    this.readStdout();
    this.readStderr();
    this.child.once('error', (error: Error): void => this.end(`failed to start: ${error.message}`));
    this.child.once('exit', (code: number | null, signal: string | null): void => {
      pidJournal()?.unregister(this.child.pid);
      this.end(signal === null ? `exited with code ${code ?? 'unknown'}` : `killed by ${signal}`);
    });
  }

  /**
   * Sends one message to the harness.
   * @param line The serialised message, without its terminating newline.
   */
  public send(line: string): void {
    if (this.ended || this.child.stdin === null) {
      return;
    }
    this.child.stdin.write(`${line}\n`);
  }

  /**
   * Registers the handler for lines arriving from the harness.
   * @param handler Invoked once per line received.
   */
  public onLine(handler: (line: string) => void): void {
    this.lineHandler = handler;
  }

  /**
   * Registers the handler for the harness ending.
   * @param handler Invoked with the reason, once.
   */
  public onClose(handler: (reason: string) => void): void {
    this.closeHandler = handler;
    if (this.ended) {
      handler('already ended');
    }
  }

  /**
   * Ends the harness and its whole tool subtree.
   *
   * stdin is closed first so a harness that watches for end-of-input can exit cleanly; the tree is
   * ended after a grace period for one that does not.
   */
  public close(): void {
    this.child.stdin?.end();
    if (this.child.pid !== undefined && !this.ended) {
      killProcessTree(this.child.pid, CLOSE_GRACE_MS);
    }
  }

  /**
   * Reads protocol lines off stdout.
   */
  private readStdout(): void {
    if (this.child.stdout === null) {
      this.end('no stdout');
      return;
    }
    const lines: readline.Interface = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    lines.on('line', (line: string): void => {
      if (line.length > MAXIMUM_LINE_BYTES) {
        logger.warn('HarnessProcess', `Refused a ${line.length}-byte line as implausible`);
        return;
      }
      this.lineHandler?.(line);
    });
  }

  /**
   * Drains stderr into the log.
   *
   * Never handed to the protocol. A harness's diagnostics are worth keeping and worth reading, but a
   * warning is not a message, and treating it as one is how a CLI's notice ends up rendered as
   * something the model said.
   */
  private readStderr(): void {
    if (this.child.stderr === null) {
      return;
    }
    const lines: readline.Interface = readline.createInterface({
      input: this.child.stderr,
      crlfDelay: Infinity,
    });
    lines.on('line', (line: string): void => logger.debug('HarnessProcess', `stderr: ${line}`));
  }

  /**
   * Reports the harness ending, once.
   * @param reason Why it ended.
   */
  private end(reason: string): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.closeHandler?.(reason);
  }
}
