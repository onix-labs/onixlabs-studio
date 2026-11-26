import { safeSshHost, sshFailureNotice, SshFailureNotice } from './ssh-failure-notice';

describe('sshFailureNotice', () => {
  it('aRejectedKey_onMacOS_suggestsTheKeychain', () => {
    const notice: SshFailureNotice | null = sshFailureNotice(
      'ssh-key-rejected',
      { host: 'github.com' },
      'darwin',
    );

    expect(notice?.detail).toBe(
      "github.com didn't accept your SSH key. If the key has a passphrase, Studio can't ask you " +
        'for it. Load the key into ssh-agent, then try again.',
    );
    expect(notice?.commands).toEqual(['ssh-add --apple-use-keychain']);
  });

  it('aRejectedKey_elsewhere_suggestsSshAdd', () => {
    expect(sshFailureNotice('ssh-key-rejected', undefined, 'linux')).toEqual({
      detail:
        "The SSH server didn't accept your key. If the key has a passphrase, Studio can't ask " +
        'you for it. Load the key into ssh-agent, then try again.',
      commands: ['ssh-add'],
    });
  });

  it('anUnknownHost_namesItInBothCommands', () => {
    const notice: SshFailureNotice | null = sshFailureNotice(
      'ssh-host-unknown',
      { host: 'github.com' },
      'darwin',
    );

    expect(notice?.detail).toContain('the host key of github.com');
    expect(notice?.commands).toEqual([
      'ssh -T git@github.com',
      'ssh-keyscan github.com | ssh-keygen -lf -',
    ]);
  });

  it('anUnknownHostOnAPort_passesThePort', () => {
    expect(
      sshFailureNotice('ssh-host-unknown', { host: '127.0.0.1', port: 2299 }, 'linux')?.commands,
    ).toEqual(['ssh -T -p 2299 git@127.0.0.1', 'ssh-keyscan -p 2299 127.0.0.1 | ssh-keygen -lf -']);
  });

  it('anUnknownHostThatIsNotNamed_offersNoCommand', () => {
    const notice: SshFailureNotice | null = sshFailureNotice(
      'ssh-host-unknown',
      undefined,
      'linux',
    );

    expect(notice?.commands).toEqual([]);
    expect(notice?.detail).toContain("this server's host key");
  });

  it('aServerThatWouldInjectIntoTheCommand_isNotNamed', () => {
    expect(
      sshFailureNotice('ssh-host-unknown', { host: 'x; rm -rf ~' }, 'linux')?.commands,
    ).toEqual([]);
    expect(sshFailureNotice('ssh-host-unknown', { host: '$(id)' }, 'linux')?.commands).toEqual([]);
  });

  it('anyOtherFailure_isLeftAlone', () => {
    expect(sshFailureNotice(undefined, undefined, 'darwin')).toBeNull();
    expect(sshFailureNotice('conflicted', { host: 'github.com' }, 'darwin')).toBeNull();
  });
});

describe('safeSshHost', () => {
  it.each([
    [{ host: 'github.com' }, { host: 'github.com' }],
    [{ host: 'github.com', port: 22 }, { host: 'github.com' }],
    [
      { host: '::1', port: 2200 },
      { host: '::1', port: 2200 },
    ],
    [{ host: '-oProxyCommand=x' }, null],
    [{ host: 'a b' }, null],
    [{ host: 'github.com', port: 0 }, null],
    [{ host: 'github.com', port: '22' }, null],
    [{ host: 42 }, null],
    ['github.com', null],
    [null, null],
  ])('narrows %j', (value: unknown, expected: ReturnType<typeof safeSshHost>) => {
    expect(safeSshHost(value)).toEqual(expected);
  });
});
