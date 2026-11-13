// The two shell rules Studio's sandbox settings add to the permission gate (Settings S9, #1232):
// Require OS Sandbox and Auto-Allow Sandboxed Shell Commands. Kept apart from the gate so they can be
// read, and tested, as the small decisions they are.

import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { excludedCommandsOf, isExcludedCommand } from './excluded-commands';

/**
 * Names the SDK's shell tool, the only built-in the OS sandbox wraps.
 */
export const SHELL_TOOL: string = 'Bash';

/**
 * Names the permission to run a command outside the sandbox (#1159), as Studio's policy map and prompt
 * know it. Its own name is the point: nothing granted to `Bash` reaches it.
 */
export const RUN_UNSANDBOXED: string = 'Run outside the sandbox';

/**
 * Names the permission for sandboxed commands to bind and connect to ports on this machine (#1162), as
 * Studio's policy map knows it.
 */
export const LOCAL_NETWORK: string = 'Local network';

/**
 * Names the permission for sandboxed commands to reach the container engine's socket (#1162), as
 * Studio's policy map knows it.
 */
export const DOCKER_SOCKET: string = 'Docker socket';

/**
 * Names the permission for sandboxed commands to reach macOS's certificate trust service, as Studio's
 * policy map knows it.
 */
export const CERTIFICATE_CHECKS: string = 'Certificate checks';

/**
 * Lists the permissions Studio's policy map carries that are not tools, so a Deny of one never reaches
 * the SDK's list of tools to withhold.
 */
export const SANDBOX_PERMISSIONS: readonly string[] = [
  RUN_UNSANDBOXED,
  LOCAL_NETWORK,
  DOCKER_SOCKET,
  CERTIFICATE_CHECKS,
];

/**
 * Names the input that asks the SDK's shell to leave the sandbox.
 */
const SANDBOX_FLAG: string = 'dangerouslyDisableSandbox';

/**
 * Teaches rather than only refuses, when the user says no to a run outside the sandbox.
 */
export const UNSANDBOXED_DECLINED: string =
  'The user declined to run this command outside the sandbox. Run it in the sandbox instead. If the ' +
  'sandbox refuses it, tell the user what was refused rather than asking to leave the sandbox again.';

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

  /**
   * Gets the commands the user excluded from the sandbox (#1163); absent means none.
   */
  readonly excludedCommands?: readonly string[];
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

  /**
   * Gets the commands the user excluded from the sandbox (#1163); absent means none.
   */
  readonly excludedCommands?: readonly string[];
}

/**
 * Describes where one opening in the sandbox stands for a session: open, closed until the user allows
 * it, or closed because the user said so.
 */
export type ReachLevel = 'allow' | 'ask' | 'deny';

/**
 * Describes what a session's sandbox may reach beyond its usual limits (#1162).
 */
export interface SandboxReach {
  /**
   * Gets where ports on this machine stand.
   */
  readonly localPorts: ReachLevel;

  /**
   * Gets where the container engine's socket stands.
   */
  readonly dockerSocket: ReachLevel;

  /**
   * Gets where macOS's certificate trust service stands.
   */
  readonly certificateChecks: ReachLevel;
}

/**
 * Describes the turn's settings that decide a {@link SandboxReach}.
 */
export interface ReachSettings {
  /**
   * Gets the run's posture.
   */
  readonly permissionPosture: 'prompt' | 'auto-edits' | 'auto-all';

  /**
   * Gets the permission levels, by name.
   */
  readonly toolPolicies: Readonly<Record<string, 'allow' | 'ask' | 'deny'>>;
}

/**
 * The sandbox as Studio has always opened it: nothing beyond its usual limits.
 */
const NO_REACH: SandboxReach = {
  localPorts: 'ask',
  dockerSocket: 'ask',
  certificateChecks: 'ask',
};

/**
 * Decides one opening: Denied, then an explicit Allowed, then the posture.
 *
 * An explicit Allowed opens it under every posture, Prompt All included (ruled on #1162, 2026-11-11):
 * these have no prompt yet, so under D4 an Allowed on the default posture would otherwise do nothing
 * and the setting would look broken. Allow All opens an Ask only because it may leave the sandbox
 * anyway, so opening it gives nothing away. It does not when leaving the sandbox is itself Denied: the
 * Docker socket reaches a daemon that can mount the host, so a user who keeps agents in the sandbox
 * must not have that opened for them by a posture — though their own explicit Allowed still stands.
 *
 * Only macOS has these knobs. The SDK ignores both on Linux, where the sandbox has no local network and
 * cannot filter sockets by path, so nothing opens there and the agent must not be told otherwise.
 * @param level The permission's level.
 * @param settings The turn's settings.
 * @param platform The platform, as Node names it.
 * @returns Returns where the opening stands.
 */
function reachLevel(
  level: 'allow' | 'ask' | 'deny',
  settings: ReachSettings,
  platform: NodeJS.Platform,
): ReachLevel {
  if (level === 'deny') {
    return 'deny';
  }
  if (platform !== 'darwin') {
    return 'ask';
  }
  if (level === 'allow') {
    return 'allow';
  }
  const posture: boolean =
    settings.permissionPosture === 'auto-all' && settings.toolPolicies[RUN_UNSANDBOXED] !== 'deny';
  return posture ? 'allow' : 'ask';
}

/**
 * Decides what a session's sandbox may reach (#1162). Nothing granted to the shell has any part in
 * this: these are permissions of their own.
 * @param settings The turn's settings.
 * @param platform The platform, as Node names it.
 * @returns Returns where each opening stands.
 */
export function sandboxReach(
  settings: ReachSettings,
  platform: NodeJS.Platform = process.platform,
): SandboxReach {
  return {
    localPorts: reachLevel(settings.toolPolicies[LOCAL_NETWORK] ?? 'ask', settings, platform),
    dockerSocket: reachLevel(settings.toolPolicies[DOCKER_SOCKET] ?? 'ask', settings, platform),
    certificateChecks: reachLevel(
      settings.toolPolicies[CERTIFICATE_CHECKS] ?? 'ask',
      settings,
      platform,
    ),
  };
}

/**
 * Resolves a path to the socket it finally names.
 *
 * 🔥 A sandbox rule matches the real path and does not follow a link, so naming `/var/run/docker.sock`
 * opens nothing: on macOS it is a link to the engine's own socket. And a rule is a subpath, so a
 * directory would open every socket beneath it, which is why only a socket is accepted. Both were
 * checked against the CLI.
 * @param path The path.
 * @returns Returns the real path, or null when it does not end at a socket.
 */
export function realSocket(path: string): string | null {
  try {
    const real: string = realpathSync(path);
    return statSync(real).isSocket() ? real : null;
  } catch {
    return null;
  }
}

/**
 * Finds the sockets the Docker client talks to: the system's path, Docker Desktop's own, and the one
 * the user named in `DOCKER_HOST`. A socket published only through a `docker` context is not found, and
 * one that isn't there yet is picked up by the first turn after it appears.
 * @param env The environment.
 * @param home The user's home directory.
 * @param resolve Resolves a path to the socket it names.
 * @returns Returns the sockets, each once.
 */
export function dockerSocketPaths(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  resolve: (path: string) => string | null = realSocket,
): readonly string[] {
  const named: string = env['DOCKER_HOST'] ?? '';
  const candidates: readonly string[] = [
    '/var/run/docker.sock',
    join(home, '.docker', 'run', 'docker.sock'),
    ...(named.startsWith('unix:///') ? [named.slice('unix://'.length)] : []),
  ];
  return [
    ...new Set<string>(
      candidates
        .map((candidate: string): string | null => resolve(candidate))
        .filter((socket: string | null): socket is string => socket !== null),
    ),
  ];
}

/**
 * Tells the agent where local ports stand, so it does not reach for the flag to find out.
 * @param level Where they stand.
 * @returns Returns the line.
 */
function localPortsLine(level: ReachLevel): string {
  switch (level) {
    case 'allow':
      return '- Local ports: commands may bind and connect to ports on this machine.';
    case 'deny':
      return (
        '- Local ports are denied by the user: a connection to localhost fails. Do not try, and do ' +
        'not leave the sandbox to reach one.'
      );
    default:
      return '- Local ports cannot be reached: a connection to localhost fails.';
  }
}

/**
 * Tells the agent where the Docker socket stands, so it does not reach for the flag to find out.
 * @param level Where it stands.
 * @returns Returns the line.
 */
function dockerSocketLine(level: ReachLevel): string {
  switch (level) {
    case 'allow':
      return '- Docker: commands may reach the container engine through its socket.';
    case 'deny':
      return (
        '- The Docker socket is denied by the user: `docker` commands fail. Do not try, and do not ' +
        'leave the sandbox to reach it.'
      );
    default:
      return '- The Docker socket cannot be reached: `docker` commands fail.';
  }
}

/**
 * Tells the agent where certificate checks stand, so a Go tool's TLS failure is read for what it is.
 * 🔥 `gh` reports the refusal as "the token in keyring is invalid": without this line the agent sends
 * the user off to re-authenticate a token that is fine.
 * @param level Where they stand.
 * @returns Returns the line.
 */
function certificateChecksLine(level: ReachLevel): string {
  switch (level) {
    case 'allow':
      return '- Certificates: Go tools (gh, terraform, gcloud) can verify TLS.';
    case 'deny':
      return (
        '- Certificate checks are denied by the user: Go tools (gh, terraform, gcloud) fail TLS ' +
        'verification (x509 OSStatus -26276), and gh calls it an invalid token. It is not. Do not ' +
        'leave the sandbox to work around it.'
      );
    default:
      return (
        '- Certificate checks cannot be reached: Go tools (gh, terraform, gcloud) fail TLS ' +
        'verification (x509 OSStatus -26276), and gh calls it an invalid token. It is not: the user ' +
        'can allow Certificate Checks.'
      );
  }
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
 * ⛔ Say only what is true today, in words that stay true. It does not point at a per-host
 * `allowed_domains`, which is ignored outside auto mode. A model told of a way out that is not there
 * tries it, fails, and goes back to the flag. Excluded commands (#1163) are real, so it names the ones
 * this session has and says the user can exclude a command that cannot run inside.
 *
 * Lives here rather than in Studio's own instructions because it is about this harness's sandbox:
 * Codex declines to leave its sandbox at all, and a run with no shell has nothing to be told.
 * @param scope What the sandbox was opened with.
 * @param sandboxAvailable Whether this machine has an OS sandbox.
 * @param reach What the sandbox may reach beyond its usual limits.
 * @returns Returns the guidance.
 */
export function sandboxGuidance(
  scope: SandboxScope,
  sandboxAvailable: boolean,
  reach: SandboxReach = NO_REACH,
): string {
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
    localPortsLine(reach.localPorts),
    dockerSocketLine(reach.dockerSocket),
    certificateChecksLine(reach.certificateChecks),
    ...excludedLine(excludedCommandsOf(scope)),
    '',
    'Run commands in the sandbox. Do not set `dangerouslyDisableSandbox` because you expect a command',
    "to fail: try it first. Leaving the sandbox is the user's decision, not a routine step, and it",
    'removes the limits above. When a command does fail because of the sandbox, tell the user what was',
    'refused. They can widen the write paths, network locations, local ports, the Docker socket and',
    'certificate checks under Settings > Artificial Intelligence > Security & Permissions. A toolchain',
    'that cannot run in the sandbox at all (a crash naming dyld or SIGABRT) is one the user can',
    'exclude, for this workspace or every one: ask them to, rather than setting the flag. Set the flag',
    'only when they ask you to, or when the refusal shows the command cannot work in the sandbox, and',
    'say why you are doing it.',
  ].join('\n');
}

/**
 * Says which commands the user excluded from the sandbox, when there are any.
 * @param excluded The session's excluded commands.
 * @returns Returns the line, or none.
 */
function excludedLine(excluded: readonly string[]): readonly string[] {
  return excluded.length === 0
    ? []
    : [
        `- Excluded: ${listed(excluded)} run outside the sandbox, as the user chose; they still ask for permission as any command does.`,
      ];
}

/**
 * Determines whether a tool call asks to run outside the sandbox.
 * @param toolName The tool being called.
 * @param input The call's input.
 * @returns Returns true for a shell command carrying the flag.
 */
export function leavesSandbox(toolName: string, input: Readonly<Record<string, unknown>>): boolean {
  return toolName === SHELL_TOOL && input[SANDBOX_FLAG] === true;
}

/**
 * Removes the request to leave the sandbox, for a user who has denied that: the command runs sandboxed
 * rather than being refused, because the model's reason is usually wrong (99% of them came before any
 * refusal, #1157). The rest of the gate then decides it as the ordinary shell command it now is.
 * @param input The call's input.
 * @returns Returns the input without the flag.
 */
export function withoutSandboxFlag(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const stripped: Record<string, unknown> = { ...input };
  delete stripped[SANDBOX_FLAG];
  return stripped;
}

/**
 * Determines whether a run outside the sandbox goes ahead without asking. Prompt All always asks, even
 * for a permission set to Allowed (D4, #1158); Allow All always grants it, as it always has; between
 * the two the permission's own level decides. Allow Edits is an edit grant and does not reach it.
 * @param policy The permission's level.
 * @param posture The run's posture.
 * @returns Returns true when it needs no prompt.
 */
export function unsandboxedAllowed(
  policy: 'allow' | 'ask' | 'deny',
  posture: 'prompt' | 'auto-edits' | 'auto-all',
): boolean {
  return posture === 'auto-all' || (posture !== 'prompt' && policy === 'allow');
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
 * never auto-allowed — that is its own permission — and nor is one the user excluded from it.
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
    input['dangerouslyDisableSandbox'] !== true &&
    // An excluded command (#1163) runs outside the sandbox without the flag, so Auto-Allow, which is
    // for commands that stay inside it, does not cover it: it asks as any shell command does.
    !isExcludedCommand(
      typeof input['command'] === 'string' ? input['command'] : '',
      excludedCommandsOf(settings),
    )
  ) {
    return { kind: 'allow' };
  }
  return { kind: 'continue' };
}
