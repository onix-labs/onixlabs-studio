import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOCKER_SOCKET,
  dockerSocketPaths,
  LOCAL_NETWORK,
  osSandboxAvailable,
  ReachLevel,
  ReachSettings,
  realSocket,
  RUN_UNSANDBOXED,
  sandboxGuidance,
  sandboxReach,
  shellRule,
  ShellRuleOutcome,
} from './sandbox-rules';

describe('sandboxGuidance', () => {
  const nothing: Parameters<typeof sandboxGuidance>[0] = {
    allowedWritePaths: [],
    deniedWritePaths: [],
    allowedNetworkLocations: [],
    deniedNetworkLocations: [],
  };

  it('sandboxGuidance_namesTheExcludedCommands_andHowToAskForOne', () => {
    const guidance: string = sandboxGuidance(
      { ...nothing, excludedCommands: ['npx ng:*', 'dotnet:*'] },
      true,
    );

    expect(guidance).toContain('Excluded: npx ng:*, dotnet:* run outside the sandbox');
    expect(guidance).toContain('ask them to, rather than setting the flag');
    expect(sandboxGuidance(nothing, true)).not.toContain('Excluded:');
  });

  it('sandboxGuidance_saysWhatHoldsByDefault', () => {
    const guidance: string = sandboxGuidance(nothing, true);

    expect(guidance).toContain('Writes: the workspace, and $TMPDIR.');
    expect(guidance).toContain('not /tmp itself');
    expect(guidance).toContain('Network: Any host stops the command to ask the user');
    expect(guidance).toContain('a connection to localhost fails');
  });

  it('sandboxGuidance_namesThisSessionsPathsAndHosts', () => {
    const guidance: string = sandboxGuidance(
      {
        allowedWritePaths: ['/extra'],
        deniedWritePaths: ['.env'],
        allowedNetworkLocations: ['github.com', 'api.github.com'],
        deniedNetworkLocations: ['bad.example'],
      },
      true,
    );

    expect(guidance).toContain('Writes: the workspace, /extra, and $TMPDIR.');
    expect(guidance).toContain('Never: .env.');
    expect(guidance).toContain(
      'They reach github.com, api.github.com without asking. Any other host stops',
    );
    expect(guidance).toContain('Never: bad.example.');
  });

  it('sandboxGuidance_tellsTheAgentNotToLeavePreEmptively_andWhatToDoInstead', () => {
    const guidance: string = sandboxGuidance(nothing, true);

    expect(guidance).toContain('Do not set `dangerouslyDisableSandbox`');
    expect(guidance).toContain('tell the user what was\nrefused');
    expect(guidance).toContain('Security & Permissions');
  });

  it('sandboxGuidance_promisesNoWayOutThatDoesNotExist', () => {
    // A per-host `allowed_domains` is ignored outside auto mode. Excluding a command became real with
    // #1163, so the guidance may now name it.
    const guidance: string = sandboxGuidance(nothing, true);

    expect(guidance).not.toContain('allowed_domains');
  });

  it('sandboxGuidance_saysLocalPortsAndDockerAreOutOfReachByDefault', () => {
    const guidance: string = sandboxGuidance(nothing, true);

    expect(guidance).toContain('Local ports cannot be reached');
    expect(guidance).toContain('The Docker socket cannot be reached');
  });

  it('sandboxGuidance_saysWhatIsOpen_whenAllowed', () => {
    const guidance: string = sandboxGuidance(nothing, true, {
      localPorts: 'allow',
      dockerSocket: 'allow',
    });

    expect(guidance).toContain('commands may bind and connect to ports on this machine');
    expect(guidance).toContain('commands may reach the container engine');
    expect(guidance).not.toContain('cannot be reached');
  });

  it('sandboxGuidance_tellsTheAgentNotToTry_norToLeaveTheSandbox_whenDenied', () => {
    const guidance: string = sandboxGuidance(nothing, true, {
      localPorts: 'deny',
      dockerSocket: 'deny',
    });

    expect(guidance).toContain(
      'Local ports are denied by the user: a connection to localhost fails. Do not try, and do not ' +
        'leave the sandbox to reach one.',
    );
    expect(guidance).toContain(
      'The Docker socket is denied by the user: `docker` commands fail. Do not try, and do not ' +
        'leave the sandbox to reach it.',
    );
  });

  it('sandboxGuidance_withNoSandboxButRequired_saysCommandsAreRefused', () => {
    expect(sandboxGuidance(nothing, false)).toContain('shell commands are refused');
  });

  it('sandboxGuidance_withNoSandboxAndNotRequired_saysNothingConfinesThem', () => {
    expect(sandboxGuidance({ ...nothing, requireSandbox: false }, false)).toContain(
      'no confinement',
    );
  });
});

describe('sandboxReach', () => {
  /**
   * Builds the settings for one permission level.
   * @param posture The posture.
   * @param level The level of both permissions, or undefined for none set.
   * @param unsandboxed The level of leaving the sandbox, or undefined for none set.
   * @returns Returns the settings.
   */
  function settings(
    posture: ReachSettings['permissionPosture'],
    level?: 'allow' | 'deny',
    unsandboxed?: 'allow' | 'deny',
  ): ReachSettings {
    return {
      permissionPosture: posture,
      toolPolicies: {
        ...(level === undefined ? {} : { [LOCAL_NETWORK]: level, [DOCKER_SOCKET]: level }),
        ...(unsandboxed === undefined ? {} : { [RUN_UNSANDBOXED]: unsandboxed }),
      },
    };
  }

  it.each<[ReachSettings['permissionPosture'], 'allow' | 'deny' | undefined, ReachLevel]>([
    ['prompt', undefined, 'ask'],
    ['prompt', 'allow', 'ask'],
    ['prompt', 'deny', 'deny'],
    ['auto-edits', undefined, 'ask'],
    ['auto-edits', 'allow', 'allow'],
    ['auto-edits', 'deny', 'deny'],
    ['auto-all', undefined, 'allow'],
    ['auto-all', 'allow', 'allow'],
    ['auto-all', 'deny', 'deny'],
  ])('under %s at level %s_opensAs_%s', (posture, level, expected: ReachLevel) => {
    expect(sandboxReach(settings(posture, level), 'darwin')).toEqual({
      localPorts: expected,
      dockerSocket: expected,
    });
  });

  it('allowAll_doesNotOpenAnAsk_whenLeavingTheSandboxIsDenied', () => {
    expect(sandboxReach(settings('auto-all', undefined, 'deny'), 'darwin')).toEqual({
      localPorts: 'ask',
      dockerSocket: 'ask',
    });
  });

  it('anExplicitAllow_standsEvenWhenLeavingTheSandboxIsDenied', () => {
    expect(sandboxReach(settings('auto-all', 'allow', 'deny'), 'darwin').dockerSocket).toBe(
      'allow',
    );
  });

  it('decidesEachPermissionOnItsOwn', () => {
    expect(
      sandboxReach(
        {
          permissionPosture: 'auto-edits',
          toolPolicies: { [LOCAL_NETWORK]: 'allow', [DOCKER_SOCKET]: 'deny' },
        },
        'darwin',
      ),
    ).toEqual({ localPorts: 'allow', dockerSocket: 'deny' });
  });

  it('nothingGrantedToTheShell_opensEither', () => {
    expect(
      sandboxReach({ permissionPosture: 'auto-edits', toolPolicies: { Bash: 'allow' } }, 'darwin'),
    ).toEqual({ localPorts: 'ask', dockerSocket: 'ask' });
  });

  it.each<NodeJS.Platform>(['linux', 'win32'])('neverOpens_on_%s', (platform: NodeJS.Platform) => {
    expect(sandboxReach(settings('auto-all', 'allow'), platform)).toEqual({
      localPorts: 'ask',
      dockerSocket: 'ask',
    });
    expect(sandboxReach(settings('auto-all', 'deny'), platform).dockerSocket).toBe('deny');
  });
});

describe('realSocket', () => {
  it('refusesADirectory_whichWouldOpenEverySocketBeneathIt', () => {
    expect(realSocket(mkdtempSync(join(tmpdir(), 'sandbox-rules-')))).toBeNull();
  });

  it('refusesAFile_andALinkToOne_andNothingAtAll', () => {
    const folder: string = mkdtempSync(join(tmpdir(), 'sandbox-rules-'));
    writeFileSync(join(folder, 'plain'), '');
    symlinkSync(join(folder, 'plain'), join(folder, 'link'));

    expect(realSocket(join(folder, 'plain'))).toBeNull();
    expect(realSocket(join(folder, 'link'))).toBeNull();
    expect(realSocket(join(folder, 'missing'))).toBeNull();
  });
});

describe('dockerSocketPaths', () => {
  it('namesTheRealSocket_ofTheSystemsPath_andDockerDesktops', () => {
    const real: Record<string, string> = {
      '/var/run/docker.sock': '/Users/me/.docker/run/docker.sock',
      '/Users/me/.docker/run/docker.sock': '/Users/me/.docker/run/docker.sock',
    };

    expect(
      dockerSocketPaths({}, '/Users/me', (path: string): string | null => real[path] ?? null),
    ).toEqual(['/Users/me/.docker/run/docker.sock']);
  });

  it('followsAUnixDockerHost', () => {
    expect(
      dockerSocketPaths({ DOCKER_HOST: 'unix:///run/podman.sock' }, '/h', (path: string) =>
        path === '/run/podman.sock' ? path : null,
      ),
    ).toEqual(['/run/podman.sock']);
  });

  it.each<string>(['tcp://1.2.3.4:2375', 'ssh://host', 'unix://relative', '/not/a/url'])(
    'ignoresADockerHostThatIsNotAnAbsoluteSocket_%s',
    (host: string) => {
      const asked: string[] = [];

      dockerSocketPaths({ DOCKER_HOST: host }, '/h', (path: string): null => {
        asked.push(path);
        return null;
      });

      expect(asked).toEqual(['/var/run/docker.sock', '/h/.docker/run/docker.sock']);
    },
  );

  it('namesNothing_whenNoEngineIsThere', () => {
    expect(dockerSocketPaths({}, '/h', (): null => null)).toEqual([]);
  });
});

describe('osSandboxAvailable', () => {
  it('isAlwaysTrueOnMacOS_andNeverOnWindows', () => {
    expect(osSandboxAvailable('darwin', '')).toBe(true);
    expect(osSandboxAvailable('win32', '/usr/bin')).toBe(false);
  });

  it('onLinux_needsBothBubblewrapAndSocat', () => {
    const bin: string = mkdtempSync(join(tmpdir(), 'sandbox-rules-'));
    writeFileSync(join(bin, 'bwrap'), '', { mode: 0o755 });
    expect(osSandboxAvailable('linux', bin)).toBe(false);

    writeFileSync(join(bin, 'socat'), '', { mode: 0o755 });
    expect(osSandboxAvailable('linux', bin)).toBe(true);
  });
});

describe('shellRule', () => {
  it('doesNotAutoAllowAnExcludedCommand_whichRunsOutsideTheSandbox', () => {
    // #1163: Auto-Allow is for commands that stay inside the sandbox; an excluded one does not.
    const settings: { autoAllowSandboxedShell: boolean; excludedCommands: string[] } = {
      autoAllowSandboxedShell: true,
      excludedCommands: ['npx ng:*'],
    };

    expect(shellRule('Bash', { command: 'npx ng build' }, settings, true)).toEqual({
      kind: 'continue',
    });
    expect(shellRule('Bash', { command: 'ls' }, settings, true)).toEqual({ kind: 'allow' });
  });

  it('leavesEveryOtherToolAlone', () => {
    expect(shellRule('Write', {}, {}, false)).toEqual({ kind: 'continue' });
  });

  it('withNoSandbox_refusesTheShellAndSaysWhy_unlessRequireOsSandboxIsOff', () => {
    const refused: ShellRuleOutcome = shellRule('Bash', { command: 'ls' }, {}, false);
    expect(refused.kind).toBe('deny');
    expect(refused.kind === 'deny' ? refused.message : '').toContain('Require OS Sandbox');

    expect(shellRule('Bash', { command: 'ls' }, { requireSandbox: false }, false)).toEqual({
      kind: 'continue',
    });
  });

  it('withASandbox_autoAllowsOnlyCommandsThatStayInIt', () => {
    const settings: { autoAllowSandboxedShell: boolean } = { autoAllowSandboxedShell: true };

    expect(shellRule('Bash', { command: 'ls' }, settings, true)).toEqual({ kind: 'allow' });
    expect(
      shellRule('Bash', { command: 'ls', dangerouslyDisableSandbox: true }, settings, true),
    ).toEqual({ kind: 'continue' });
    expect(shellRule('Bash', { command: 'ls' }, {}, true)).toEqual({ kind: 'continue' });
  });
});
