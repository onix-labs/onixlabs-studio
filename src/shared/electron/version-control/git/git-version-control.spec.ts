import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VcsCommit,
  VcsFileVersion,
  VcsRefs,
  VcsStatus,
  VersionControlDescription,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
  VcsResult,
} from '@shared/api/version-control-protocol';
import {
  confinedPaths,
  GitVersionControl,
  isSafeOperand,
  revisionSpec,
} from './git-version-control';

/**
 * The per-test timeout: these tests run real git, which is quick but not instant.
 */
const GIT_TEST_TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * Runs git in a directory with a fixed identity, throwing on failure.
 * @param cwd The working directory.
 * @param args The git arguments.
 * @returns Resolves with the standard output.
 */
function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject): void => {
    execFile(
      'git',
      ['-c', 'user.email=spec@studio', '-c', 'user.name=Spec', ...args],
      { cwd, timeout: 20_000 },
      (error: Error | null, stdout: string): void => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

describe('revisionSpec', () => {
  it('neverDoublesTheSeparatorForTheIndexOrOurSide', () => {
    // `::path` is ambiguous to git, and that rejection once read as an absent blob — every
    // working-tree diff silently lost its indexed side.
    expect(revisionSpec({ kind: 'index' }, 'README.md')).toBe(':README.md');
    expect(revisionSpec({ kind: 'ours' }, 'README.md')).toBe(':2:README.md');
  });

  it('joinsARevisionToItsPath', () => {
    expect(revisionSpec({ kind: 'head' }, 'a/b.ts')).toBe('HEAD:a/b.ts');
    expect(revisionSpec({ kind: 'commit', hash: 'abc123' }, 'weird:name.ts')).toBe(
      'abc123:weird:name.ts',
    );
  });

  it('refusesAnOptionLikeOrColonHash_andReadsTheWorkingTreeFromDisk', () => {
    expect(revisionSpec({ kind: 'commit', hash: '--output=x' }, 'a')).toBeNull();
    expect(revisionSpec({ kind: 'commit', hash: 'a:b' }, 'a')).toBeNull();
    expect(revisionSpec({ kind: 'working' }, 'a')).toBeNull();
  });
});

describe('operand and path validation', () => {
  it('isSafeOperand_refusesOptionsAndNonStrings', () => {
    expect(isSafeOperand('main')).toBe(true);
    expect(isSafeOperand('-D')).toBe(false);
    expect(isSafeOperand('')).toBe(false);
    expect(isSafeOperand(3)).toBe(false);
  });

  it('confinedPaths_refusesEscapesAndOptions', () => {
    const root: string = path.resolve('/repo');
    expect(confinedPaths(root, ['a.ts', 'src/b.ts'])).toEqual(['a.ts', 'src/b.ts']);
    expect(confinedPaths(root, ['../etc/passwd'])).toBeNull();
    expect(confinedPaths(root, ['--force'])).toBeNull();
    expect(confinedPaths(root, 'a.ts')).toBeNull();
  });
});

/**
 * The identity the endpoint's own commits and stashes use: a CI runner has no global one.
 */
const IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: 'Spec',
  GIT_AUTHOR_EMAIL: 'spec@studio',
  GIT_COMMITTER_NAME: 'Spec',
  GIT_COMMITTER_EMAIL: 'spec@studio',
};

describe('GitVersionControl', () => {
  let base: string;
  let repo: string;
  let vcs: GitVersionControl;

  /**
   * Asks the endpoint something about the fixture repository.
   * @param op The operation.
   * @param params The parameters.
   * @returns Returns the answer.
   */
  function ask<Op extends VersionControlOp>(
    op: Op,
    params: VcsParams<Op>,
  ): Promise<VersionControlResponse<Op>> {
    return vcs.request(op, repo, params);
  }

  /**
   * Asks the endpoint something and returns the result, failing the test when it failed.
   * @param op The operation.
   * @param params The parameters.
   * @returns Returns the result.
   */
  async function result<Op extends VersionControlOp>(
    op: Op,
    params: VcsParams<Op>,
  ): Promise<VcsResult<Op>> {
    const response: VersionControlResponse<Op> = await ask(op, params);
    if (!response.ok) {
      throw new Error(`${op}: ${response.error}`);
    }
    return response.result;
  }

  beforeEach(async () => {
    Object.assign(process.env, IDENTITY);
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'git-vcs-spec-')));
    repo = path.join(base, 'repo');
    await fs.mkdir(repo);
    await git(repo, 'init', '-b', 'main');
    await fs.writeFile(path.join(repo, 'README.md'), 'one\n', 'utf8');
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'initial');
    vcs = new GitVersionControl();
    const description: VersionControlDescription = await vcs.start(null);
    expect(description.toolVersion).toMatch(/^git version/);
  });

  afterEach(async () => {
    for (const key of Object.keys(IDENTITY)) {
      delete process.env[key];
    }
    vcs.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });

  it('status_andReadFile_reportEachVersionOfAChangedFile', GIT_TEST_TIMEOUT, async () => {
    await fs.writeFile(path.join(repo, 'README.md'), 'two\n', 'utf8');
    await git(repo, 'add', 'README.md');
    await fs.writeFile(path.join(repo, 'README.md'), 'three\n', 'utf8');
    await fs.writeFile(path.join(repo, 'new.txt'), 'new\n', 'utf8');

    const status: VcsStatus = await result('status', {});
    expect(status.branch).toBe('main');
    expect(status.staged.map((change) => change.path)).toEqual(['README.md']);
    expect(status.unstaged).toEqual([
      { path: 'README.md', status: 'modified', additions: 0, deletions: 0 },
      { path: 'new.txt', status: 'added', additions: 0, deletions: 0, untracked: true },
    ]);

    const read: (version: VcsFileVersion) => Promise<string | null> = async (
      version: VcsFileVersion,
    ): Promise<string | null> => (await result('readFile', { path: 'README.md', version })).content;
    expect(await read({ kind: 'head' })).toBe('one\n');
    expect(await read({ kind: 'index' })).toBe('two\n');
    expect(await read({ kind: 'working' })).toBe('three\n');
    expect(
      (await result('readFile', { path: 'new.txt', version: { kind: 'head' } })).content,
    ).toBeNull();
  });

  it('readFile_refusesAPathOutsideTheRepository', GIT_TEST_TIMEOUT, async () => {
    expect(
      await ask('readFile', { path: '../outside', version: { kind: 'working' } }),
    ).toMatchObject({ ok: false });
  });

  it('commit_log_andCommitFiles_roundTrip', GIT_TEST_TIMEOUT, async () => {
    await fs.writeFile(path.join(repo, 'b.ts'), 'b\n', 'utf8');
    await result('stage', { paths: [] });
    expect(await ask('commit', { message: 'add b' })).toMatchObject({ ok: true });

    const log: readonly VcsCommit[] = await result('log', { limit: 10 });
    expect(log.map((commit) => commit.summary)).toEqual(['add b', 'initial']);
    expect(log[0].refs).toContainEqual({ name: 'main', kind: 'branch' });
    expect(log[0].parents).toEqual([log[1].hash]);

    expect(await result('commitFiles', { hash: log[0].hash })).toEqual([
      { path: 'b.ts', status: 'added', additions: 0, deletions: 0 },
    ]);
  });

  it(
    'merge_whenItStopsOnConflicts_isCodedConflicted_andAbortClearsIt',
    GIT_TEST_TIMEOUT,
    async () => {
      await git(repo, 'checkout', '-b', 'topic');
      await fs.writeFile(path.join(repo, 'README.md'), 'topic\n', 'utf8');
      await git(repo, 'commit', '-am', 'topic');
      await git(repo, 'checkout', 'main');
      await fs.writeFile(path.join(repo, 'README.md'), 'main\n', 'utf8');
      await git(repo, 'commit', '-am', 'main');

      expect(await ask('merge', { branch: 'topic', mode: 'default' })).toMatchObject({
        ok: false,
        code: 'conflicted',
      });
      expect(await result('operationState', {})).toMatchObject({ kind: 'merge', target: 'topic' });
      expect((await result('status', {})).conflicted.map((change) => change.path)).toEqual([
        'README.md',
      ]);
      expect(
        (await result('readFile', { path: 'README.md', version: { kind: 'ours' } })).content,
      ).toBe('main\n');

      expect(await ask('operationAbort', {})).toMatchObject({ ok: true });
      expect(await result('operationState', {})).toEqual({ kind: null });
      expect(await ask('operationContinue', {})).toMatchObject({ ok: false, code: 'no-operation' });
    },
  );

  it('deleteBranch_whenUnmerged_isCodedBranchNotMerged', GIT_TEST_TIMEOUT, async () => {
    await git(repo, 'checkout', '-b', 'unmerged');
    await fs.writeFile(path.join(repo, 'x.ts'), 'x\n', 'utf8');
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'x');
    await git(repo, 'checkout', 'main');

    expect(await ask('deleteBranch', { name: 'unmerged', force: false })).toMatchObject({
      ok: false,
      code: 'branch-not-merged',
    });
    expect(await ask('deleteBranch', { name: 'unmerged', force: true })).toMatchObject({
      ok: true,
    });
    expect(await ask('deleteBranch', { name: '-D', force: true })).toMatchObject({ ok: false });
  });

  it('stashes_andRefs_areTyped', GIT_TEST_TIMEOUT, async () => {
    await git(repo, 'tag', 'v1');
    await fs.writeFile(path.join(repo, 'README.md'), 'stashed\n', 'utf8');
    expect(await ask('stash', {})).toMatchObject({ ok: true });

    expect(await result('stashes', {})).toEqual([
      expect.objectContaining({ index: 0, branch: 'main', files: [] }),
    ]);
    const refs: VcsRefs = await result('refs', {});
    expect(refs.branches).toEqual([expect.objectContaining({ name: 'main', current: true })]);
    expect(refs.tags.map((tag) => tag.name)).toEqual(['v1']);
    expect(refs.remotes).toEqual([]);
  });

  it('clone_makesACheckoutOnANewBranch_andResolveRootFindsIt', GIT_TEST_TIMEOUT, async () => {
    const target: string = path.join(base, 'checkout');

    expect(
      await vcs.request('clone', undefined, {
        url: repo,
        directory: target,
        branch: 'feature/new',
        createBranch: true,
      }),
    ).toMatchObject({ ok: true });

    expect(
      await vcs.request('resolveRoot', undefined, { path: path.join(target, 'nested', '..') }),
    ).toMatchObject({ ok: true, result: { root: target } });
    const status: VersionControlResponse<'status'> = await vcs.request('status', target, {});
    expect(status.ok && status.result.branch).toBe('feature/new');
    expect(await vcs.request('resolveRoot', undefined, { path: base })).toMatchObject({
      ok: true,
      result: { root: null },
    });
  });

  it('request_whenNotStarted_fails', async () => {
    const idle: GitVersionControl = new GitVersionControl();
    expect(await idle.request('status', repo, {})).toMatchObject({ ok: false });
  });
});
