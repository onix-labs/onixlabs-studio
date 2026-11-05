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

  it('seesThroughQuotesEscapesShellsAndValues_whichUsedToSlipPast', () => {
    // Audit S10: each of these ran `gh` and passed the check.
    for (const line of [
      'sh -c "gh auth token"',
      'bash -lc gh',
      "zsh -c 'gh pr list'",
      'eval gh auth token',
      'npx gh auth status',
      'g\\h auth token',
      '"g"h auth token',
      "'gh' auth token",
      'G=gh; $G auth token',
      'git -c core.pager=gh log',
      'find . -exec gh \\;',
      'find . -name x -execdir gh {} +',
      'xargs -I{} gh issue view {}',
    ]) {
      expect(findBlockedCommand(line, BLOCKED), line).toBe('gh');
    }
  });

  it('skipsAWrappersOptionArgument_ratherThanTakingItForTheProgram', () => {
    for (const line of [
      'sudo -u root gh auth token',
      'sudo --user root gh auth token',
      'sudo -Eu root gh auth token',
      'sudo -g staff -u root gh auth token',
      'doas -u root gh auth token',
      'env -u HOME gh auth token',
      'env -C /tmp gh auth token',
      'env --chdir /tmp gh auth token',
      'exec -a name gh auth token',
      'nice -n 5 gh auth token',
      'time -o out.txt gh auth token',
      'xargs -I {} gh issue view {}',
      'xargs -n 1 gh issue view',
      'bash -o errexit -c gh',
      'npx -p some-package gh auth token',
      'npx --package some-package gh auth token',
      'yarn --cwd sub gh auth token',
      'timeout 5 gh auth token',
      'timeout -k 1 5 gh auth token',
    ]) {
      expect(findBlockedCommand(line, BLOCKED), line).toBe('gh');
    }
  });

  it('stillFindsTheProgram_whenTheOptionCarriesItsValue', () => {
    // An attached value leaves the next word as the program, so that word must not be skipped.
    for (const line of ['sudo -uroot gh auth', 'nice -n5 gh auth', 'xargs -n1 gh issue view']) {
      expect(findBlockedCommand(line, BLOCKED), line).toBe('gh');
    }
  });

  it('recognisesAWrapperGivenByPath', () => {
    for (const line of [
      '/usr/bin/env gh auth token',
      '/usr/bin/sudo -u root gh auth token',
      '/bin/sh -c "gh auth token"',
    ]) {
      expect(findBlockedCommand(line, BLOCKED), line).toBe('gh');
    }
  });

  it('readsPastShellKeywordsAndRedirections', () => {
    for (const line of [
      'if true; then gh auth token; fi',
      'if gh auth status; then echo ok; fi',
      'for i in 1 2; do gh issue view $i; done',
      'while true; do gh api user; done',
      'true || { gh auth token; }',
      '! gh auth status',
      '>/dev/null gh auth token',
      '> /dev/null gh auth token',
      '2>/dev/null gh auth token',
    ]) {
      expect(findBlockedCommand(line, BLOCKED), line).toBe('gh');
    }
  });

  it('doesNotTakeAWrappersOptionArgumentForTheProgram', () => {
    // The other half of the rule: `gh` as a user name is not `gh` being run.
    expect(findBlockedCommand('sudo -u gh ls', BLOCKED)).toBeNull();
  });

  it('treatsACarriageReturnAsTheEndOfACommand', () => {
    // A terminal submits on \r as readily as on \n.
    expect(findBlockedCommand('npm test\rgh pr merge 1', BLOCKED)).toBe('gh');
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
    // Says where the block is lifted, so the agent does not send the user looking elsewhere.
    expect(blockedCommandMessage('gh')).toContain('Security & Permissions');
  });
});
