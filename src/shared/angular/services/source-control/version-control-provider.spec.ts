import { SourceControlClient } from '@shared/api/source-control-channels';
import {
  VcsFileVersion,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
} from '@shared/api/version-control-protocol';
import { GitCommit, GitFileChange } from '../repository/repository-data';
import { FileDiff, MutationResult, ParsedStatus } from './source-control-provider';
import { VersionControlProvider } from './version-control-provider';

/**
 * A recorded request.
 */
interface Recorded {
  readonly op: VersionControlOp;
  readonly params: unknown;
}

/**
 * Builds a client that answers each operation from a table, records what it was asked, and fails any
 * operation the table does not answer.
 * @param answers The result per operation, or a function of the parameters.
 * @param recorded Collects the requests.
 * @returns Returns the client.
 */
function client(
  answers: Partial<Record<VersionControlOp, unknown>>,
  recorded: Recorded[] = [],
): SourceControlClient {
  return {
    resolveRepository: (): Promise<null> => Promise.resolve(null),
    closeRepository: (): Promise<void> => Promise.resolve(),
    describe: (): Promise<null> => Promise.resolve(null),
    detect: (): Promise<null> => Promise.resolve(null),
    listPlugins: (): Promise<readonly []> => Promise.resolve([]),
    setExecutable: (): Promise<null> => Promise.resolve(null),
    request: <Op extends VersionControlOp>(
      _root: string,
      op: Op,
      params: VcsParams<Op>,
    ): Promise<VersionControlResponse<Op>> => {
      recorded.push({ op, params });
      const answer: unknown = answers[op];
      if (answer === undefined) {
        return Promise.resolve({ id: 0, ok: false, error: `${op} failed`, code: 'conflicted' });
      }
      const result: unknown =
        typeof answer === 'function' ? (answer as (input: unknown) => unknown)(params) : answer;
      return Promise.resolve({ id: 0, ok: true, result } as VersionControlResponse<Op>);
    },
  };
}

/**
 * Builds a working-tree change as the provider produces it.
 * @param overrides Fields to replace.
 * @returns Returns the change.
 */
function workingChange(overrides: Partial<GitFileChange>): GitFileChange {
  return {
    path: 'a.ts',
    status: 'modified',
    additions: 0,
    deletions: 0,
    language: '',
    original: '',
    modified: '',
    target: { kind: 'working', staged: false },
    ...overrides,
  };
}

/**
 * Answers `readFile` with a label naming the version asked for, so a test reads which side came from
 * where.
 * @param params The readFile parameters.
 * @returns Returns the content.
 */
function labelled(params: { readonly path: string; readonly version: VcsFileVersion }): {
  content: string;
} {
  const version: VcsFileVersion = params.version;
  return {
    content: `${version.kind}${version.kind === 'commit' ? `:${version.hash}` : ''}:${params.path}`,
  };
}

describe('VersionControlProvider', () => {
  it('getStatus_attachesWorkingTargets', async () => {
    const provider: VersionControlProvider = new VersionControlProvider(
      '/repo',
      client({
        status: {
          branch: 'main',
          upstream: null,
          ahead: 0,
          behind: 0,
          staged: [{ path: 'a.ts', status: 'modified', additions: 0, deletions: 0 }],
          unstaged: [
            { path: 'b.ts', status: 'added', additions: 0, deletions: 0, untracked: true },
          ],
          conflicted: [{ path: 'c.ts', status: 'conflicted', additions: 0, deletions: 0 }],
        },
      }),
    );

    const status: ParsedStatus = await provider.getStatus();

    expect(status.branch).toBe('main');
    expect(status.staged[0].target).toEqual({ kind: 'working', staged: true });
    expect(status.unstaged[0]).toMatchObject({ untracked: true, language: '', original: '' });
    expect(status.unstaged[0].target).toEqual({ kind: 'working', staged: false });
    expect(status.conflicted[0].target).toEqual({ kind: 'working', staged: false });
  });

  it('reads_whenTheyFail_areEmptyRatherThanErrors', async () => {
    const provider: VersionControlProvider = new VersionControlProvider('/repo', client({}));

    expect((await provider.getStatus()).branch).toBeNull();
    expect(await provider.getCommits()).toEqual([]);
    expect(await provider.getRefs()).toEqual({ branches: [], remotes: [], tags: [] });
    expect(await provider.getOperationState()).toEqual({ kind: null });
  });

  it('getCommits_phrasesTheDateAndStartsWithNoFiles', async () => {
    const provider: VersionControlProvider = new VersionControlProvider(
      '/repo',
      client({
        log: [
          {
            hash: 'h1',
            shortHash: 'h1',
            summary: 's',
            body: '',
            author: 'a',
            email: 'e',
            isoDate: new Date(Date.now() - 3 * 86_400_000).toISOString(),
            parents: [],
            refs: [],
          },
        ],
      }),
    );

    const [commit]: GitCommit[] = await provider.getCommits();

    expect(commit.relativeDate).toBe('3 days ago');
    expect(commit.files).toEqual([]);
  });

  it('getCommitFiles_attachesTheCommitAndItsFirstParent', async () => {
    const provider: VersionControlProvider = new VersionControlProvider(
      '/repo',
      client({ commitFiles: [{ path: 'a.ts', status: 'modified', additions: 0, deletions: 0 }] }),
    );

    const files: GitFileChange[] = await provider.getCommitFiles({
      hash: 'c1',
      parents: ['p1', 'p2'],
    } as unknown as GitCommit);

    expect(files[0].target).toEqual({ kind: 'commit', hash: 'c1', parent: 'p1' });
  });

  it('getFileDiff_readsEachSideFromTheRightVersion', async () => {
    const provider: VersionControlProvider = new VersionControlProvider(
      '/repo',
      client({ readFile: labelled }),
    );

    const unstaged: FileDiff = await provider.getFileDiff(workingChange({}));
    const staged: FileDiff = await provider.getFileDiff(
      workingChange({ target: { kind: 'working', staged: true } }),
    );
    const conflicted: FileDiff = await provider.getFileDiff(
      workingChange({ status: 'conflicted' }),
    );
    const renamed: FileDiff = await provider.getFileDiff(
      workingChange({
        path: 'new.ts',
        previousPath: 'old.ts',
        status: 'renamed',
        target: { kind: 'commit', hash: 'c1', parent: 'p1' },
      }),
    );

    expect(unstaged).toEqual({ original: 'index:a.ts', modified: 'working:a.ts' });
    expect(staged).toEqual({ original: 'head:a.ts', modified: 'index:a.ts' });
    expect(conflicted).toEqual({ original: 'ours:a.ts', modified: 'working:a.ts' });
    expect(renamed).toEqual({ original: 'commit:p1:old.ts', modified: 'commit:c1:new.ts' });
  });

  it('getFileDiff_givesAnAddedOrRootFileAnEmptyOriginal', async () => {
    const recorded: Recorded[] = [];
    const provider: VersionControlProvider = new VersionControlProvider(
      '/repo',
      client({ readFile: labelled }, recorded),
    );

    const root: FileDiff = await provider.getFileDiff(
      workingChange({ target: { kind: 'commit', hash: 'c1', parent: null } }),
    );
    const deleted: FileDiff = await provider.getFileDiff(
      workingChange({ status: 'deleted', target: { kind: 'commit', hash: 'c1', parent: 'p1' } }),
    );

    expect(root).toEqual({ original: '', modified: 'commit:c1:a.ts' });
    expect(deleted).toEqual({ original: 'commit:p1:a.ts', modified: '' });
  });

  it('mutations_carryTheParametersAndPassTheCodeThrough', async () => {
    const recorded: Recorded[] = [];
    const provider: VersionControlProvider = new VersionControlProvider(
      '/repo',
      client({ stage: {}, push: {} }, recorded),
    );

    const staged: MutationResult = await provider.stage(['a.ts']);
    await provider.push({ remote: 'origin', branch: 'main', setUpstream: true });
    await provider.push();
    const merged: MutationResult = await provider.merge('topic', 'no-ff');

    expect(staged).toEqual({ success: true });
    expect(merged).toEqual({ success: false, error: 'merge failed', code: 'conflicted' });
    expect(recorded).toEqual([
      { op: 'stage', params: { paths: ['a.ts'] } },
      { op: 'push', params: { target: { remote: 'origin', branch: 'main', setUpstream: true } } },
      { op: 'push', params: { target: null } },
      { op: 'merge', params: { branch: 'topic', mode: 'no-ff' } },
    ]);
  });

  it('mutations_withoutAClient_failPlainly', async () => {
    const provider: VersionControlProvider = new VersionControlProvider('/repo', undefined);

    expect(await provider.commit('m')).toEqual({
      success: false,
      error: 'Source control is unavailable',
    });
  });
});
