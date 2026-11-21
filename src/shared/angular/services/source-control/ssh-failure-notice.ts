import type { VcsSshHost } from '@shared/api/version-control-protocol';

/**
 * Describes what a notification says about an SSH failure a non-interactive git could not get past
 * (#1255): what went wrong and what to do, in the user's language, and the commands that do it.
 */
export interface SshFailureNotice {
  /**
   * Gets the explanation and the remedy.
   */
  readonly detail: string;

  /**
   * Gets the commands that carry out the remedy, for the user to copy into a terminal. Empty when the
   * server is not known, since a command naming the wrong one would do harm.
   */
  readonly commands: readonly string[];
}

/**
 * Matches a host name or IP address that can go into a shell command as a single plain word. The host
 * arrives from a plugin and the command is pasted into a terminal, so it is checked here again.
 */
const SAFE_HOST: RegExp = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,252}|[0-9A-Fa-f:.]{2,45})$/;

/**
 * Narrows the server a failure names to one safe to put in a command.
 * @param value The untrusted server.
 * @returns Returns the server, or null when there is none or it is not safe.
 */
export function safeSshHost(value: unknown): VcsSshHost | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { host, port } = value as Record<string, unknown>;
  if (typeof host !== 'string' || !SAFE_HOST.test(host)) {
    return null;
  }
  if (port === undefined || port === 22) {
    return { host };
  }
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536
    ? { host, port }
    : null;
}

/**
 * Words a failure coded `ssh-key-rejected` or `ssh-host-unknown`, or nothing for any other failure,
 * which is shown as the plugin worded it.
 * @param code The failure's code.
 * @param sshHost The server the failure names, untrusted.
 * @param platform The operating system, for the macOS keychain's own ssh-add flag.
 * @returns Returns the notice, or null when the failure is not one of the two.
 */
export function sshFailureNotice(
  code: string | undefined,
  sshHost: unknown,
  platform: string | undefined,
): SshFailureNotice | null {
  const server: VcsSshHost | null = safeSshHost(sshHost);
  if (code === 'ssh-key-rejected') {
    return {
      detail:
        server === null
          ? $localize`:SSH sign-in failure, when the server is not known:The SSH server didn't accept your key. If the key has a passphrase, Studio can't ask you for it. Load the key into ssh-agent, then try again.`
          : $localize`:SSH sign-in failure. host is a server name such as github.com:${server.host}:host: didn't accept your SSH key. If the key has a passphrase, Studio can't ask you for it. Load the key into ssh-agent, then try again.`,
      // On macOS the keychain remembers the passphrase, so the key stays loaded after a restart.
      commands: [platform === 'darwin' ? 'ssh-add --apple-use-keychain' : 'ssh-add'],
    };
  }
  if (code === 'ssh-host-unknown') {
    if (server === null) {
      return {
        detail: $localize`:SSH unknown-host failure, when the server is not known:SSH doesn't know this server's host key yet, and Studio can't ask you to accept it. Connect to the server once in a terminal, or add its key to your known hosts, then try again.`,
        commands: [],
      };
    }
    const port: string = server.port === undefined ? '' : ` -p ${server.port}`;
    return {
      detail: $localize`:SSH unknown-host failure. host is a server name such as github.com:SSH doesn't know the host key of ${server.host}:host: yet, and Studio can't ask you to accept it. Connect to it once in a terminal and check the key, or add the key to your known hosts, then try again.`,
      commands: [
        `ssh -T${port} git@${server.host}`,
        `ssh-keyscan${port} ${server.host} >> ~/.ssh/known_hosts`,
      ],
    };
  }
  return null;
}
