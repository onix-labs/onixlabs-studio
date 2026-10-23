// Signs the user in to Claude, reports whether they are signed in, and signs them out: the `auth`
// exchange of protocol 1.17.0 (#1080).
//
// This used to live in core, which was core knowing how one vendor signs its users in. It belongs here,
// beside the CLI it drives. Studio keeps the sign-in window and asks; what answers is this.
//
// The CLI stays the login engine. Nothing here reimplements Anthropic's OAuth: `claude auth login`
// opens the browser, waits for the callback, and writes the credential where the Agent SDK reads it.
// What this adds is the progress Studio's window shows, and the sign-in page's address for when the
// browser did not open.
//
// 🔑 No terminal. Core ran the login in a hidden pseudo-terminal, which this plugin cannot ship without a
// native module per platform. It was never needed: with plain pipes the CLI still prints the address,
// starts its callback listener and waits, which is all the window wants (checked against CLI 2.1.261).
// stdin is held open rather than closed, because the CLI's fallback is to read a pasted code, and an
// input that ended would read as an empty one.

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { resolveExecutable } from './environment';
import { note } from './log';

/**
 * Where an `auth` exchange stands. Mirrors `HarnessAuthState` in Studio's protocol.
 */
export type AuthState =
  | { readonly phase: 'starting' }
  | { readonly phase: 'browser'; readonly url?: string }
  | { readonly phase: 'signed-in'; readonly account?: string }
  | { readonly phase: 'signed-out'; readonly detail?: string };

/**
 * What an `auth` message asks for.
 */
export type AuthAction = 'status' | 'login' | 'logout';

/**
 * The most CLI output kept while scanning for the sign-in address and, on failure, for its last lines.
 * A sign-in prints a few lines; the bound stops a misbehaving process growing the buffer forever.
 */
const MAX_OUTPUT_CHARS: number = 16_384;

/**
 * How long a status check or a sign-out may take before it counts as failed.
 */
const COMMAND_TIMEOUT_MS: number = 15_000;

/**
 * The processes this needs, injectable so the flow is testable without a CLI.
 */
export interface AuthPorts {
  /**
   * Runs a command to completion.
   * @param file The executable.
   * @param args Its arguments.
   * @returns Returns whether it exited cleanly, and what it printed.
   */
  readonly run: (
    file: string,
    args: readonly string[],
  ) => Promise<{ readonly ok: boolean; readonly stdout: string }>;

  /**
   * Starts a long-running command with piped output and an open input.
   * @param file The executable.
   * @param args Its arguments.
   * @returns Returns the process.
   */
  readonly start: (file: string, args: readonly string[]) => ChildProcess;
}

/**
 * The real processes.
 */
const nodePorts: AuthPorts = {
  run: (file: string, args: readonly string[]): Promise<{ ok: boolean; stdout: string }> =>
    new Promise((resolve): void => {
      execFile(
        file,
        [...args],
        { timeout: COMMAND_TIMEOUT_MS, windowsHide: true },
        (error: unknown, stdout: string): void => {
          resolve({ ok: error === null || error === undefined, stdout: String(stdout ?? '') });
        },
      );
    }),
  start: (file: string, args: readonly string[]): ChildProcess =>
    spawn(file, [...args], {
      cwd: homedir(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }),
};

/**
 * Finds the `claude` binary the Agent SDK installed beside this plugin: its per-platform package
 * (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`), in the same `node_modules` as this package.
 *
 * Needed only here. A turn leaves the bundled binary to the SDK, which finds its own; `claude auth` is
 * run directly, so something has to say where the SDK's copy is.
 * @param entryDirectory The directory this plugin's `main.js` runs from.
 * @param platform The platform to resolve for.
 * @param arch The architecture to resolve for.
 * @returns Returns the binary's path, or undefined when it is not there.
 */
export function bundledExecutable(
  entryDirectory: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  // `main.js` sits at `<install>/node_modules/@onixlabs/claude-harness/main.js`.
  let directory: string = entryDirectory;
  while (basename(directory) !== 'node_modules') {
    const parent: string = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
  const binary: string = join(
    directory,
    '@anthropic-ai',
    `claude-agent-sdk-${platform}-${arch}`,
    platform === 'win32' ? 'claude.exe' : 'claude',
  );
  return existsSync(binary) ? binary : undefined;
}

/**
 * Resolves the CLI the exchange runs: the user's choice, as for a turn, and otherwise the bundled copy.
 *
 * ⛔ The same choice a turn uses. Core's sign-in preferred whatever `claude` was on the PATH even when
 * the user had chosen the bundled one, so the CLI that signed them in was not the one that then ran.
 * @param choice The `claudeExecutable` setting, as Studio sent it.
 * @param entryDirectory The directory this plugin's `main.js` runs from.
 * @returns Returns the executable path, or the bare name for the OS to resolve.
 */
export function authExecutable(choice: unknown, entryDirectory: string): string {
  return resolveExecutable(choice, process.env) ?? bundledExecutable(entryDirectory) ?? 'claude';
}

/**
 * Reads `claude auth status --json` into a settled state. Anything but an explicit `loggedIn: true`
 * reads as signed out, so a changed or unreadable payload offers sign-in rather than assuming a login.
 * @param stdout The command's output.
 * @returns Returns the state.
 */
export function parseStatus(stdout: string): AuthState {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (typeof parsed !== 'object' || parsed === null) {
      return { phase: 'signed-out' };
    }
    const record: Record<string, unknown> = parsed as Record<string, unknown>;
    if (record['loggedIn'] !== true) {
      return { phase: 'signed-out' };
    }
    const email: unknown = record['email'];
    return typeof email === 'string' && email.length > 0
      ? { phase: 'signed-in', account: email }
      : { phase: 'signed-in' };
  } catch {
    return { phase: 'signed-out' };
  }
}

/**
 * Finds the first sign-in address in the CLI's output, trimming punctuation a line may have put round it.
 * @param text The output so far.
 * @returns Returns the address, or undefined when none has been printed.
 */
export function extractLoginUrl(text: string): string | undefined {
  const match: RegExpExecArray | null = /https:\/\/[^\s'"]+/.exec(text);
  return match === null ? undefined : match[0].replace(/[).,'"\]]+$/, '');
}

/**
 * Signs the user in, checks, or signs them out, reporting each state as it is reached.
 * @param action What to do.
 * @param file The CLI to run.
 * @param report Receives each state; the last one settles the exchange.
 * @param ports The processes to run it with.
 * @returns Returns a way to stop a sign-in in flight, which does nothing once it has settled.
 */
export function runAuth(
  action: AuthAction,
  file: string,
  report: (state: AuthState) => void,
  ports: AuthPorts = nodePorts,
): () => void {
  const status: () => Promise<AuthState> = async (): Promise<AuthState> => {
    const result: { ok: boolean; stdout: string } = await ports.run(file, [
      'auth',
      'status',
      '--json',
    ]);
    return result.ok ? parseStatus(result.stdout) : { phase: 'signed-out' };
  };
  if (action === 'status') {
    void status().then(report);
    return (): void => undefined;
  }
  if (action === 'logout') {
    void ports.run(file, ['auth', 'logout']).then(status).then(report);
    return (): void => undefined;
  }
  return login(file, report, status, ports);
}

/**
 * Runs `claude auth login --claudeai` and reports its progress: starting, then the browser (with the
 * address once the CLI prints it), then signed in or out by what the CLI says once it exits.
 * @param file The CLI to run.
 * @param report Receives each state.
 * @param status Reads the settled sign-in state.
 * @param ports The processes to run it with.
 * @returns Returns a way to stop it.
 */
function login(
  file: string,
  report: (state: AuthState) => void,
  status: () => Promise<AuthState>,
  ports: AuthPorts,
): () => void {
  note(`auth: signing in with ${file}`);
  report({ phase: 'starting' });
  let output: string = '';
  let announcedUrl: boolean = false;
  let settled: boolean = false;
  let child: ChildProcess;
  try {
    // `--claudeai` is the subscription sign-in, which skips the CLI's choice of account kind.
    child = ports.start(file, ['auth', 'login', '--claudeai']);
  } catch (error: unknown) {
    note(`auth: could not start the sign-in: ${String(error)}`);
    report({ phase: 'signed-out', detail: 'Could not start the Claude sign-in.' });
    return (): void => undefined;
  }
  const onData: (chunk: Buffer | string) => void = (chunk: Buffer | string): void => {
    output = (output + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
    if (announcedUrl || settled) {
      return;
    }
    const url: string | undefined = extractLoginUrl(output);
    announcedUrl = url !== undefined;
    report(url === undefined ? { phase: 'browser' } : { phase: 'browser', url });
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  const settle: (state: AuthState) => void = (state: AuthState): void => {
    if (!settled) {
      settled = true;
      report(state);
    }
  };
  child.on('error', (error: Error): void => {
    note(`auth: the sign-in failed to run: ${error.message}`);
    settle({ phase: 'signed-out', detail: 'Could not start the Claude sign-in.' });
  });
  child.on('exit', (code: number | null): void => {
    note(`auth: the sign-in exited (code ${String(code)})`);
    void status().then((state: AuthState): void => {
      if (state.phase === 'signed-in') {
        settle(state);
        return;
      }
      const tail: string = output.trim().split('\n').slice(-3).join(' ').slice(-200);
      settle({ phase: 'signed-out', detail: tail.length > 0 ? tail : 'Sign-in did not complete.' });
    });
  });
  return (): void => {
    if (!settled) {
      child.kill();
    }
  };
}
