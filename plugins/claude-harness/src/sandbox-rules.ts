// The two shell rules Studio's sandbox settings add to the permission gate (Settings S9, #1232):
// Require OS Sandbox and Auto-Allow Sandboxed Shell Commands. Kept apart from the gate so they can be
// read, and tested, as the small decisions they are.

import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Names the SDK's shell tool, the only built-in the OS sandbox wraps.
 */
export const SHELL_TOOL: string = 'Bash';

/**
 * Describes what a shell rule decided: refuse with a reason, allow without asking, or leave the
 * command to the rest of the gate.
 */
export type ShellRuleOutcome =
  | { readonly kind: 'deny'; readonly message: string }
  | { readonly kind: 'allow' }
  | { readonly kind: 'continue' };

/**
 * Describes the turn's sandbox settings, as the host sends them. Both are optional, so a host older
 * than the settings gets the behaviour their defaults describe.
 */
export interface ShellRuleSettings {
  /**
   * Gets whether shell commands are refused where the machine has no OS sandbox; absent means on.
   */
  readonly requireSandbox?: boolean;

  /**
   * Gets whether a shell command that runs inside the sandbox goes ahead without asking; absent
   * means off.
   */
  readonly autoAllowSandboxedShell?: boolean;
}

/**
 * Describes what a session's sandbox was opened with, as far as the agent needs telling.
 */
export interface SandboxScope {
  /**
   * Gets the extra places commands may write.
   */
  readonly allowedWritePaths: readonly string[];

  /**
   * Gets where commands may never write: absolute paths or bare path segments.
   */
  readonly deniedWritePaths: readonly string[];

  /**
   * Gets the hosts commands reach without asking.
   */
  readonly allowedNetworkLocations: readonly string[];

  /**
   * Gets the hosts commands may never reach.
   */
  readonly deniedNetworkLocations: readonly string[];

  /**
   * Gets whether shell commands are refused where the machine has no OS sandbox; absent means on.
   */
  readonly requireSandbox?: boolean;
}

/**
 * Lists paths or hosts for a sentence of the guidance.
 * @param entries The entries.
 * @returns Returns them, comma separated.
 */
function listed(entries: readonly string[]): string {
  return entries.join(', ');
}

/**
 * Tells the agent the truth about the sandbox it is in (#1166), for its system prompt.
 *
 * 99% of the commands that left the sandbox in a month did so without being refused first: the model
 * expected trouble, and nothing told it what actually holds. So this says what holds **for this
 * session**, built from what the sandbox was opened with, and what to do instead of reaching for the
 * flag. Every line was checked against the CLI, not assumed (the host rule especially: a host off the
 * list is not refused, it reaches the permission gate).
 *
 * ⛔ Say only what is true today, in words that stay true. It does not point at excluded commands or a
 * per-host `allowed_domains`: the first does not exist yet (#1163) and the second is ignored outside
 * auto mode. A model told of a way out that is not there tries it, fails, and goes back to the flag.
 *
 * Lives here rather than in Studio's own instructions because it is about this harness's sandbox:
 * Codex declines to leave its sandbox at all, and a run with no shell has nothing to be told.
 * @param scope What the sandbox was opened with.
 * @param sandboxAvailable Whether this machine has an OS sandbox.
 * @returns Returns the guidance.
 */
export function sandboxGuidance(scope: SandboxScope, sandboxAvailable: boolean): string {
  if (!sandboxAvailable) {
    return scope.requireSandbox === false
      ? 'This machine has no OS sandbox, so your shell commands run with no confinement beyond the ' +
          'permission prompts. Take that into account before running anything destructive.'
      : 'This machine has no OS sandbox and the user requires one, so shell commands are refused.';
  }
  const writable: string = [
    'the workspace',
    ...(scope.allowedWritePaths.length > 0 ? [listed(scope.allowedWritePaths)] : []),
    'and $TMPDIR',
  ].join(', ');
  const hosts: string =
    scope.allowedNetworkLocations.length > 0
      ? `They reach ${listed(scope.allowedNetworkLocations)} without asking. Any other host`
      : 'Any host';
  return [
    'Your shell commands run inside an OS sandbox. For this session:',
    `- Writes: ${writable}. Nowhere else, and not /tmp itself: use $TMPDIR for temporary files.` +
      (scope.deniedWritePaths.length > 0 ? ` Never: ${listed(scope.deniedWritePaths)}.` : ''),
    `- Network: ${hosts} stops the command to ask the user, who may refuse.` +
      (scope.deniedNetworkLocations.length > 0
        ? ` Never: ${listed(scope.deniedNetworkLocations)}.`
        : ''),
    '- Local ports cannot be reached: a connection to localhost fails.',
    '',
    'Run commands in the sandbox. Do not set `dangerouslyDisableSandbox` because you expect a command',
    "to fail: try it first. Leaving the sandbox is the user's decision, not a routine step, and it",
    'removes the limits above. When a command does fail because of the sandbox, tell the user what was',
    'refused. They can widen the write paths and network locations under Settings > Artificial',
    'Intelligence > Security & Permissions. Set the flag only when they ask you to, or when the refusal',
    'shows the command cannot work in the sandbox, and say why you are doing it.',
  ].join('\n');
}

/**
 * Determines whether a program is on the search path and executable.
 * @param name The program's name.
 * @param searchPath The search path, as the environment's PATH holds it.
 * @returns Returns true when the program is found.
 */
function onPath(name: string, searchPath: string): boolean {
  return searchPath
    .split(delimiter)
    .filter((directory: string): boolean => directory.length > 0)
    .some((directory: string): boolean => {
      try {
        accessSync(join(directory, name), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

/**
 * Determines whether this machine can run the SDK's OS sandbox: macOS always can (Seatbelt); Linux,
 * including WSL 2, when bubblewrap and socat are installed; Windows cannot.
 * @param platform The platform, as Node names it.
 * @param searchPath The search path to look for the Linux sandbox's programs on.
 * @returns Returns true when commands can run sandboxed.
 */
export function osSandboxAvailable(
  platform: NodeJS.Platform = process.platform,
  searchPath: string = process.env['PATH'] ?? '',
): boolean {
  if (platform === 'darwin') {
    return true;
  }
  if (platform === 'linux') {
    return onPath('bwrap', searchPath) && onPath('socat', searchPath);
  }
  return false;
}

/**
 * Applies the sandbox settings to one tool call. Only the shell is affected: with no OS sandbox and
 * Require OS Sandbox on, it is refused with the reason and the way out; with a sandbox and Auto-Allow
 * on, a command that stays inside it runs without asking. A command asking to leave the sandbox is
 * never auto-allowed — that is its own permission.
 * @param toolName The tool being called.
 * @param input The call's input.
 * @param settings The turn's sandbox settings.
 * @param sandboxAvailable Whether this machine has an OS sandbox.
 * @returns Returns what the gate should do with the call.
 */
export function shellRule(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  settings: ShellRuleSettings,
  sandboxAvailable: boolean,
): ShellRuleOutcome {
  if (toolName !== SHELL_TOOL) {
    return { kind: 'continue' };
  }
  if (!sandboxAvailable && settings.requireSandbox !== false) {
    return {
      kind: 'deny',
      message:
        'Blocked: this machine has no OS sandbox to run shell commands in (macOS has one built in; ' +
        'Linux needs bubblewrap and socat installed; Windows has none), and Require OS Sandbox is on. ' +
        'Install the sandbox, or turn Require OS Sandbox off in Settings › Artificial Intelligence › ' +
        'Security & Permissions to run commands without it.',
    };
  }
  if (
    sandboxAvailable &&
    settings.autoAllowSandboxedShell === true &&
    input['dangerouslyDisableSandbox'] !== true
  ) {
    return { kind: 'allow' };
  }
  return { kind: 'continue' };
}
