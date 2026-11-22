// Recognising the two SSH failures a non-interactive git cannot get past (#1255).
//
// Studio's own SSH command runs with BatchMode, so ssh never prompts: a key with a passphrase is simply
// not used, and a server whose host key is not yet known is simply refused. Git then says only that it
// "could not read from remote repository". What ssh printed before that is what tells the two apart,
// and OpenSSH words it differently from version to version and with different options, so each case
// is matched on any of the phrasings it is known to take rather than on one exact line.

import type { VcsErrorCode, VcsSshHost } from './protocol';

/**
 * Names the SSH failures this recognises: the matching subset of the protocol's codes.
 */
export type SshFailureKind = Extract<VcsErrorCode, 'ssh-key-rejected' | 'ssh-host-unknown'>;

/**
 * Describes an SSH failure recognised in a tool's output.
 */
export interface SshFailure {
  /**
   * Gets which failure it is.
   */
  readonly kind: SshFailureKind;

  /**
   * Gets the server ssh named while failing, or null when it named none (OpenSSH 10 says only "Host
   * key verification failed.", and older versions say "Permission denied (publickey)." alone).
   */
  readonly host: VcsSshHost | null;
}

/**
 * Matches a host key that is known but no longer matches. ssh ends that with "Host key verification
 * failed." too, but it may be an attack, so it is never treated as a host to add: the user is left
 * with ssh's own warning instead.
 */
const CHANGED_HOST_KEY: RegExp =
  /REMOTE HOST IDENTIFICATION HAS CHANGED|POSSIBLE DNS SPOOFING|host key for \S+ has changed|host key has changed/i;

/**
 * Matches any of ssh's warning signs: its `@@@` banners, a `WARNING:` line, a revoked key ("REVOKED
 * HOST KEY DETECTED"), and CheckHostIP's "differs from the key for the IP address" and "Offending key
 * for IP" (on by default before OpenSSH 8.5, and in Windows' 8.1). Each also ends in "Host key
 * verification failed.", and each may be an attack, so output carrying one is never classified: the
 * user reads ssh's own warning rather than a remedy that would trust the key.
 */
const WARNING_SIGNS: RegExp = /@@@|WARNING:|revoked|differs from the key for the IP|Offending/i;

/**
 * Matches a line the server sent through git (`remote: …`), from a hook or the server's own
 * messages. The server chooses its words, so none of them is read as something ssh said.
 */
const REMOTE_LINE: RegExp = /^\s*remote:.*$/gim;

/**
 * Matches a server whose host key is not known: BatchMode's bare "Host key verification failed.",
 * strict checking's "No ED25519 host key is known for …" (RSA, ECDSA and DSA in older versions), and
 * the question asked with no terminal to answer it.
 */
const UNKNOWN_HOST: RegExp =
  /host key verification failed|no [a-z0-9-]+ host key is known for|authenticity of host '[^']*' can'?t be established/i;

/**
 * Matches a key that could not be used: the server's refusal once every key was tried, from
 * "Permission denied (publickey)." to "Permission denied (publickey,gssapi-keyex,gssapi-with-mic).",
 * and the passphrase prompt or agent refusal that comes before it when the user's own command is not
 * in batch mode.
 */
const KEY_REJECTED: RegExp =
  /permission denied \((?:[\w-]+,)*publickey|read_passphrase: can'?t open \/dev\/tty|enter passphrase for (?:key|\S+)|incorrect passphrase supplied|agent refused operation|sign_and_send_pubkey: signing failed/i;

/**
 * Finds the server in strict checking's "No … host key is known for HOST and …".
 */
const NO_HOST_KEY_FOR: RegExp = /no [a-z0-9-]+ host key is known for (\S+) and/i;

/**
 * Finds the server in "The authenticity of host 'HOST (ADDRESS)' can't be established."
 */
const AUTHENTICITY_OF: RegExp = /authenticity of host '([^' (]+)/i;

/**
 * Finds the server in "USER@HOST: Permission denied (…)", as OpenSSH has said it since 6.x.
 */
const DENIED_BY: RegExp = /^(?:[^@\s]+@)?([^\s@:]+|\[[^\]\s]+\](?::\d+)?): permission denied \(/im;

/**
 * Matches a host name or IP address: letters, digits, dots, hyphens and underscores, or the hex
 * digits, colons and dots of an IPv6 address. Nothing a shell would read as anything but a word, since
 * the host ends up in a command the user is invited to paste.
 */
const SAFE_HOST: RegExp = /^(?:[A-Za-z0-9](?:[A-Za-z0-9._-]{0,252})|[0-9A-Fa-f:.]{2,45})$/;

/**
 * Recognises an SSH failure in a failed network command's output.
 * @param output Everything git printed (and the failure message), in any order.
 * @returns Returns the failure, or null when it is neither of the two this recognises.
 */
export function classifySshFailure(output: string): SshFailure | null {
  // The server's own lines are dropped before anything is read, so a hook cannot pose as ssh or choose
  // the host a suggested command names.
  const text: string = output.replace(/\r/g, '').replace(REMOTE_LINE, '');
  if (CHANGED_HOST_KEY.test(text) || WARNING_SIGNS.test(text)) {
    return null;
  }
  if (UNKNOWN_HOST.test(text)) {
    const named: string | undefined =
      NO_HOST_KEY_FOR.exec(text)?.[1] ?? AUTHENTICITY_OF.exec(text)?.[1];
    return { kind: 'ssh-host-unknown', host: named === undefined ? null : parseSshHost(named) };
  }
  if (KEY_REJECTED.test(text)) {
    const named: string | undefined = DENIED_BY.exec(text)?.[1];
    return { kind: 'ssh-key-rejected', host: named === undefined ? null : parseSshHost(named) };
  }
  return null;
}

/**
 * Reads a server as ssh writes it: `host`, or `[host]:port` for a port other than 22.
 * @param text The server as written.
 * @returns Returns the server, or null when it is not a host name this would put in a command.
 */
export function parseSshHost(text: string): VcsSshHost | null {
  const bracketed: RegExpExecArray | null = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  const host: string = bracketed?.[1] ?? text;
  return sshHost(host, bracketed?.[2] === undefined ? undefined : Number(bracketed[2]));
}

/**
 * Reads the SSH server out of a remote URL: `ssh://[user@]host[:port]/path` (and the `git+ssh` and
 * `ssh+git` spellings), or the scp-like `[user@]host:path`.
 * @param url The remote URL.
 * @returns Returns the server, or null when the URL is not an SSH one.
 */
export function sshHostOfUrl(url: string): VcsSshHost | null {
  const trimmed: string = url.trim();
  const full: RegExpExecArray | null =
    /^(?:ssh|git\+ssh|ssh\+git):\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^:/]+)(?::(\d+))?(?:\/|$)/i.exec(
      trimmed,
    );
  if (full !== null) {
    return sshHost(
      full[1].replace(/^\[|\]$/g, ''),
      full[2] === undefined ? undefined : Number(full[2]),
    );
  }
  // scp-like: no scheme, and a colon before the first slash. A Windows drive (`C:\…`) is a local path.
  const scp: RegExpExecArray | null = /^(?:[^@/:]+@)?(\[[^\]]+\]|[^:/]+):(?!\/\/)/.exec(trimmed);
  if (scp === null || trimmed.includes('://') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return null;
  }
  return sshHost(scp[1].replace(/^\[|\]$/g, ''), undefined);
}

/**
 * Reads where `ssh -G` says it would really connect: the `hostname` and `port` an alias in the user's
 * ssh config resolves to. `ssh-keyscan` reads no config, so the remedy must name the real server.
 * @param output What `ssh -G` printed.
 * @returns Returns the server, or null when the output names none.
 */
export function parseSshConfig(output: string): VcsSshHost | null {
  const hostname: string | undefined = /^hostname\s+(\S+)$/im.exec(output)?.[1];
  const port: string | undefined = /^port\s+(\d+)$/im.exec(output)?.[1];
  return hostname === undefined
    ? null
    : sshHost(hostname, port === undefined ? undefined : Number(port));
}

/**
 * Words an SSH failure in English, for a host that does not know the codes, and for the log.
 * @param kind The failure.
 * @param host The server, or null when it is not known.
 * @returns Returns the message.
 */
export function sshFailureMessage(kind: SshFailureKind, host: VcsSshHost | null): string {
  const name: string = host?.host ?? 'the server';
  const port: string = host?.port === undefined ? '' : ` -p ${host.port}`;
  if (kind === 'ssh-host-unknown') {
    const fix: string =
      host === null
        ? 'Connect to it once in a terminal with ssh, or add it with ssh-keyscan'
        : `Connect to it once in a terminal (ssh -T${port} git@${host.host}), or add it with ` +
          `ssh-keyscan${port} ${host.host} >> ~/.ssh/known_hosts`;
    return (
      `SSH doesn't know ${name}'s host key yet, and Studio runs git without a terminal, so it ` +
      `can't ask you to accept it. ${fix}, then try again.`
    );
  }
  return (
    `${host === null ? 'The SSH server' : name} didn't accept your SSH key. Studio runs git ` +
    "without a terminal, so it can't ask for a key's passphrase: load the key into ssh-agent " +
    'with ssh-add (on macOS, ssh-add --apple-use-keychain), then try again.'
  );
}

/**
 * Builds a server, refusing a host or port that should not go into a command.
 * @param host The host name or address.
 * @param port The port, or undefined for 22.
 * @returns Returns the server, or null when either part is unusable.
 */
function sshHost(host: string, port: number | undefined): VcsSshHost | null {
  if (!SAFE_HOST.test(host) || host.startsWith('-')) {
    return null;
  }
  if (port === undefined || port === 22) {
    return { host };
  }
  return Number.isInteger(port) && port > 0 && port < 65536 ? { host, port } : null;
}
