import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RUN_UNSANDBOXED } from '@shared/api/ai/ai-tool-policy';
import {
  PermissionRuleStore,
  permissionRuleKey,
  permissionRuleScope,
  permissionRuleTool,
  permissionSessionKey,
} from './permission-rule-store';

const electron: { userData: string } = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: (): string => electron.userData },
}));

describe('a run outside the sandbox', () => {
  it('canOnlyBeRememberedForTheSession_andForTheExactCommand', () => {
    expect(permissionRuleScope(RUN_UNSANDBOXED, 'npm test')).toBe('session-command');
    expect(permissionRuleKey(RUN_UNSANDBOXED, 'npm test')).toBeNull();
  });

  it('isHeldApartFromTheShell_soAShellGrantNeverCoversIt', () => {
    expect(permissionSessionKey(RUN_UNSANDBOXED, 'npm test')).not.toBe(
      permissionSessionKey('Bash', 'npm test'),
    );
    expect(permissionRuleKey('Bash', 'npm test')).not.toBe(
      permissionSessionKey(RUN_UNSANDBOXED, 'npm test'),
    );
  });

  it('keysEachCommandApart', () => {
    expect(permissionSessionKey(RUN_UNSANDBOXED, 'npm test')).not.toBe(
      permissionSessionKey(RUN_UNSANDBOXED, 'rm -rf /'),
    );
  });

  it('leavesOtherToolsKeyedByName', () => {
    expect(permissionSessionKey('Write', '/a')).toBe('Write');
    expect(permissionSessionKey('Bash', 'npm test')).toBe('Bash');
  });
});

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
      narrowed: ['Bash', 'write_terminal_input'],
    });
  });

  describe('narrowed grants', () => {
    /**
     * Writes a store file.
     * @param stored The file's contents.
     * @returns Returns the file's path.
     */
    function written(stored: unknown): string {
      const file: string = join(electron.userData, 'agent-permission-rules.json');
      writeFileSync(file, JSON.stringify(stored));
      return file;
    }

    it('saysOnce_andAcrossALaunch_whichToolsLostAToolWideGrant', () => {
      const file: string = written({
        always: ['Bash'],
        workspaces: { '/repo': ['open_terminal'] },
      });

      expect(new PermissionRuleStore().isAllowed('Bash', null)).toBe(false);
      expect((JSON.parse(readFileSync(file, 'utf8')) as { narrowed?: unknown }).narrowed).toEqual([
        'Bash',
        'open_terminal',
      ]);

      const next: PermissionRuleStore = new PermissionRuleStore();
      expect(next.takeNarrowed()).toEqual(['Bash', 'open_terminal']);
      expect(next.takeNarrowed()).toEqual([]);
      expect(new PermissionRuleStore().takeNarrowed()).toEqual([]);
      expect(
        (JSON.parse(readFileSync(file, 'utf8')) as { narrowed?: unknown }).narrowed,
      ).toBeUndefined();
    });

    it('saysNothing_whenNoGrantWasDropped', () => {
      written({ always: ['create_file'], workspaces: {} });

      expect(new PermissionRuleStore().takeNarrowed()).toEqual([]);
    });

    it('believesOnlyCommandToolsFromTheFile', () => {
      written({ always: [], workspaces: {}, narrowed: ['Bash', 'made up', 7] });

      expect(new PermissionRuleStore().takeNarrowed()).toEqual(['Bash']);
    });
  });

  describe('listing and revoking', () => {
    /**
     * Writes a store file.
     * @param stored The file's contents.
     */
    function written(stored: unknown): void {
      writeFileSync(join(electron.userData, 'agent-permission-rules.json'), JSON.stringify(stored));
    }

    it('listsToolAndCommandGrants_everywhereThenPerWorkspace', () => {
      const store: PermissionRuleStore = new PermissionRuleStore();
      store.remember('delete_path', 'workspace', '/repo');
      store.remember(permissionRuleKey('Bash', 'ls -la') ?? '', 'always', null);
      store.remember('start_worker', 'always', null);

      expect(store.list()).toEqual([
        expect.objectContaining({ tool: 'Bash', command: 'ls -la', workspaceRoot: null }),
        expect.objectContaining({ tool: 'start_worker', command: null, workspaceRoot: null }),
        expect.objectContaining({ tool: 'delete_path', command: null, workspaceRoot: '/repo' }),
      ]);
    });

    it('datesANewGrant_andKeepsTheDateAcrossALaunch', () => {
      const store: PermissionRuleStore = new PermissionRuleStore();
      store.remember('start_worker', 'always', null);
      const grantedAt: string | null = store.list()[0].grantedAt;

      expect(grantedAt).not.toBeNull();
      expect(Number.isNaN(Date.parse(grantedAt ?? ''))).toBe(false);
      expect(new PermissionRuleStore().list()[0].grantedAt).toBe(grantedAt);
    });

    it('datesEachScopeOfAGrantApart', () => {
      written({
        always: ['start_worker'],
        workspaces: { '/repo': ['start_worker'] },
        grantedAt: { '/repo\u0000start_worker': '2026-11-01T00:00:00.000Z' },
      });

      expect(new PermissionRuleStore().list().map((grant) => grant.grantedAt)).toEqual([
        null,
        '2026-11-01T00:00:00.000Z',
      ]);
    });

    it('keepsAGrantFromBeforeDatesWereKept_withNoDate', () => {
      written({ always: ['start_worker'], workspaces: {} });

      expect(new PermissionRuleStore().list()[0].grantedAt).toBeNull();
    });

    it('losesOnlyTheDate_whenTheStoredDatesAreBad', () => {
      written({ always: ['start_worker'], workspaces: {}, grantedAt: { x: 'not a date', y: 3 } });
      written({ always: ['start_worker'], workspaces: {}, grantedAt: 'nonsense' });

      expect(new PermissionRuleStore().list()).toHaveLength(1);
      expect(new PermissionRuleStore().list()[0].grantedAt).toBeNull();
    });

    it('revoking_stopsTheGrantAtOnce_andAcrossALaunch', () => {
      const store: PermissionRuleStore = new PermissionRuleStore();
      store.remember('start_worker', 'always', null);

      expect(store.revoke('start_worker', null)).toBe(true);

      expect(store.isAllowed('start_worker', null)).toBe(false);
      expect(store.list()).toEqual([]);
      expect(new PermissionRuleStore().isAllowed('start_worker', null)).toBe(false);
    });

    it('revoking_touchesOnlyTheScopeItNames', () => {
      const store: PermissionRuleStore = new PermissionRuleStore();
      store.remember('start_worker', 'always', null);
      store.remember('start_worker', 'workspace', '/repo');
      store.remember('start_worker', 'workspace', '/other');

      store.revoke('start_worker', '/repo');

      expect(store.list().map((grant) => grant.workspaceRoot)).toEqual([null, '/other']);
      expect(new PermissionRuleStore().list()).toHaveLength(2);
    });

    it('revokingAnExactCommand_leavesOtherCommandsOfTheTool', () => {
      const store: PermissionRuleStore = new PermissionRuleStore();
      const ls: string = permissionRuleKey('Bash', 'ls') ?? '';
      const pwd: string = permissionRuleKey('Bash', 'pwd') ?? '';
      store.remember(ls, 'always', null);
      store.remember(pwd, 'always', null);

      store.revoke(ls, null);

      expect(store.isAllowed(ls, null)).toBe(false);
      expect(store.isAllowed(pwd, null)).toBe(true);
    });

    it('revokingWhatIsNotThere_isNotAFailure', () => {
      expect(new PermissionRuleStore().revoke('nothing', '/nowhere')).toBe(true);
    });

    it('revoking_saysSo_whenItCouldNotBeSaved', () => {
      const store: PermissionRuleStore = new PermissionRuleStore();
      store.remember('start_worker', 'always', null);
      const userData: string = electron.userData;
      electron.userData = join(userData, 'agent-permission-rules.json');

      expect(store.revoke('start_worker', null)).toBe(false);

      electron.userData = userData;
      expect(store.isAllowed('start_worker', null)).toBe(false);
    });
  });
});

describe('permissionRuleTool', () => {
  it('namesTheToolOfAToolKey_andOfACommandKey', () => {
    expect(permissionRuleTool('start_worker')).toBe('start_worker');
    expect(permissionRuleTool(permissionRuleKey('Bash', 'ls -la') ?? '')).toBe('Bash');
  });
});
