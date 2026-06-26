import { GitCommit, GitFileChange } from '../repository/repository-data';
import {
  ParsedRefs,
  ParsedStatus,
  parseCommitFiles,
  parseLog,
  parseRefs,
  parseStashes,
  parseStatus,
} from './git-output';

const US: string = '\x1f';
const RS: string = '\x1e';
const NUL: string = '\0';

describe('git-output', () => {
  describe('parseStatus', () => {
    it('parseStatus_withBranchHeaderAndChanges_splitsStagedAndUnstaged', () => {
      const output: string = [
        '# branch.oid abcdef',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -1',
        '1 M. N... 100644 100644 100644 1111111 2222222 src/staged.ts',
        '1 .M N... 100644 100644 100644 1111111 2222222 src/unstaged.ts',
        '? src/untracked.ts',
      ].join(NUL);

      const status: ParsedStatus = parseStatus(output);

      expect(status.branch).toBe('main');
      expect(status.upstream).toBe('origin/main');
      expect(status.ahead).toBe(2);
      expect(status.behind).toBe(1);
      expect(status.staged.map((file: GitFileChange): string => file.path)).toEqual([
        'src/staged.ts',
      ]);
      expect(status.staged[0].status).toBe('modified');
      expect(status.staged[0].target).toEqual({ kind: 'working', staged: true });
      expect(status.unstaged.map((file: GitFileChange): string => file.path)).toEqual([
        'src/unstaged.ts',
        'src/untracked.ts',
      ]);
      expect(status.unstaged[1].status).toBe('added');
    });

    it('parseStatus_withRenameEntry_consumesTheSecondPathToken', () => {
      const output: string = ['1 .M N... 100644 100644 100644 a b after.ts'].join(NUL);
      // Build a rename entry whose pre-rename path is a separate NUL token.
      const renameOutput: string = `2 R. N... 100644 100644 100644 a b R100 renamed.ts${NUL}original.ts${NUL}? trailing.ts`;

      expect(parseStatus(output).unstaged[0].path).toBe('after.ts');

      const status: ParsedStatus = parseStatus(renameOutput);
      expect(status.staged[0].status).toBe('renamed');
      expect(status.staged[0].path).toBe('renamed.ts');
      expect(status.staged[0].previousPath).toBe('original.ts');
      // The trailing untracked entry is still parsed (the rename's extra token was consumed correctly).
      expect(status.unstaged.map((file: GitFileChange): string => file.path)).toEqual([
        'trailing.ts',
      ]);
    });

    it('parseStatus_whenDetached_reportsNullBranch', () => {
      expect(parseStatus('# branch.head (detached)').branch).toBeNull();
    });
  });

  describe('parseLog', () => {
    it('parseLog_withTwoCommits_parsesParentsRefsAndMetadata', () => {
      const record1: string = [
        'hash1',
        'h1',
        'parentA parentB',
        'Alice',
        'alice@example.com',
        '2026-01-02T10:00:00Z',
        '2 days ago',
        'HEAD -> main, tag: v1.0, origin/main',
        'Merge feature',
        'Body line',
      ].join(US);
      const record2: string = [
        'parentA',
        'pA',
        '',
        'Bob',
        'bob@example.com',
        '2026-01-01T10:00:00Z',
        '3 days ago',
        '',
        'Initial commit',
        '',
      ].join(US);
      const output: string = `${record1}${RS}\n${record2}${RS}\n`;

      const commits: GitCommit[] = parseLog(output);

      expect(commits.length).toBe(2);
      expect(commits[0].hash).toBe('hash1');
      expect(commits[0].parents).toEqual(['parentA', 'parentB']);
      expect(commits[0].summary).toBe('Merge feature');
      expect(commits[0].body).toBe('Body line');
      expect(commits[0].refs).toEqual([
        { name: 'HEAD', kind: 'head' },
        { name: 'main', kind: 'branch' },
        { name: 'v1.0', kind: 'tag' },
        { name: 'origin/main', kind: 'remote' },
      ]);
      expect(commits[1].parents).toEqual([]);
      expect(commits[1].refs).toEqual([]);
    });
  });

  describe('parseRefs', () => {
    it('parseRefs_groupsBranchesRemotesAndTags', () => {
      const output: string = [
        ['refs/heads/main', 'AAA', '*', 'origin/main', '[ahead 2, behind 1]'].join(US),
        ['refs/heads/feature', 'BBB', ' ', '', ''].join(US),
        ['refs/remotes/origin/main', 'AAA', ' ', '', ''].join(US),
        ['refs/tags/v1.0', 'CCC', ' ', '', ''].join(US),
      ].join('\n');

      const refs: ParsedRefs = parseRefs(output);

      expect(refs.branches.length).toBe(2);
      expect(refs.branches[0]).toEqual({
        name: 'main',
        current: true,
        upstream: 'origin/main',
        ahead: 2,
        behind: 1,
        tip: 'AAA',
      });
      expect(refs.branches[1].current).toBe(false);
      expect(refs.branches[1].upstream).toBeUndefined();
      expect(refs.remotes).toEqual([{ name: 'origin', url: '', branches: ['origin/main'] }]);
      expect(refs.tags).toEqual([{ name: 'v1.0', commit: 'CCC' }]);
    });
  });

  describe('parseStashes', () => {
    it('parseStashes_parsesIndexMessageAndBranch', () => {
      const output: string = [
        ['stash@{0}', 'HHH', 'WIP on main: 1234567 tweak colours'].join(US),
        ['stash@{1}', 'III', 'On feature/x: experiment'].join(US),
      ].join('\n');

      const stashes: ReturnType<typeof parseStashes> = parseStashes(output);

      expect(stashes[0].index).toBe(0);
      expect(stashes[0].message).toBe('WIP on main: 1234567 tweak colours');
      expect(stashes[0].branch).toBe('main');
      expect(stashes[1].index).toBe(1);
      expect(stashes[1].branch).toBe('feature/x');
    });
  });

  describe('parseCommitFiles', () => {
    it('parseCommitFiles_handlesAddModifyAndRename', () => {
      const output: string = ['M', 'src/a.ts', 'A', 'src/b.ts', 'R100', 'old.ts', 'new.ts'].join(
        NUL,
      );

      const files: GitFileChange[] = parseCommitFiles(output, 'commit1', 'parent1');

      expect(files.map((file: GitFileChange): string => file.path)).toEqual([
        'src/a.ts',
        'src/b.ts',
        'new.ts',
      ]);
      expect(files[0].status).toBe('modified');
      expect(files[1].status).toBe('added');
      expect(files[2].status).toBe('renamed');
      expect(files[2].previousPath).toBe('old.ts');
      expect(files[0].target).toEqual({ kind: 'commit', hash: 'commit1', parent: 'parent1' });
    });
  });
});
