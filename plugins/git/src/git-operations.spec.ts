import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitVersionControl } from './git';

/**
 * The per-test timeout: these tests run real git, which is quick but not instant.
 */
const SLOW: { timeout: number } = { timeout: 30_000 };

/**
 * An answer from the endpoint, however it went.
 */
interface Answer {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly code?: string;
}

/**
 * Runs git in a directory, throwing on failure.
 * @param cwd The working directory.
 * @param args The git arguments.
 * @returns Resolves with the standard output.
 */
function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise<string>(
    (resolve: (out: string) => void, reject: (error: Error) => void): void => {
      execFile(
        'git',
        args,
        { cwd, timeout: 20_000 },
        (error: Error | null, stdout: string): void => {
          if (error !== null) {
            reject(error);
            return;
          }
          resolve(stdout);
        },
      );
    },
  );
}

describe('GitVersionControl operations', () => {
  let base: string = '';
  let repo: string = '';
  let vcs: GitVersionControl;
  let saved: NodeJS.ProcessEnv = {};

  /**
   * Asks the endpoint something about the fixture repository.
   * @param op The operation.
   * @param params The parameters.
   * @param root The repository, when not the fixture's.
   * @returns Returns the answer.
   */
  async function ask(
    op: string,
    params: Record<string, unknown> = {},
    root: string | null = repo,
  ): Promise<Answer> {
    const request: (op: string, root: string | undefined, params: unknown) => Promise<Answer> =
      vcs.request.bind(vcs) as unknown as (
        op: string,
        root: string | undefined,
        params: unknown,
      ) => Promise<Answer>;
    return request(op, root ?? undefined, params);
  }

  /**
   * Writes a file in the fixture repository.
   * @param name The relative path.
   * @param content The content.
   */
  async function write(name: string, content: string = 'x\n'): Promise<void> {
    await fs.mkdir(path.dirname(path.join(repo, name)), { recursive: true });
    await fs.writeFile(path.join(repo, name), content);
  }

  /**
   * Reads a file in the fixture repository.
   * @param name The relative path.
   * @returns Returns the content, or null when it is not there.
   */
  async function read(name: string): Promise<string | null> {
    return fs.readFile(path.join(repo, name), 'utf8').catch((): null => null);
  }

  /**
   * Commits everything.
   * @param message The message.
   */
  async function commit(message: string = 'change'): Promise<void> {
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-m', message);
  }

  /**
   * Makes `feature` and `main` disagree about a file.
   */
  async function diverge(): Promise<void> {
    await git(repo, 'checkout', '-b', 'feature');
    await write('README.md', 'theirs\n');
    await commit('feature edit');
    await git(repo, 'checkout', 'main');
    await write('README.md', 'ours\n');
    await commit('main edit');
  }

  /**
   * Makes a bare remote the fixture has pushed its main to.
   * @returns Returns the remote's path.
   */
  async function remote(): Promise<string> {
    const bare: string = path.join(base, 'remote.git');
    await git(base, 'init', '--bare', '-b', 'main', bare);
    await git(repo, 'remote', 'add', 'origin', bare);
    await git(repo, 'push', '--set-upstream', 'origin', 'main');
    return bare;
  }

  beforeEach(async () => {
    saved = { ...process.env };
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'git-ops-spec-')));
    // Everything that reads or writes global configuration lands here, never in the user's own.
    process.env['GIT_CONFIG_GLOBAL'] = path.join(base, 'gitconfig');
    process.env['GIT_CONFIG_SYSTEM'] = '/dev/null';
    process.env['GIT_AUTHOR_NAME'] = 'Spec';
    process.env['GIT_AUTHOR_EMAIL'] = 'spec@studio';
    process.env['GIT_COMMITTER_NAME'] = 'Spec';
    process.env['GIT_COMMITTER_EMAIL'] = 'spec@studio';
    repo = path.join(base, 'repo');
    await fs.mkdir(repo);
    await git(repo, 'init', '-b', 'main');
    await write('README.md', 'one\n');
    await commit('initial');
    vcs = new GitVersionControl();
    await vcs.start(null);
  });

  afterEach(async () => {
    vcs.dispose();
    process.env = saved;
    await fs.rm(base, { recursive: true, force: true });
  });

  describe('discard', () => {
    it('restoresATrackedFile_andDeletesAnUntrackedOne', SLOW, async () => {
      await write('README.md', 'edited\n');
      await write('new.txt');

      expect((await ask('discard', { paths: ['README.md', 'new.txt'] })).ok).toBe(true);

      expect(await read('README.md')).toBe('one\n');
      expect(await read('new.txt')).toBeNull();
    });

    it('restoresAFileWithANonAsciiName', SLOW, async () => {
      await write('café.txt', 'one\n');
      await commit();
      await write('café.txt', 'edited\n');

      await ask('discard', { paths: ['café.txt'] });

      expect(await read('café.txt')).toBe('one\n');
    });

    it('deletesAnUntrackedFileWithANonAsciiName', SLOW, async () => {
      await write('naïve.txt');

      await ask('discard', { paths: ['naïve.txt'] });

      expect(await read('naïve.txt')).toBeNull();
    });

    it('deletesAnUntrackedFileWithAQuoteInItsName', SLOW, async () => {
      await write('a"b.txt');

      await ask('discard', { paths: ['a"b.txt'] });

      expect(await read('a"b.txt')).toBeNull();
    });

    it('onAFolder_restoresWhatIsTracked_andKeepsIgnoredFiles', SLOW, async () => {
      await write('.gitignore', 'src/*.env\n');
      await write('src/kept.ts', 'one\n');
      await commit();
      await write('src/kept.ts', 'edited\n');
      await write('src/.env.local.env', 'secret\n');
      await write('src/untracked.ts');

      await ask('discard', { paths: ['src'] });

      expect(await read('src/kept.ts')).toBe('one\n');
      expect(await read('src/.env.local.env')).toBe('secret\n');
      expect(await read('src/untracked.ts')).toBeNull();
    });

    it('leavesAnIgnoredFileItIsNamedDirectly', SLOW, async () => {
      await write('.gitignore', '*.log\n');
      await commit();
      await write('debug.log');

      await ask('discard', { paths: ['debug.log'] });

      expect(await read('debug.log')).toBe('x\n');
    });

    it.each<[string, unknown]>([
      ['noPaths', []],
      ['aNonList', 'README.md'],
      ['anEscape', ['../outside']],
    ])('refuses_%s', SLOW, async (_name: string, paths: unknown) => {
      expect((await ask('discard', { paths })).ok).toBe(false);
    });
  });

  describe('conflicted operations', () => {
    it('aConflictedMerge_isCoded_andCanBeAborted', SLOW, async () => {
      await diverge();

      const merged: Answer = await ask('merge', { branch: 'feature' });

      expect(merged).toMatchObject({ ok: false, code: 'conflicted' });
      expect(await ask('operationState')).toMatchObject({ result: { kind: 'merge' } });
      expect((await ask('operationAbort')).ok).toBe(true);
      expect(await read('README.md')).toBe('ours\n');
      expect(await ask('operationState')).toMatchObject({ result: { kind: null } });
    });

    it('aResolvedMerge_continuesWithoutAnEditor', SLOW, async () => {
      await diverge();
      await ask('merge', { branch: 'feature' });
      await write('README.md', 'both\n');
      await git(repo, 'add', '.');

      expect((await ask('operationContinue')).ok).toBe(true);

      expect((await git(repo, 'log', '-1', '--format=%P')).trim().split(' ')).toHaveLength(2);
    });

    it('aMergeCannotSkip', SLOW, async () => {
      await diverge();
      await ask('merge', { branch: 'feature' });

      expect(await ask('operationSkip')).toMatchObject({ ok: false, code: 'skip-unsupported' });
    });

    it('aConflictedRebase_namesItsTarget_andCanBeSkipped', SLOW, async () => {
      await diverge();
      await git(repo, 'checkout', 'feature');

      expect(await ask('rebase', { onto: 'main' })).toMatchObject({
        ok: false,
        code: 'conflicted',
      });
      expect(await ask('operationState')).toMatchObject({
        result: { kind: 'rebase', target: 'main' },
      });

      expect((await ask('operationSkip')).ok).toBe(true);
      expect(await read('README.md')).toBe('ours\n');
    });

    it('aRebaseCanBeAborted_backToWhereItStarted', SLOW, async () => {
      await diverge();
      await git(repo, 'checkout', 'feature');
      await ask('rebase', { onto: 'main' });

      expect((await ask('operationAbort')).ok).toBe(true);

      expect(await read('README.md')).toBe('theirs\n');
    });

    it('aResolvedRebase_continues', SLOW, async () => {
      await diverge();
      await git(repo, 'checkout', 'feature');
      await ask('rebase', { onto: 'main' });
      await write('README.md', 'both\n');
      await git(repo, 'add', '.');

      expect((await ask('operationContinue')).ok).toBe(true);
    });

    it('aCherryPickCanBeAbortedAndSkipped', SLOW, async () => {
      await diverge();
      const picked: string = (await git(repo, 'rev-parse', 'feature')).trim();
      await git(repo, 'cherry-pick', picked).catch((): string => '');

      expect(await ask('operationState')).toMatchObject({ result: { kind: 'cherry-pick' } });
      expect((await ask('operationSkip')).ok).toBe(true);

      await git(repo, 'cherry-pick', picked).catch((): string => '');
      expect((await ask('operationAbort')).ok).toBe(true);
    });

    it('aRevertIsAbortedButCannotSkip', SLOW, async () => {
      await write('README.md', 'two\n');
      await commit();
      await write('README.md', 'three\n');
      await commit();
      await git(repo, 'revert', '--no-edit', 'HEAD~1').catch((): string => '');

      expect(await ask('operationSkip')).toMatchObject({ code: 'skip-unsupported' });
      expect((await ask('operationAbort')).ok).toBe(true);
    });

    it('aSquashMerge_isFinishedByCommitting_orAborted', SLOW, async () => {
      await diverge();
      await git(repo, 'reset', '--hard', 'HEAD~1');

      expect((await ask('merge', { branch: 'feature', mode: 'squash' })).ok).toBe(true);
      expect(await ask('operationContinue')).toMatchObject({ code: 'squash-commit-required' });

      expect((await ask('operationAbort')).ok).toBe(true);
      expect(await read('README.md')).toBe('one\n');
    });

    it.each<[string]>([['operationContinue'], ['operationSkip'], ['operationAbort']])(
      '%s_saysThereIsNothingToDo',
      SLOW,
      async (op: string) => {
        expect(await ask(op)).toMatchObject({ ok: false, code: 'no-operation' });
      },
    );

    it('aMergeWithNoFastForward_makesAMergeCommit', SLOW, async () => {
      await git(repo, 'checkout', '-b', 'feature');
      await write('feature.txt');
      await commit();
      await git(repo, 'checkout', 'main');

      expect((await ask('merge', { branch: 'feature', mode: 'no-ff' })).ok).toBe(true);

      expect((await git(repo, 'log', '-1', '--format=%P')).trim().split(' ')).toHaveLength(2);
    });
  });

  describe('branches and upstreams', () => {
    it('createsWithAndWithoutSwitching_renames_andDeletes', SLOW, async () => {
      expect((await ask('createBranch', { name: 'one', checkout: false })).ok).toBe(true);
      expect((await git(repo, 'branch', '--show-current')).trim()).toBe('main');

      expect((await ask('createBranch', { name: 'two' })).ok).toBe(true);
      expect((await git(repo, 'branch', '--show-current')).trim()).toBe('two');

      expect((await ask('renameBranch', { from: 'one', to: 'three' })).ok).toBe(true);
      expect((await ask('checkout', { branch: 'main' })).ok).toBe(true);
      expect((await ask('deleteBranch', { name: 'three' })).ok).toBe(true);
    });

    it('deletingABranchThatIsNotThere_isAPlainFailure', SLOW, async () => {
      const answer: Answer = await ask('deleteBranch', { name: 'gone' });

      expect(answer.ok).toBe(false);
      expect(answer.code).toBeUndefined();
      expect((await ask('deleteBranch', { name: 'gone', force: true })).ok).toBe(false);
    });

    it('deletingTheCheckedOutBranch_isNotCalledUnmerged', SLOW, async () => {
      const answer: Answer = await ask('deleteBranch', { name: 'main' });

      expect(answer.ok).toBe(false);
      expect(answer.code).toBeUndefined();
    });

    it.each<[string, string, Record<string, unknown>]>([
      ['checkout', 'branch', { branch: '--orphan' }],
      ['createBranch', 'name', { name: '-b' }],
      ['deleteBranch', 'name', { name: '-D' }],
      ['renameBranch', 'from', { from: '-x', to: 'y' }],
      ['renameBranch', 'to', { from: 'x', to: '-y' }],
      ['merge', 'branch', { branch: '--abort' }],
      ['rebase', 'onto', { onto: '--root' }],
      ['setUpstream', 'branch', { branch: '-x', upstream: 'y' }],
      ['setUpstream', 'upstream', { branch: 'x', upstream: '-y' }],
      ['checkoutTracking', 'localBranch', { remoteBranch: 'o/x', localBranch: '-y' }],
      ['createTag', 'name', { name: '-d', commit: 'HEAD' }],
      ['createTag', 'commit', { name: 'x', commit: '-d' }],
      ['createTag', 'message', { name: 'x', commit: 'HEAD', message: '' }],
      ['deleteTag', 'name', { name: '-l' }],
      ['deleteRemoteTag', 'name', { remote: 'origin', name: 'x:y' }],
      ['pushTag', 'remote', { remote: '--mirror', name: 'x' }],
      ['pushAllTags', 'remote', { remote: '--mirror' }],
      ['fetchRemote', 'remote', { remote: '--all' }],
      ['pruneRemote', 'remote', { remote: '-x' }],
      ['addRemote', 'name', { name: '-x', url: 'y' }],
      ['removeRemote', 'name', { name: '-x' }],
      ['commitFiles', 'hash', { hash: '--root' }],
      ['push', 'target', { target: { remote: '--mirror', branch: 'main' } }],
      ['push', 'a non-object', { target: 'origin' }],
      ['commit', 'message', { message: '   ' }],
      ['stashPop', 'index', { index: -1 }],
      ['stashApply', 'index', { index: 1.5 }],
      ['stashDrop', 'index', { index: '0' }],
    ])(
      '%s_refusesAnUnsafe_%s',
      SLOW,
      async (op: string, _what: string, params: Record<string, unknown>) => {
        expect((await ask(op, params)).ok).toBe(false);
      },
    );

    it('setsAndClearsAnUpstream', SLOW, async () => {
      await remote();
      await git(repo, 'branch', 'other');

      expect((await ask('setUpstream', { branch: 'other', upstream: 'origin/main' })).ok).toBe(
        true,
      );
      expect((await git(repo, 'rev-parse', '--abbrev-ref', 'other@{u}')).trim()).toBe(
        'origin/main',
      );

      expect((await ask('setUpstream', { branch: 'other', upstream: null })).ok).toBe(true);
      await expect(git(repo, 'rev-parse', '--abbrev-ref', 'other@{u}')).rejects.toThrow();
    });
  });

  describe('remotes', () => {
    it('pushesFetchesAndPulls', SLOW, async () => {
      const bare: string = await remote();
      await write('pushed.txt');
      await commit();

      expect((await ask('push', {})).ok).toBe(true);

      const clone: string = path.join(base, 'clone');
      await git(base, 'clone', bare, clone);
      await fs.writeFile(path.join(clone, 'theirs.txt'), 'x');
      await git(clone, 'add', '.');
      await git(clone, 'commit', '-m', 'theirs');
      await git(clone, 'push');

      expect((await ask('fetch', {})).ok).toBe(true);
      expect((await ask('fetch', { prune: false })).ok).toBe(true);
      expect((await ask('fetchRemote', { remote: 'origin' })).ok).toBe(true);
      expect((await ask('pull', {})).ok).toBe(true);
      expect(await read('theirs.txt')).toBe('x');
    });

    it('pushesToAnUpstream_withAndWithoutRecordingIt', SLOW, async () => {
      await remote();
      await git(repo, 'checkout', '-b', 'one');
      await write('one.txt');
      await commit();

      expect(
        (await ask('push', { target: { remote: 'origin', branch: 'one', setUpstream: false } })).ok,
      ).toBe(true);
      await expect(git(repo, 'rev-parse', 'one@{u}')).rejects.toThrow();

      expect((await ask('push', { target: { remote: 'origin', branch: 'one' } })).ok).toBe(true);
      expect((await git(repo, 'rev-parse', '--abbrev-ref', 'one@{u}')).trim()).toBe('origin/one');
    });

    it('checksOutAndFetchesRefs_fromARemote', SLOW, async () => {
      await remote();
      await git(repo, 'checkout', '-b', 'topic');
      await write('topic.txt');
      await commit();
      await git(repo, 'push', 'origin', 'topic');
      await git(repo, 'checkout', 'main');
      await git(repo, 'branch', '-D', 'topic');
      await git(repo, 'fetch', 'origin');

      expect(
        (await ask('checkoutTracking', { remoteBranch: 'origin/topic', localBranch: 'mine' })).ok,
      ).toBe(true);
      await git(repo, 'checkout', 'main');

      expect(
        (await ask('fetchRef', { remote: 'origin', sourceRef: 'topic', localBranch: 'copy' })).ok,
      ).toBe(true);
    });

    it('addsPrunesAndRemovesARemote', SLOW, async () => {
      const bare: string = await remote();

      expect((await ask('addRemote', { name: 'second', url: bare })).ok).toBe(true);
      expect((await ask('pruneRemote', { remote: 'second' })).ok).toBe(true);
      expect((await ask('removeRemote', { name: 'second' })).ok).toBe(true);
      expect((await ask('removeRemote', { name: 'second' })).ok).toBe(false);
    });

    it('explainsAPushThatCannotReachTheRemote', SLOW, async () => {
      await git(repo, 'remote', 'add', 'origin', path.join(base, 'not-there.git'));

      const answer: Answer = await ask('fetch', {});

      expect(answer.ok).toBe(false);
      expect(answer.error).toBeTruthy();
    });

    it('anOperationThatOverrunsItsTimeout_failsRatherThanHangs', SLOW, async () => {
      await remote();
      const slow: string = path.join(base, 'slow-git');
      await fs.writeFile(
        slow,
        '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version 2.0"; exit 0; fi\nexec sleep 30\n',
      );
      await fs.chmod(slow, 0o755);
      const stuck: GitVersionControl = new GitVersionControl();
      await stuck.start({ mode: 'custom', path: slow });

      const answer: unknown = await (
        stuck.request.bind(stuck) as unknown as (
          op: string,
          root: string,
          params: unknown,
        ) => Promise<Answer>
      )('fetch', repo, { timeoutMs: 100 });
      stuck.dispose();

      expect(answer).toMatchObject({ ok: false });
    });
  });

  describe('tags', () => {
    it('createsLightweightAndAnnotatedTags_andPushesAndDeletesThem', SLOW, async () => {
      await remote();

      expect((await ask('createTag', { name: 'v1', commit: 'HEAD' })).ok).toBe(true);
      expect((await ask('createTag', { name: 'v2', commit: 'HEAD', message: 'second' })).ok).toBe(
        true,
      );
      expect((await git(repo, 'cat-file', '-t', 'v2')).trim()).toBe('tag');

      expect((await ask('pushTag', { remote: 'origin', name: 'v1' })).ok).toBe(true);
      expect((await ask('pushAllTags', { remote: 'origin' })).ok).toBe(true);
      expect((await ask('deleteRemoteTag', { remote: 'origin', name: 'v1' })).ok).toBe(true);
      expect((await ask('deleteTag', { name: 'v1' })).ok).toBe(true);
      expect((await ask('deleteTag', { name: 'v1' })).ok).toBe(false);
    });
  });

  describe('stashes and staging', () => {
    it('stagesAndUnstages_someOrAll', SLOW, async () => {
      await write('a.txt');
      await write('b.txt');

      expect((await ask('stage', { paths: ['a.txt'] })).ok).toBe(true);
      expect((await git(repo, 'diff', '--cached', '--name-only')).trim()).toBe('a.txt');
      expect((await ask('stage', { paths: [] })).ok).toBe(true);
      expect((await git(repo, 'diff', '--cached', '--name-only')).trim().split('\n')).toEqual([
        'a.txt',
        'b.txt',
      ]);

      expect((await ask('unstage', { paths: ['a.txt'] })).ok).toBe(true);
      expect((await git(repo, 'diff', '--cached', '--name-only')).trim()).toBe('b.txt');
      expect((await ask('unstage', { paths: [] })).ok).toBe(true);
      expect((await git(repo, 'diff', '--cached', '--name-only')).trim()).toBe('');
    });

    it('appliesPopsAndDrops_byIndex', SLOW, async () => {
      await write('README.md', 'stashed\n');
      await ask('stash', {});
      expect(await read('README.md')).toBe('one\n');

      expect((await ask('stashApply', { index: 0 })).ok).toBe(true);
      expect(await read('README.md')).toBe('stashed\n');
      await git(repo, 'checkout', '--', 'README.md');

      expect((await ask('stashPop', { index: 0 })).ok).toBe(true);
      await git(repo, 'stash', 'push');
      expect((await ask('stashDrop', { index: 0 })).ok).toBe(true);
      expect((await ask('stashDrop', { index: 0 })).ok).toBe(false);
    });
  });

  describe('readFile', () => {
    it('readsADeletedFileAsNothing_ratherThanFailing', SLOW, async () => {
      expect(
        await ask('readFile', { path: 'gone.txt', version: { kind: 'working' } }),
      ).toMatchObject({ ok: true, result: { content: null } });
      expect(await ask('readFile', { path: 'gone.txt', version: { kind: 'index' } })).toMatchObject(
        {
          ok: true,
          result: { content: null },
        },
      );
    });

    it('refusesAVersionItDoesNotKnow', SLOW, async () => {
      expect((await ask('readFile', { path: 'README.md', version: { kind: 'x' } })).ok).toBe(false);
      expect((await ask('readFile', { path: 'README.md' })).ok).toBe(false);
    });
  });

  describe('roots', () => {
    it('resolveRoot_isNull_outsideARepository_andRefusesARelativePath', SLOW, async () => {
      const outside: string = path.join(base, 'plain');
      await fs.mkdir(outside);

      expect(await ask('resolveRoot', { path: outside })).toMatchObject({ result: { root: null } });
      expect((await ask('resolveRoot', { path: 'relative' })).ok).toBe(false);
    });

    it('anOperationWithNoRepository_isRefused', SLOW, async () => {
      expect(await ask('status', {}, null)).toMatchObject({ ok: false, code: 'refused' });
    });

    it('aDirectoryThatIsNotARepository_failsPlainly', SLOW, async () => {
      const outside: string = path.join(base, 'plain');
      await fs.mkdir(outside);

      expect((await ask('status', {}, outside)).ok).toBe(false);
      expect(await ask('operationState', {}, outside)).toMatchObject({ result: { kind: null } });
    });

    it('saysSo_forAnOperationItDoesNotHave', SLOW, async () => {
      expect(await ask('teleport')).toMatchObject({ ok: false, code: 'unsupported' });
    });
  });

  describe('identity', () => {
    it('roundTripsThroughGlobalConfiguration_trimmed', SLOW, async () => {
      expect(await ask('getIdentity')).toMatchObject({ result: { name: '', email: '' } });

      expect((await ask('setIdentity', { name: ' Ada ', email: ' ada@studio ' })).ok).toBe(true);

      expect(await ask('getIdentity')).toMatchObject({
        result: { name: 'Ada', email: 'ada@studio' },
      });
      expect(await fs.readFile(path.join(base, 'gitconfig'), 'utf8')).toContain('Ada');
    });

    it.each<[string, unknown]>([
      ['noName', { email: 'a@b' }],
      ['aBlankName', { name: '  ', email: 'a@b' }],
      ['aBlankEmail', { name: 'A', email: '' }],
    ])('refuses_%s', SLOW, async (_name: string, params: unknown) => {
      expect((await ask('setIdentity', params as Record<string, unknown>)).ok).toBe(false);
    });
  });

  describe('clone', () => {
    it('makesTheBranch_whenAskedTo', SLOW, async () => {
      const bare: string = await remote();
      const target: string = path.join(base, 'cloned');

      expect(
        (await ask('clone', { url: bare, directory: target, branch: 'new', createBranch: true }))
          .ok,
      ).toBe(true);

      expect((await git(target, 'branch', '--show-current')).trim()).toBe('new');
    });

    it('failsForABranchThatIsNotThere_unlessAskedToMakeIt', SLOW, async () => {
      const bare: string = await remote();

      expect(
        (await ask('clone', { url: bare, directory: path.join(base, 'c2'), branch: 'new' })).ok,
      ).toBe(false);
    });

    it.each<[string, Record<string, unknown>]>([
      ['anOptionForAUrl', { url: '--upload-pack=x', directory: '/tmp/x' }],
      ['aRelativeDirectory', { url: 'u', directory: 'x' }],
      ['anOptionForABranch', { url: 'u', directory: '/tmp/x', branch: '-b' }],
    ])('refuses_%s', SLOW, async (_name: string, params: Record<string, unknown>) => {
      expect((await ask('clone', params)).ok).toBe(false);
    });

    it('reportsASourceThatIsNotThere', SLOW, async () => {
      expect(
        (await ask('clone', { url: path.join(base, 'nope'), directory: path.join(base, 'c3') })).ok,
      ).toBe(false);
    });
  });

  it('commitFiles_listsWhatACommitChanged', SLOW, async () => {
    await write('README.md', 'two\n');
    await write('added.txt');
    await commit();

    const answer: Answer = await ask('commitFiles', { hash: 'HEAD' });

    expect(answer.ok).toBe(true);
    expect(JSON.stringify(answer.result)).toContain('added.txt');
  });

  it('status_copesWithAnEmptyRepository', SLOW, async () => {
    const empty: string = path.join(base, 'empty');
    await git(base, 'init', '-b', 'main', empty);

    expect((await ask('status', {}, empty)).ok).toBe(true);
    expect((await ask('log', {}, empty)).ok).toBe(false);
  });
});
