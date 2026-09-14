// The environment a turn's tools run in, and which Claude Code CLI drives them.
//
// Two things the in-core provider did that only make sense on this side of the seam:
//
//   - **the agent shell.** A user can point the agent at a shell other than their interactive default
//     so its Bash inherits that shell's `PATH` and exports. The turn envelope carries the choice; the
//     capture has to happen wherever the CLI is going to be spawned, which is here.
//   - **the CLI choice**, which arrives as an opaque `providerSettings` key because the protocol must
//     not name a vendor.
//
// ⛔ What is deliberately **absent** is the bundled-executable resolution — 40 lines in core that exist
// only because the SDK sits inside `app.asar`, where a native binary cannot be spawned, so it needs an
// `asarUnpack`ed copy passed as `pathToClaudeCodeExecutable`. **A plugin has no asar.** Its
// `node_modules` are a real directory under the user's data folder, so the SDK resolves its own
// per-platform binary exactly as it does in a development run. The workaround was a consequence of
// being in core, and moving out deletes it rather than porting it. The Codex port found the same thing.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Delimiter framing the `env` dump in the capture script's stdout.
 *
 * A shell profile is free to print banners to stdout while it initialises, so the real environment is
 * bracketed by an unlikely marker and everything outside the two markers is discarded.
 */
const ENV_DELIMITER: string = '__STUDIO_SHELL_ENV_DELIMITER_6b3f0e__';

/**
 * Per-shell cache of captured environments, so a turn sources each shell's profile at most once for
 * the life of this process rather than spawning it every turn. A failed capture is cached too — it
 * will fail again, and retrying costs a shell spawn per turn to learn nothing.
 */
const captureCache: Map<string, Record<string, string> | null> = new Map<
  string,
  Record<string, string> | null
>();

/**
 * Parses the framed `env` dump into a variable map.
 *
 * Only lines whose key is a valid shell identifier are kept, which discards the continuation lines of
 * multi-line values (bash's exported `BASH_FUNC_*` functions, most obviously) rather than injecting
 * garbage keys.
 * @param stdout The raw stdout of the capture script.
 * @returns Returns the parsed variables, or null when the delimiters are missing.
 */
function parseEnvironment(stdout: string): Record<string, string> | null {
  const start: number = stdout.indexOf(ENV_DELIMITER);
  const end: number = stdout.lastIndexOf(ENV_DELIMITER);
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  const variables: Record<string, string> = {};
  for (const line of stdout.slice(start + ENV_DELIMITER.length, end).split('\n')) {
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
 * Captures a shell's profile environment, memoised per shell.
 *
 * `-l` (login) and `-i` (interactive) between them source the profile files a GUI launch skips; `-c`
 * runs the dump and exits. Every failure — a non-POSIX platform, a spawn error, a timeout, missing
 * delimiters — resolves to null so the caller fails **open** and the turn runs with the inherited
 * environment rather than not running at all.
 * @param shell The shell executable to source.
 * @returns Returns the captured variables, or null when the capture could not be completed.
 */
function captureShellEnvironment(shell: string): Record<string, string> | null {
  const cached: Record<string, string> | null | undefined = captureCache.get(shell);
  if (cached !== undefined) {
    return cached;
  }
  const captured: Record<string, string> | null = ((): Record<string, string> | null => {
    if (process.platform === 'win32') {
      return null;
    }
    try {
      const result: SpawnSyncReturns<string> = spawnSync(
        shell,
        ['-l', '-i', '-c', `echo "${ENV_DELIMITER}"; env; echo "${ENV_DELIMITER}"`],
        {
          encoding: 'utf-8',
          timeout: 5000,
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
          env: process.env,
        },
      );
      if (result.error !== undefined || typeof result.stdout !== 'string') {
        return null;
      }
      return parseEnvironment(result.stdout);
    } catch {
      return null;
    }
  })();
  captureCache.set(shell, captured);
  return captured;
}

/**
 * Merges a captured `PATH` with the existing one, preferring the shell's ordering — the user's intended
 * search order — and appending entries the launch environment had that the shell did not, so nothing
 * the runtime injected is dropped.
 * @param captured The `PATH` from the sourced shell.
 * @param existing The `PATH` already in the environment, if any.
 * @returns Returns the merged, de-duplicated `PATH`.
 */
function mergePath(captured: string, existing: string | undefined): string {
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
 * Builds the environment the SDK should run the turn in, or null to leave it inheriting this process's.
 *
 * An explicit environment is built when either an API key must be injected or the user chose an agent
 * shell. ⚠️ The shell's exports **override** the inherited values here, unlike the application's own
 * startup hydrate which only fills gaps: this is an explicit per-agent choice rather than a repair of
 * a GUI launch, so the shell the user named is the one that wins.
 * @param shell The agent shell from the envelope, or null to inherit.
 * @param apiKey The API key to inject, or null when the local login authenticates the run.
 * @returns Returns the environment, or null to inherit.
 */
export function runEnvironment(
  shell: string | null,
  apiKey: string | null,
): Record<string, string> | null {
  const useShell: boolean = typeof shell === 'string' && shell.length > 0;
  if (!useShell && apiKey === null) {
    return null;
  }
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[name] = value;
    }
  }
  if (useShell && shell !== null) {
    const captured: Record<string, string> | null = captureShellEnvironment(shell);
    if (captured !== null) {
      for (const [key, value] of Object.entries(captured)) {
        if (key !== 'PATH') {
          env[key] = value;
        }
      }
      if (typeof captured['PATH'] === 'string' && captured['PATH'].length > 0) {
        env['PATH'] = mergePath(captured['PATH'], env['PATH']);
      }
    }
    env['SHELL'] = shell;
  }
  if (apiKey !== null) {
    env['ANTHROPIC_API_KEY'] = apiKey;
  }
  return env;
}

/**
 * Determines whether this machine has a local Claude login.
 *
 * Asked here rather than of Studio, for the reason the Codex port established: it is a question about
 * **this** process's environment. The CLI reads its own credential store and the harness runs beside
 * it, so a harness that can look is not told — and the protocol deliberately carries no `hasLocalLogin`
 * flag for anyone to read.
 * @param home The home directory to look in.
 * @returns Returns true when a Claude login is present.
 */
export function hasLocalLogin(home: string): boolean {
  return (
    existsSync(join(home, '.claude', '.credentials.json')) ||
    // macOS keeps the credential in the Keychain rather than on disk, so the directory's existence is
    // the only filesystem signal. Coarser, and deliberately so: the cost of guessing wrong is one
    // credential round-trip that answers null, after which the CLI's own login is used anyway.
    (process.platform === 'darwin' && existsSync(join(home, '.claude')))
  );
}

/**
 * Finds an executable on the PATH, returning the first runnable match.
 * @param name The executable name.
 * @param env The environment whose PATH to search.
 * @returns Returns the absolute path, or undefined when not found.
 */
function onPath(name: string, env: Record<string, string | undefined>): string | undefined {
  const path: string | undefined = env['PATH'];
  if (path === undefined || path.length === 0) {
    return undefined;
  }
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const candidate: string = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not present or not executable here; keep looking.
    }
  }
  return undefined;
}

/**
 * Resolves which Claude Code CLI to spawn from the user's choice, which rides in `providerSettings`.
 *
 * Returns undefined for the bundled default — which is this plugin's own `node_modules` copy, resolved
 * by the SDK — and falls back to it when `system` finds nothing on the PATH or `custom` names a path
 * that is not there, so a misconfiguration degrades to a working run rather than a failed one.
 * @param choice The `claudeExecutable` setting, as Studio sent it.
 * @param env The environment the CLI will run in, whose PATH a `system` choice searches.
 * @returns Returns the executable path, or undefined to let the SDK resolve its own.
 */
export function resolveExecutable(
  choice: unknown,
  env: Record<string, string | undefined>,
): string | undefined {
  const mode: unknown = (choice as { mode?: unknown } | null | undefined)?.mode;
  if (mode === 'system') {
    return onPath('claude', env);
  }
  if (mode === 'custom') {
    const custom: unknown = (choice as { path?: unknown }).path;
    if (typeof custom === 'string' && custom.trim().length > 0 && existsSync(custom.trim())) {
      return custom.trim();
    }
    return undefined;
  }
  return undefined;
}
