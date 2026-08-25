import { GitCommit, GitFileChange, GitRemote } from '../repository/repository-data';
import {
  ParsedRefs,
  ParsedStatus,
  mergeRemoteUrls,
  parseCommitFiles,
  parseLog,
  parseRefs,
  parseRemoteUrls,
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
      // Only the `?` entry is flagged untracked; ordinary worktree changes are tracked.
      expect(status.unstaged[1].untracked).toBe(true);
      expect(status.unstaged[0].untracked).toBeUndefined();
      expect(status.staged[0].untracked).toBeUndefined();
    });

    it('parseStatus_withUnmergedEntries_collectsThemAsConflicted', () => {
      // An unmerged entry carries ten metadata fields before the path: the XY code, the submodule
      // field, three stage modes plus the worktree mode, and the three stage object names.
      const output: string = [
        '# branch.head main',
        '1 M. N... 100644 100644 100644 1111111 2222222 src/staged.ts',
        'u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 src/both-modified.ts',
        'u AA N... 100644 100644 100644 100644 1111111 2222222 3333333 src/both added.ts',
        '? src/untracked.ts',
      ].join(NUL);

      const status: ParsedStatus = parseStatus(output);

      expect(status.conflicted.map((file: GitFileChange): string => file.path)).toEqual([
        'src/both-modified.ts',
        // A path with a space survives: the metadata fields are fixed in number, so everything from
        // the eleventh onwards is the path.
        'src/both added.ts',
      ]);
      expect(status.conflicted[0].status).toBe('conflicted');
      expect(status.conflicted[0].target).toEqual({ kind: 'working', staged: false });
      // Git reports a conflicted path as an unmerged entry INSTEAD of an ordinary one, so it must not
      // also be counted among the changes waiting to be staged or committed.
      expect(status.staged.map((file: GitFileChange): string => file.path)).toEqual([
        'src/staged.ts',
      ]);
      expect(status.unstaged.map((file: GitFileChange): string => file.path)).toEqual([
        'src/untracked.ts',
      ]);
    });

    it('parseStatus_withNoUnmergedEntries_reportsNoConflicts', () => {
      const status: ParsedStatus = parseStatus(
        ['# branch.head main', '1 M. N... 100644 100644 100644 a b src/staged.ts'].join(NUL),
      );

      expect(status.conflicted).toEqual([]);
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
      // `for-each-ref` carries no remote URL at all; mergeRemoteUrls is what fills it in. The tip is
      // kept, which is what lets a remote-branch row navigate to a commit (#437).
      expect(refs.remotes).toEqual([
        { name: 'origin', url: '', branches: [{ name: 'origin/main', commit: 'AAA' }] },
      ]);
      expect(refs.tags).toEqual([{ name: 'v1.0', commit: 'CCC' }]);
    });
  });

  describe('parseRemoteUrls', () => {
    it('readsTheFetchUrlOfEachRemote', () => {
      const output: string = [
        'origin\thttps://github.com/onix-labs/onixlabs-studio.git (fetch)',
        'origin\thttps://github.com/onix-labs/onixlabs-studio.git (push)',
        'upstream\tgit@github.com:someone/onixlabs-studio.git (fetch)',
        'upstream\tgit@github.com:someone/onixlabs-studio.git (push)',
      ].join('\n');

      expect([...parseRemoteUrls(output)]).toEqual([
        ['origin', 'https://github.com/onix-labs/onixlabs-studio.git'],
        ['upstream', 'git@github.com:someone/onixlabs-studio.git'],
      ]);
    });

    it('prefersTheFetchUrl_whenFetchAndPushDiffer', () => {
      // A fork commonly pushes somewhere other than it fetches. The fetch URL names the repository
      // the branches actually came from, which is what forge detection needs.
      const output: string = [
        'origin\thttps://github.com/upstream/repo.git (fetch)',
        'origin\tgit@github.com:me/repo.git (push)',
      ].join('\n');

      expect(parseRemoteUrls(output).get('origin')).toBe('https://github.com/upstream/repo.git');
    });

    it('stillReadsARemoteThatOnlyListsAPushUrl', () => {
      const output: string = 'origin\tgit@github.com:me/repo.git (push)';

      expect(parseRemoteUrls(output).get('origin')).toBe('git@github.com:me/repo.git');
    });

    it('ignoresBlankAndUnparseableLines', () => {
      const output: string = ['', 'nonsense', 'origin\thttps://x/y.git (fetch)', '   '].join('\n');

      expect([...parseRemoteUrls(output)]).toEqual([['origin', 'https://x/y.git']]);
    });

    it('yieldsNothingForARepositoryWithNoRemotes', () => {
      expect([...parseRemoteUrls('')]).toEqual([]);
    });
  });

  describe('mergeRemoteUrls', () => {
    it('fillsInTheUrlOfARemoteThatHasTrackingBranches', () => {
      const remotes: readonly GitRemote[] = [
        { name: 'origin', url: '', branches: [{ name: 'origin/main', commit: 'aaa' }] },
      ];

      expect(
        mergeRemoteUrls(remotes, new Map<string, string>([['origin', 'https://x/y.git']])),
      ).toEqual([
        {
          name: 'origin',
          url: 'https://x/y.git',
          branches: [{ name: 'origin/main', commit: 'aaa' }],
        },
      ]);
    });

    it('addsAConfiguredRemoteThatHasNoTrackingBranchesYet', () => {
      // A freshly-added remote has no refs/remotes entries until something is fetched. Refs alone
      // would omit it, leaving a repository with a perfectly good remote looking like it had none.
      expect(mergeRemoteUrls([], new Map<string, string>([['origin', 'https://x/y.git']]))).toEqual(
        [{ name: 'origin', url: 'https://x/y.git', branches: [] }],
      );
    });

    it('keepsARemoteThatHasBranchesButNoConfiguredUrl', () => {
      // A stale refs/remotes entry for a removed remote. Its branches are still checkoutable refs, so
      // dropping it would lose them from the panel.
      const remotes: readonly GitRemote[] = [
        { name: 'gone', url: '', branches: [{ name: 'gone/old', commit: 'bbb' }] },
      ];

      expect(mergeRemoteUrls(remotes, new Map<string, string>())).toEqual([
        { name: 'gone', url: '', branches: [{ name: 'gone/old', commit: 'bbb' }] },
      ]);
    });

    it('ordersConfiguredRemotesFirst_withRefOnlyOnesAppended', () => {
      const remotes: readonly GitRemote[] = [
        { name: 'gone', url: '', branches: [{ name: 'gone/old', commit: 'bbb' }] },
        { name: 'origin', url: '', branches: [{ name: 'origin/main', commit: 'aaa' }] },
      ];

      expect(
        mergeRemoteUrls(remotes, new Map<string, string>([['origin', 'https://x/y.git']])).map(
          (remote: GitRemote): string => remote.name,
        ),
      ).toEqual(['origin', 'gone']);
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
