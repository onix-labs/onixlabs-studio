import { describe, expect, it } from 'vitest';
import {
  classifySshFailure,
  parseSshConfig,
  parseSshHost,
  SshFailure,
  sshFailureMessage,
  sshHostOfUrl,
} from './ssh-failure';

/**
 * What git prints after ssh gives up, whatever the reason: never enough on its own to tell anything
 * apart.
 */
const GIT_TAIL: string =
  'fatal: Could not read from remote repository.\n\n' +
  'Please make sure you have the correct access rights\nand the repository exists.\n';

/**
 * The failures as ssh prints them. The OpenSSH 10.5 samples were captured on macOS against a
 * throwaway sshd, through Studio's own `ssh -o BatchMode=yes -o ConnectTimeout=10`; the others are
 * how older OpenSSH releases, other options and Windows' OpenSSH word the same failures.
 */
const UNKNOWN_HOSTS: readonly (readonly [string, string, SshFailure['host']])[] = [
  [
    'OpenSSH 10.5, BatchMode (names no host)',
    `Cloning into 'clone-a'...\nHost key verification failed.\n${GIT_TAIL}`,
    null,
  ],
  [
    'OpenSSH 10.5, StrictHostKeyChecking=yes on a port',
    "Cloning into 'clone-a2'...\nNo ED25519 host key is known for [127.0.0.1]:2299 and you have " +
      `requested strict checking.\nHost key verification failed.\n${GIT_TAIL}`,
    { host: '127.0.0.1', port: 2299 },
  ],
  [
    'OpenSSH 6.x, strict checking',
    'No RSA host key is known for github.com and you have requested strict checking.\r\n' +
      `Host key verification failed.\r\n${GIT_TAIL}`,
    { host: 'github.com' },
  ],
  [
    'OpenSSH 8.x, ECDSA',
    'No ECDSA host key is known for gitlab.example.com and you have requested strict checking.\n' +
      `Host key verification failed.\n${GIT_TAIL}`,
    { host: 'gitlab.example.com' },
  ],
  [
    'OpenSSH 7.x, asked with no terminal to answer',
    "The authenticity of host 'github.com (140.82.112.3)' can't be established.\n" +
      'RSA key fingerprint is SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8.\n' +
      `Are you sure you want to continue connecting (yes/no)? Host key verification failed.\n${GIT_TAIL}`,
    { host: 'github.com' },
  ],
  [
    'OpenSSH 9.x, asked on a port',
    "The authenticity of host '[git.example.com]:2222 ([203.0.113.7]:2222)' can't be established.\n" +
      'ED25519 key fingerprint is SHA256:Ab3dEf.\nThis key is not known by any other names.\n' +
      `Host key verification failed.\n${GIT_TAIL}`,
    { host: 'git.example.com', port: 2222 },
  ],
];

/**
 * A key the server would not take, as ssh says it.
 */
const REJECTED_KEYS: readonly (readonly [string, string, SshFailure['host']])[] = [
  [
    'OpenSSH 10.5, BatchMode, a key with a passphrase',
    `Cloning into 'clone-b'...\nmatthew@127.0.0.1: Permission denied (publickey).\n${GIT_TAIL}`,
    { host: '127.0.0.1' },
  ],
  [
    'OpenSSH 7.x, no user and host before the refusal',
    `Permission denied (publickey).\n${GIT_TAIL}`,
    null,
  ],
  [
    'OpenSSH 7.4 on RHEL, several methods',
    `git@git.corp.example: Permission denied (publickey,gssapi-keyex,gssapi-with-mic).\n${GIT_TAIL}`,
    { host: 'git.corp.example' },
  ],
  [
    'Windows OpenSSH, CRLF line endings',
    `git@github.com: Permission denied (publickey).\r\n${GIT_TAIL.replace(/\n/g, '\r\n')}`,
    { host: 'github.com' },
  ],
  [
    "the user's own command, not in batch mode, with no terminal",
    "Enter passphrase for key '/home/dev/.ssh/id_ed25519': \n" +
      "read_passphrase: can't open /dev/tty: No such device or address\n" +
      `git@github.com: Permission denied (publickey).\n${GIT_TAIL}`,
    { host: 'github.com' },
  ],
  [
    'an agent holding the key locked',
    'sign_and_send_pubkey: signing failed for ED25519 "/Users/dev/.ssh/id_ed25519" from agent: ' +
      `agent refused operation\ngit@bitbucket.org: Permission denied (publickey).\n${GIT_TAIL}`,
    { host: 'bitbucket.org' },
  ],
  [
    'a wrong passphrase in the key file',
    'Load key "/home/dev/.ssh/id_rsa": incorrect passphrase supplied to decrypt private key\n' +
      `Permission denied (publickey,password).\n${GIT_TAIL}`,
    null,
  ],
];

describe('classifySshFailure', () => {
  it.each(UNKNOWN_HOSTS)('recognisesAnUnknownHost: %s', (_name: string, output: string, host) => {
    expect(classifySshFailure(output)).toEqual({ kind: 'ssh-host-unknown', host });
  });

  it.each(REJECTED_KEYS)('recognisesARejectedKey: %s', (_name: string, output: string, host) => {
    expect(classifySshFailure(output)).toEqual({ kind: 'ssh-key-rejected', host });
  });

  it('neverOffersToAddAHostWhoseKeyHasChanged', () => {
    const changed: string =
      '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n' +
      '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n' +
      '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n' +
      'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!\n' +
      'Host key for github.com has changed and you have requested strict checking.\n' +
      `Host key verification failed.\n${GIT_TAIL}`;

    expect(classifySshFailure(changed)).toBeNull();
  });

  it.each([
    [
      'a refused connection (OpenSSH 10.5)',
      'ssh: connect to host 127.0.0.1 port 1: Connection refused',
    ],
    [
      'an unknown name',
      'ssh: Could not resolve hostname nope.invalid: nodename nor servname provided, or not known',
    ],
    ['a password-only server', 'git@host: Permission denied (password).'],
    [
      'a signed-in user without write access',
      'ERROR: Permission to org/repo.git denied to someone.',
    ],
    ['HTTPS', "fatal: Authentication failed for 'https://github.com/org/repo.git/'"],
  ])('leavesAnythingElseAlone: %s', (_name: string, output: string) => {
    expect(classifySshFailure(`${output}\n${GIT_TAIL}`)).toBeNull();
  });

  it('refusesAHostThatWouldReadAsMoreThanAWordInAShell', () => {
    expect(
      classifySshFailure(
        'No ED25519 host key is known for evil;rm and you have requested strict checking.\n' +
          'Host key verification failed.',
      ),
    ).toEqual({ kind: 'ssh-host-unknown', host: null });
  });
});

describe('parseSshHost', () => {
  it.each([
    ['github.com', { host: 'github.com' }],
    ['[git.example.com]:2222', { host: 'git.example.com', port: 2222 }],
    ['[127.0.0.1]:22', { host: '127.0.0.1' }],
    ['[::1]:2200', { host: '::1', port: 2200 }],
    ['-oProxyCommand=x', null],
    ['host$(id)', null],
    ['[host]:70000', null],
  ])('reads %s', (text: string, expected: ReturnType<typeof parseSshHost>) => {
    expect(parseSshHost(text)).toEqual(expected);
  });
});

describe('sshHostOfUrl', () => {
  it.each([
    ['git@github.com:org/repo.git', { host: 'github.com' }],
    ['github.com:org/repo.git', { host: 'github.com' }],
    ['ssh://git@github.com/org/repo.git', { host: 'github.com' }],
    ['ssh://git@127.0.0.1:2299/x.git', { host: '127.0.0.1', port: 2299 }],
    ['git+ssh://me@[::1]:2200/x.git', { host: '::1', port: 2200 }],
    ['ssh://work-github/org/repo.git', { host: 'work-github' }],
    ['https://github.com/org/repo.git', null],
    ['file:///tmp/repo.git', null],
    ['/tmp/remote.git', null],
    ['C:\\repos\\remote.git', null],
  ])('reads %s', (url: string, expected: ReturnType<typeof sshHostOfUrl>) => {
    expect(sshHostOfUrl(url)).toEqual(expected);
  });
});

describe('parseSshConfig', () => {
  it('readsWhereAnAliasReallyPoints', () => {
    expect(parseSshConfig('user git\nhostname github.com\nport 443\nbatchmode no\n')).toEqual({
      host: 'github.com',
      port: 443,
    });
    expect(parseSshConfig('hostname gitlab.com\nport 22\n')).toEqual({ host: 'gitlab.com' });
    expect(parseSshConfig('nothing useful')).toBeNull();
  });
});

describe('sshFailureMessage', () => {
  it('namesTheHostAndBothRemediesForAnUnknownHost', () => {
    const message: string = sshFailureMessage('ssh-host-unknown', {
      host: 'git.example.com',
      port: 2222,
    });

    expect(message).toContain("git.example.com's host key");
    expect(message).toContain('ssh -T -p 2222 git@git.example.com');
    expect(message).toContain('ssh-keyscan -p 2222 git.example.com >> ~/.ssh/known_hosts');
  });

  it('suggestsSshAgentAndTheKeychainForARejectedKey', () => {
    const message: string = sshFailureMessage('ssh-key-rejected', { host: 'github.com' });

    expect(message).toContain("github.com didn't accept your SSH key");
    expect(message).toContain('ssh-add --apple-use-keychain');
  });

  it('readsWithoutAHost', () => {
    expect(sshFailureMessage('ssh-key-rejected', null)).toMatch(/^The SSH server didn't/);
    expect(sshFailureMessage('ssh-host-unknown', null)).toContain("the server's host key");
  });
});
