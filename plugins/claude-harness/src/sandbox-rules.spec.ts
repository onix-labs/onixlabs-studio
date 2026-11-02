import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { osSandboxAvailable, shellRule, ShellRuleOutcome } from './sandbox-rules';

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
