// Captures the environment of the user's login/interactive shell so that, when the application is
// launched from the GUI (Finder/Dock/Spotlight on macOS, a desktop entry on Linux), the variables a
// user only ever exports from `~/.zshrc` / `~/.bash_profile` — API tokens such as `GITHUB_TOKEN`, and
// a fully-populated `PATH` — are present in `process.env`. A GUI launch inherits only launchd's minimal
// environment and never sources a shell profile, so without this both the AI agent (whose Bash runs
// under the inherited env) and the terminal would be missing those exports.
//
// The low-level `captureShellEnvironment` is deliberately separable so a later per-agent shell setting
// (issue #318) can source a specific shell's profile the same way.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

/**
 * Delimiter framing the `env` dump in the capture script's stdout. A shell profile is free to print
 * banners/noise to stdout while it initialises, so the real environment is bracketed by this unlikely
 * marker and everything outside the two markers is discarded.
 */
export const ENV_DELIMITER: string = '__STUDIO_SHELL_ENV_DELIMITER_6b3f0e__';

/**
 * Marker written into `process.env` once a hydrate has run, so a repeat call (or an accidental second
 * invocation) is a cheap no-op rather than another shell spawn.
 */
const CAPTURED_MARKER: string = 'STUDIO_SHELL_ENV_CAPTURED';

/**
 * Options controlling a single shell-environment capture.
 */
interface CaptureOptions {
  /**
   * Milliseconds after which the shell spawn is abandoned, so a slow or hanging profile can never
   * delay startup indefinitely. Defaults to 5000.
   */
  readonly timeoutMs?: number;
}

/**
 * Resolves the shell whose profile should be sourced, walking a fallback chain so an empty or stale
 * `SHELL` does not surface as a spawn failure. Mirrors the terminal's own shell resolution.
 * @returns Returns the shell executable path.
 */
function resolveDefaultShell(): string {
  const candidates: (string | undefined)[] = [process.env['SHELL'], '/bin/zsh', '/bin/bash', '/bin/sh'];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return '/bin/sh';
}

/**
 * Parses the framed `env` dump into a variable map. Only lines whose key is a valid shell identifier
 * are kept, which discards the continuation lines of multi-line values (e.g. bash's exported
 * `BASH_FUNC_*` functions) rather than injecting garbage keys.
 * @param stdout The raw stdout of the capture script.
 * @returns Returns the parsed variables, or null when the delimiters are missing (a failed capture).
 */
export function parseEnvironment(stdout: string): Record<string, string> | null {
  const start: number = stdout.indexOf(ENV_DELIMITER);
  const end: number = stdout.lastIndexOf(ENV_DELIMITER);
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const body: string = stdout.slice(start + ENV_DELIMITER.length, end);
  const variables: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const separator: number = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key: string = line.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    variables[key] = line.slice(separator + 1);
  }
  return variables;
}

/**
 * Captures the environment of the given shell by running it as a login + interactive shell (so it
 * sources the profile files a GUI launch skips) and dumping `env` between two delimiters. The spawn
 * inherits the current `process.env` so the shell can locate itself, and is bounded by a timeout;
 * any failure (non-POSIX platform, spawn error, timeout, missing delimiters) resolves to null so the
 * caller can fail open.
 * @param shell The shell executable to source (e.g. `/bin/zsh`).
 * @param options Capture options.
 * @returns Returns the captured variables, or null when the capture could not be completed.
 */
export function captureShellEnvironment(
  shell: string,
  options: CaptureOptions = {},
): Record<string, string> | null {
  if (process.platform === 'win32') {
    return null;
  }

  // `-l` (login) and `-i` (interactive) between them source the profile files the GUI launch missed;
  // `-c` runs the dump and exits. stdout is framed so profile banners printed around it are stripped.
  const script: string = `echo "${ENV_DELIMITER}"; env; echo "${ENV_DELIMITER}"`;
  try {
    const result: SpawnSyncReturns<string> = spawnSync(shell, ['-l', '-i', '-c', script], {
      encoding: 'utf-8',
      timeout: options.timeoutMs ?? 5000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: process.env,
    });
    if (result.error || typeof result.stdout !== 'string') {
      return null;
    }
    return parseEnvironment(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Merges a captured `PATH` with the existing one, preferring the shell's ordering (the user's intended
 * search order) and appending any entries the launch environment had that the shell did not. Keeping
 * the existing extras avoids dropping paths Electron or the OS injected.
 * @param captured The `PATH` from the sourced shell.
 * @param existing The `PATH` already in `process.env`, if any.
 * @returns Returns the merged, de-duplicated `PATH`.
 */
export function mergePath(captured: string, existing: string | undefined): string {
  const seen: Set<string> = new Set<string>();
  const merged: string[] = [];
  for (const entry of [...captured.split(':'), ...(existing ?? '').split(':')]) {
    if (entry.length > 0 && !seen.has(entry)) {
      seen.add(entry);
      merged.push(entry);
    }
  }
  return merged.join(':');
}

/**
 * Hydrates `process.env` from the user's login shell so a GUI launch gains the exports it would
 * otherwise miss. Runs once (guarded by a marker), only on POSIX, and can be forced or disabled via
 * environment switches for testing. Every captured variable that is not already set is added — the
 * real launch environment is never clobbered — except `PATH`, which is merged so the shell's enriched
 * search path takes effect. Any failure leaves `process.env` untouched.
 *
 * Skipped by default when `TERM` is set, since a terminal launch has already sourced the profile; set
 * `STUDIO_FORCE_SHELL_ENV=1` to capture regardless (useful when running from an IDE), or
 * `STUDIO_DISABLE_SHELL_ENV=1` to turn the capture off entirely.
 */
export function hydrateLoginShellEnvironment(): void {
  if (process.platform === 'win32') {
    return;
  }
  if (process.env[CAPTURED_MARKER] === '1' || process.env['STUDIO_DISABLE_SHELL_ENV'] === '1') {
    return;
  }
  // A terminal launch (TERM present) already carries a sourced environment, so the capture would only
  // add startup latency; the force switch overrides this for IDE/GUI-style launches that set TERM.
  const forced: boolean = process.env['STUDIO_FORCE_SHELL_ENV'] === '1';
  if (!forced && typeof process.env['TERM'] === 'string' && process.env['TERM'].length > 0) {
    return;
  }

  const shell: string = resolveDefaultShell();
  const captured: Record<string, string> | null = captureShellEnvironment(shell);
  process.env[CAPTURED_MARKER] = '1';
  if (!captured) {
    console.warn(`[startup] shell environment capture from ${shell} failed; using inherited env`);
    return;
  }

  let added: number = 0;
  for (const [key, value] of Object.entries(captured)) {
    if (key === 'PATH' || key === CAPTURED_MARKER) {
      continue;
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      added++;
    }
  }
  if (typeof captured['PATH'] === 'string' && captured['PATH'].length > 0) {
    process.env['PATH'] = mergePath(captured['PATH'], process.env['PATH']);
  }
  console.info(`[startup] hydrated shell environment from ${shell} (+${added} vars, PATH merged)`);
}
