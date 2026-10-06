import { describe, expect, it } from 'vitest';
import { blockedCommandMessage, findBlockedCommand } from './blocked-commands';

describe('findBlockedCommand', () => {
  const BLOCKED: readonly string[] = ['gh'];

  it('findsTheCommand_wheneverTheLineRunsIt', () => {
    for (const line of [
      'gh issue list',
      'cd src && gh pr create --fill',
      'npm test; gh run rerun 7',
      'git log | gh issue create -F -',
      'echo $(gh auth token)',
      'echo `gh api user`',
      '(gh repo view)',
      'GH_TOKEN=x gh issue list',
      'sudo -E gh auth status',
      'env FOO=1 gh api user',
      '/usr/local/bin/gh issue list',
      'npm run build\ngh pr merge 1',
    ]) {
      expect(findBlockedCommand(line, BLOCKED), line).toBe('gh');
    }
  });

  it('letsALineThatOnlyMentionsTheName_through', () => {
    for (const line of [
      'git log --grep gh',
      'ls ghost',
      'npm run gh-pages',
      'grep -r "gh" src',
      'echo high',
      'cat .github/workflows/ci.yml',
    ]) {
      expect(findBlockedCommand(line, BLOCKED), line).toBeNull();
    }
  });

  it('blocksNothing_withNothingBlocked', () => {
    expect(findBlockedCommand('gh issue list', [])).toBeNull();
  });

  it('saysWhatToUseInstead', () => {
    expect(blockedCommandMessage('gh')).toContain('hosting_* tools');
  });
});
