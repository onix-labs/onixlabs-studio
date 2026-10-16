/**
 * The environment a plugin process is started with.
 *
 * Studio's own environment is the user's whole login shell: at start-up `process.env` is hydrated from
 * it, so every `export` in a profile — a GitHub token, an API key, cloud credentials — is in here. A
 * plugin is code Studio did not write, and it needs none of that to do its job (audit S6). It is given
 * what a program needs to run at all: where programs and the home folder are, the locale, a temporary
 * folder, the SSH agent, proxies, and the few families its own tools read.
 *
 * ⛔ An allow-list, not a deny-list. A deny-list would have to name every secret-shaped variable anyone
 * might export, and would miss the next one; naming what a plugin may have misses nothing it should
 * not.
 */

/**
 * Variables passed by exact name.
 */
const ALLOWED_NAMES: ReadonlySet<string> = new Set<string>([
  // Where things are.
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  // Terminal and locale.
  'TERM',
  'COLORTERM',
  'LANG',
  'LANGUAGE',
  'TZ',
  // The SSH agent, which a version-control tool reaches keys through.
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  // Proxies, which anything that fetches honours.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  // What Windows programs need to start at all.
  'SYSTEMROOT',
  'SystemRoot',
  'SYSTEMDRIVE',
  'SystemDrive',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
  'WINDIR',
  'windir',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PROGRAMFILES',
  'ProgramFiles',
  'ProgramData',
  'PROGRAMDATA',
  // Linux desktops.
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'DBUS_SESSION_BUS_ADDRESS',
]);

/**
 * Variable families passed by prefix: the locale's, the desktop's base directories, and the ones the
 * tools behind the plugins read — Git's own, a container engine's host, and Codex's home.
 */
const ALLOWED_PREFIXES: readonly string[] = [
  'LC_',
  'XDG_',
  'GIT_',
  'DOCKER_',
  'CONTAINER_',
  'CODEX_',
];

/**
 * Determines whether a variable is one a plugin is given.
 * @param name The variable's name.
 * @returns Returns true when it is passed through.
 */
export function isPluginVariable(name: string): boolean {
  return (
    ALLOWED_NAMES.has(name) ||
    ALLOWED_PREFIXES.some((prefix: string): boolean => name.startsWith(prefix))
  );
}

/**
 * Builds the environment a plugin process runs in: the allowed part of this process's environment,
 * with the caller's own variables laid over it.
 * @param overrides The variables the caller sets for the plugin — the runtime flag a Node entry point
 * needs, say.
 * @param source The environment to draw from; defaults to this process's.
 * @returns Returns the environment.
 */
export function pluginEnvironment(
  overrides: Readonly<Record<string, string>> | undefined = undefined,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string' && isPluginVariable(name)) {
      environment[name] = value;
    }
  }
  return { ...environment, ...overrides };
}
