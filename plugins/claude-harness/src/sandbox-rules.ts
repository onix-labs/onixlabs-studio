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
