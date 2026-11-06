import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { osSandboxAvailable, sandboxGuidance, shellRule, ShellRuleOutcome } from './sandbox-rules';

describe('sandboxGuidance', () => {
  const nothing: Parameters<typeof sandboxGuidance>[0] = {
    allowedWritePaths: [],
    deniedWritePaths: [],
    allowedNetworkLocations: [],
    deniedNetworkLocations: [],
  };

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

  it('sandboxGuidance_promisesNoWayOutThatDoesNotExistYet', () => {
    const guidance: string = sandboxGuidance(nothing, true);

    expect(guidance).not.toContain('allowed_domains');
    expect(guidance).not.toContain('exclude');
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
