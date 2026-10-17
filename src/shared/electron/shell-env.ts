// Captures the environment of the user's login/interactive shell so that, when the application is
// launched from the GUI (Finder/Dock/Spotlight on macOS, a desktop entry on Linux), the variables a
// user only ever exports from `~/.zshrc` / `~/.bash_profile` — API tokens such as `GITHUB_TOKEN`, and
// a fully-populated `PATH` — are present in `process.env`. A GUI launch inherits only launchd's minimal
// environment and never sources a shell profile, so without this both the AI agent (whose Bash runs
// under the inherited env) and the terminal would be missing those exports.
//
// The low-level `captureShellEnvironment` is deliberately separable so a later per-agent shell setting
// (issue #318) can source a specific shell's profile the same way.

import { execFile, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { logger } from '@shared/electron/logger';

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
  const candidates: (string | undefined)[] = [
    process.env['SHELL'],
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ];
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
  logger.trace('shell-env', `Capturing environment from ${shell}`);
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
 * A capture remembered between launches: which shell it came from, what its profile files looked like
 * when it was taken, and what it found.
 */
export interface ShellEnvironmentCache {
  /**
   * Gets the shell the environment was captured from.
   */
  readonly shell: string;

  /**
   * Gets the modification time of each profile file the capture depended on, or null for one that did
   * not exist. The capture is as fresh as these.
   */
  readonly stamps: Readonly<Record<string, number | null>>;

  /**
   * Gets the captured variables.
   */
  readonly variables: Readonly<Record<string, string>>;
}

/**
 * Lists the files a shell reads when it starts as a login and interactive shell — the ones whose
 * change can change what a capture would find — for the shell's family, plus the system-wide path
 * lists macOS composes `PATH` from. A file that does not exist is listed too: its appearing is a
 * change.
 * @param shell The shell executable.
 * @param home The user's home folder.
 * @returns Returns the files.
 */
export function profileFilesFor(shell: string, home: string): readonly string[] {
  const name: string = basename(shell);
  const system: string[] = ['/etc/paths', '/etc/paths.d', '/etc/profile', '/etc/zshenv'];
  if (name === 'zsh') {
    const zdot: string = process.env['ZDOTDIR'] ?? home;
    return [
      ...system,
      '/etc/zprofile',
      '/etc/zshrc',
      '/etc/zlogin',
      join(zdot, '.zshenv'),
      join(zdot, '.zprofile'),
      join(zdot, '.zshrc'),
      join(zdot, '.zlogin'),
    ];
  }
  if (name === 'fish') {
    return [...system, '/etc/fish/config.fish', join(home, '.config', 'fish', 'config.fish')];
  }
  return [
    ...system,
    '/etc/bashrc',
    '/etc/bash.bashrc',
    join(home, '.bash_profile'),
    join(home, '.bash_login'),
    join(home, '.profile'),
    join(home, '.bashrc'),
  ];
}

/**
 * Reads the modification time of each file, or null for one that does not exist.
 * @param files The files.
 * @returns Returns the stamps, keyed by file.
 */
export function profileStamps(files: readonly string[]): Record<string, number | null> {
  const stamps: Record<string, number | null> = {};
  for (const file of files) {
    try {
      stamps[file] = statSync(file).mtimeMs;
    } catch {
      stamps[file] = null;
    }
  }
  return stamps;
}

/**
 * Determines whether two sets of stamps describe the same files at the same times.
 * @param a One set.
 * @param b The other.
 * @returns Returns true when nothing differs.
 */
export function sameStamps(
  a: Readonly<Record<string, number | null>>,
  b: Readonly<Record<string, number | null>>,
): boolean {
  const keys: string[] = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((key: string): boolean => a[key] === b[key])
  );
}

/**
 * Reads a remembered capture, or null when there is none or it cannot be read.
 * @param file The cache file.
 * @returns Returns the cache, or null.
 */
export function readShellEnvironmentCache(file: string): ShellEnvironmentCache | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record: Record<string, unknown> = parsed as Record<string, unknown>;
    if (
      typeof record['shell'] !== 'string' ||
      typeof record['stamps'] !== 'object' ||
      record['stamps'] === null ||
      typeof record['variables'] !== 'object' ||
      record['variables'] === null
    ) {
      return null;
    }
    const variables: Record<string, string> = {};
    for (const [key, value] of Object.entries(record['variables'] as Record<string, unknown>)) {
      if (typeof value === 'string') {
        variables[key] = value;
      }
    }
    const stamps: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(record['stamps'] as Record<string, unknown>)) {
      stamps[key] = typeof value === 'number' ? value : null;
    }
    return { shell: record['shell'], stamps, variables };
  } catch {
    return null;
  }
}

/**
 * Remembers a capture for the next launch, best-effort.
 * @param file The cache file.
 * @param cache The capture.
 */
export function writeShellEnvironmentCache(file: string, cache: ShellEnvironmentCache): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 });
  } catch (error: unknown) {
    logger.warn('shell-env', 'Could not remember the shell environment', error);
  }
}

/**
 * Captures a shell's environment without blocking, for refreshing a remembered capture after the
 * profile files changed.
 * @param shell The shell executable.
 * @param timeoutMs How long the shell may take.
 * @returns Returns the captured variables, or null when the capture could not be completed.
 */
function captureShellEnvironmentAsync(
  shell: string,
  timeoutMs: number,
): Promise<Record<string, string> | null> {
  const script: string = `echo "${ENV_DELIMITER}"; env; echo "${ENV_DELIMITER}"`;
  return new Promise<Record<string, string> | null>((resolve): void => {
    try {
      execFile(
        shell,
        ['-l', '-i', '-c', script],
        { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, env: process.env },
        (error: Error | null, stdout: string): void =>
          resolve(error !== null ? null : parseEnvironment(stdout)),
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Per-shell cache of captured environments, so a per-run consumer (the configurable agent shell,
 * #318) sources each shell's profile at most once per session rather than spawning it every run. The
 * installed shells' profiles do not change within a session; a restart re-captures.
 */
const captureCache: Map<string, Record<string, string> | null> = new Map<
  string,
  Record<string, string> | null
>();

/**
 * Captures a shell's environment like {@link captureShellEnvironment}, memoising the result (including
 * a failed capture) by shell path so repeated callers do not re-spawn the shell.
 * @param shell The shell executable to source.
 * @param options Capture options, applied only on the first (uncached) call for a given shell.
 * @returns Returns the captured variables, or null when the capture could not be completed.
 */
export function captureShellEnvironmentCached(
  shell: string,
  options: CaptureOptions = {},
): Record<string, string> | null {
  const cached: Record<string, string> | null | undefined = captureCache.get(shell);
  if (cached !== undefined) {
    logger.trace('shell-env', `Shell environment cache hit for ${shell}`);
    return cached;
  }
  const captured: Record<string, string> | null = captureShellEnvironment(shell, options);
  captureCache.set(shell, captured);
  return captured;
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
 * Layers a captured shell environment over a base environment, returning a new string-only map. Every
 * captured variable is applied — overriding the base when `override` is true (an explicit per-agent
 * shell choice, #318) or only filling gaps when false (the startup hydrate, which must not clobber the
 * real launch environment, #317) — except `PATH`, which is always merged so the shell's search order
 * takes effect without dropping the base's extra entries.
 * @param base The environment to layer onto (e.g. `process.env`); non-string values are dropped.
 * @param captured The captured shell environment.
 * @param override Whether captured values replace existing base values (true) or only fill gaps (false).
 * @returns Returns the merged environment as a new map.
 */
export function applyCapturedEnvironment(
  base: Record<string, string | undefined>,
  captured: Record<string, string>,
  override: boolean,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  for (const [key, value] of Object.entries(captured)) {
    if (key === 'PATH') {
      continue;
    }
    if (override || result[key] === undefined) {
      result[key] = value;
    }
  }
  if (typeof captured['PATH'] === 'string' && captured['PATH'].length > 0) {
    result['PATH'] = mergePath(captured['PATH'], result['PATH']);
  }
  return result;
}

/**
 * Sanitises an untrusted agent-shell value from the renderer into a shell path or null. Only an
 * absolute path is honoured (the installed-shells picker always supplies one); an empty string, a
 * bare name, or a non-string falls back to null, meaning the inherited environment is used. A bogus
 * absolute path that passes here fails open later, at capture time.
 * @param value The candidate value from the run request.
 * @returns Returns the trimmed absolute shell path, or null to inherit the environment.
 */
export function sanitizeAgentShell(value: unknown): string | null {
  return typeof value === 'string' && value.trim().startsWith('/') ? value.trim() : null;
}

/**
 * Hydrates `process.env` from the user's login shell so a GUI launch gains the exports it would
 * otherwise miss. Runs once (guarded by a marker), only on POSIX, and can be forced or disabled via
 * environment switches for testing. Every captured variable that is not already set is added — the
 * real launch environment is never clobbered — except `PATH`, which is merged so the shell's enriched
 * search path takes effect. Any failure leaves `process.env` untouched.
 *
 * Capturing means starting the user's shell and waiting for its profile, which with a tool manager or
 * a framework in it takes a second or two — on every launch, before the window exists (audit P2). So
 * the capture is remembered between launches, stamped with the profile files it depended on: while
 * they are unchanged the remembered capture is applied at once; when one has changed the remembered
 * capture is still applied at once and a fresh one is taken in the background for the next launch;
 * only the very first launch waits.
 *
 * Skipped by default when `TERM` is set, since a terminal launch has already sourced the profile; set
 * `STUDIO_FORCE_SHELL_ENV=1` to capture regardless (useful when running from an IDE), or
 * `STUDIO_DISABLE_SHELL_ENV=1` to turn the capture off entirely.
 * @param cacheFile The file the capture is remembered in, or undefined to capture every time.
 */
export function hydrateLoginShellEnvironment(cacheFile?: string): void {
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
    logger.trace('shell-env', 'Skipping shell-env hydrate: TERM present (terminal launch)');
    return;
  }

  const shell: string = resolveDefaultShell();
  const files: readonly string[] = profileFilesFor(shell, homedir());
  const stamps: Record<string, number | null> = profileStamps(files);
  const remembered: ShellEnvironmentCache | null =
    cacheFile === undefined ? null : readShellEnvironmentCache(cacheFile);
  process.env[CAPTURED_MARKER] = '1';

  if (remembered !== null && remembered.shell === shell) {
    apply(remembered.variables, shell, 'remembered');
    if (sameStamps(remembered.stamps, stamps)) {
      return;
    }
    // A profile changed since: this launch runs with what was remembered, the next with what is there.
    logger.info('shell-env', `Shell profile changed; refreshing the remembered environment`);
    void captureShellEnvironmentAsync(shell, 5000).then((captured): void => {
      if (captured !== null && cacheFile !== undefined) {
        writeShellEnvironmentCache(cacheFile, { shell, stamps, variables: captured });
      }
    });
    return;
  }

  logger.debug('shell-env', `Hydrating login shell environment from ${shell}`);
  const captured: Record<string, string> | null = captureShellEnvironment(shell);
  if (!captured) {
    logger.warn('shell-env', `Shell environment capture from ${shell} failed; using inherited env`);
    return;
  }
  apply(captured, shell, 'captured');
  if (cacheFile !== undefined) {
    writeShellEnvironmentCache(cacheFile, { shell, stamps, variables: captured });
  }
}

/**
 * Lays captured variables into `process.env`: gaps only, never clobbering the real launch
 * environment; `PATH` merged.
 * @param variables The captured variables.
 * @param shell The shell they came from, for the log.
 * @param how Whether they were remembered or freshly captured, for the log.
 */
function apply(
  variables: Readonly<Record<string, string>>,
  shell: string,
  how: 'remembered' | 'captured',
): void {
  const before: number = Object.keys(process.env).length;
  Object.assign(process.env, applyCapturedEnvironment(process.env, variables, false));
  const added: number = Object.keys(process.env).length - before;
  logger.info(
    'shell-env',
    `Hydrated shell environment from ${shell} (${how}, +${added} vars, PATH merged)`,
  );
}
