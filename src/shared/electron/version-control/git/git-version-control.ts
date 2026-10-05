import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import {
  VERSION_CONTROL_CAPABILITIES,
  VERSION_CONTROL_PROTOCOL_VERSION,
  VcsErrorCode,
  VcsFileVersion,
  VcsIdentity,
  VcsOperationState,
  VcsRefs,
  VersionControlDescription,
  VersionControlExecutableChoice,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
} from '@shared/api/version-control-protocol';
import { logger } from '../../logger';
import { VersionControlEndpoint } from '../version-control-endpoint';
import { classifyOperation, firstFile, probeOperation } from './git-operation-state';
import {
  LOG_FORMAT,
  mergeRemoteUrls,
  parseCommitFiles,
  parseLog,
  parseRefs,
  parseRemoteUrls,
  parseStashes,
  parseStatus,
  REFS_FORMAT,
  STASH_FORMAT,
} from './git-output';

/**
 * Holds the maximum time, in milliseconds, a single local git invocation may run before being killed.
 */
const GIT_TIMEOUT_MS: number = 20_000;

/**
 * Holds the maximum time, in milliseconds, a network git invocation (fetch, pull, push) may run.
 */
const GIT_NETWORK_TIMEOUT_MS: number = 120_000;

/**
 * Holds the maximum time, in milliseconds, a clone may run: a whole repository over the network.
 */
const GIT_CLONE_TIMEOUT_MS: number = 10 * 60_000;

/**
 * Holds the maximum time, in milliseconds, a merge or rebase may run. Local work, but not necessarily
 * quick: being killed part-way through would leave exactly the half-finished state these operations
 * are hard enough to reason about without.
 */
const GIT_INTEGRATION_TIMEOUT_MS: number = 120_000;

/**
 * Holds the maximum size, in bytes, of a git invocation's captured output (large logs and blobs).
 */
const GIT_MAX_BUFFER: number = 64 * 1024 * 1024;

/**
 * Holds the largest commit count a log will read, clamping an untrusted limit.
 */
const MAX_LOG_LIMIT: number = 2000;

/**
 * Holds the environment overlay applied to network git invocations so they never block on an
 * interactive prompt: with no usable credentials git fails fast rather than hanging until the
 * timeout. Credentials still come from the user's credential helper and ssh-agent.
 */
const GIT_NETWORK_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10',
};

/**
 * Holds the environment overlay applied to merges, rebases, and the commands that finish them. Every
 * one of these opens an editor by default; under `execFile` there is no terminal for one, so git would
 * block until killed mid-operation. Pointing the editor hooks at `true` makes git accept the message it
 * prepared and carry on.
 */
const GIT_NO_EDITOR_ENV: NodeJS.ProcessEnv = {
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
};

/**
 * What a continue, skip, or abort says when the working tree is in the middle of nothing at all.
 */
const NO_OPERATION_ERROR: string = 'There is no operation in progress.';

/**
 * The outcome of one git invocation.
 */
interface GitRun {
  /**
   * Gets whether git exited successfully.
   */
  readonly success: boolean;

  /**
   * Gets the standard output.
   */
  readonly stdout: string;

  /**
   * Gets the standard error.
   */
  readonly stderr: string;

  /**
   * Gets the failure message, when git failed.
   */
  readonly error?: string;
}

/**
 * The outcome of an operation before it is wrapped as a response.
 */
type Outcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string; readonly code?: VcsErrorCode };

/**
 * The result of an operation that only succeeds or fails.
 */
const DONE: Readonly<Record<string, never>> = {};

/**
 * Validates an operand passed to git so a caller cannot smuggle options: a non-empty string that does
 * not begin with a dash (which git would parse as an option).
 * @param value The value to validate.
 * @returns Returns true when the value is safe to pass as a git operand.
 */
export function isSafeOperand(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-');
}

/**
 * Builds the `git show` argument naming one file at one version, or null for the working tree (read
 * from disk) or an unusable version.
 *
 * Git spells a blob as `<revision>:<path>`, and the index is the revision with no name at all, so its
 * blob is `:path` — and our side of a conflict is index stage 2, `:2:path`. Joining a separator onto
 * either naively produces `::path`, which git rejects as ambiguous; that rejection was once
 * indistinguishable from an absent blob, and every working-tree diff silently lost its indexed side.
 * @param version The version to read.
 * @param filePath The repository-relative file path.
 * @returns Returns the argument, or null when the version is not read through `git show`.
 */
export function revisionSpec(version: VcsFileVersion, filePath: string): string | null {
  switch (version.kind) {
    case 'index':
      return `:${filePath}`;
    case 'ours':
      return `:2:${filePath}`;
    case 'head':
      return `HEAD:${filePath}`;
    case 'commit':
      return isSafeOperand(version.hash) && !version.hash.includes(':')
        ? `${version.hash}:${filePath}`
        : null;
    default:
      return null;
  }
}

/**
 * Validates repository-relative paths, rejecting non-strings, option-like values, and any path that
 * escapes the repository root.
 * @param root The resolved repository root.
 * @param paths The candidate paths.
 * @returns Returns the validated paths, or null when any path is invalid.
 */
export function confinedPaths(root: string, paths: unknown): string[] | null {
  if (!Array.isArray(paths)) {
    return null;
  }
  const confined: string[] = [];
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.startsWith('-')) {
      return null;
    }
    const absolute: string = path.resolve(root, candidate);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      return null;
    }
    confined.push(candidate);
  }
  return confined;
}

/**
 * Rewrites a failed network operation's message into an actionable one when it is an authentication
 * failure. Network git runs are non-interactive, so missing credentials fail fast — but the raw error
 * explains neither why nor what to do about it.
 * @param run The network operation's outcome.
 * @returns Returns the message to show.
 */
export function networkFailureMessage(run: GitRun): string {
  const text: string = `${run.error ?? ''} ${run.stderr}`;
  if (
    /could not read username|could not read password|authentication failed|invalid username or password|http.*40[13]|terminal prompts disabled/i.test(
      text,
    )
  ) {
    return (
      'Authentication required. Studio runs git non-interactively, so HTTPS remotes need a ' +
      'configured git credential helper (for example the OS keychain helper or ' +
      'git-credential-manager) holding a valid token. Configure one, verify with a git fetch ' +
      'in a terminal, then retry.'
    );
  }
  if (/permission denied \(publickey\)|host key verification failed/i.test(text)) {
    return (
      'SSH authentication failed. Studio runs git non-interactively, so SSH remotes need a key ' +
      'loaded in ssh-agent (and the host already in known_hosts). Load your key with ssh-add, ' +
      'verify with a git fetch in a terminal, then retry.'
    );
  }
  return run.error ?? 'git failed';
}

/**
 * Core's own git, speaking the version-control protocol from inside the main process (#816).
 *
 * This is `GitManager` moved behind the seam: the same commands, the same operand validation, the same
 * classification of conflicts and authentication failures — but answering with the protocol's typed
 * results rather than raw output for the renderer to parse. It is temporary by design: #817 lifts it
 * into the Git plugin, and core then runs no git at all.
 *
 * Every invocation uses `execFile` with array arguments (never a shell). The host has already checked
 * that the root lies within an open repository or workspace; this checks everything inside it.
 */
export class GitVersionControl implements VersionControlEndpoint {
  /**
   * Holds the git program to run, settled at start from the user's executable choice.
   */
  private program: string = 'git';

  /**
   * Holds whether the handshake has completed and the endpoint has not been disposed.
   */
  private started: boolean = false;

  /**
   * Gets whether the endpoint can be asked things.
   * @returns Returns true after a successful start.
   */
  public get running(): boolean {
    return this.started;
  }

  /**
   * Settles which git to run and reports what it is.
   * @param executable The user's choice, or null for the git on the `PATH`.
   * @returns Returns the description; a missing git is reported as a problem rather than a refusal,
   * so the user can be told what to fix.
   */
  public async start(
    executable: VersionControlExecutableChoice | null,
  ): Promise<VersionControlDescription> {
    this.program =
      executable?.mode === 'custom' && path.isAbsolute(executable.path) ? executable.path : 'git';
    const version: GitRun = await this.git(process.cwd(), ['--version'], GIT_TIMEOUT_MS);
    this.started = true;
    return {
      protocol: VERSION_CONTROL_PROTOCOL_VERSION,
      capabilities: VERSION_CONTROL_CAPABILITIES,
      toolVersion: version.success ? version.stdout.trim() : null,
      ...(version.success
        ? {}
        : { problem: `Git could not be run (${this.program}). Install Git, or choose its path.` }),
    };
  }

  /**
   * Performs an operation.
   * @param op The operation.
   * @param root The repository root, or undefined for a global operation.
   * @param params The operation's parameters, untrusted.
   * @returns Returns the answer.
   */
  public async request<Op extends VersionControlOp>(
    op: Op,
    root: string | undefined,
    params: VcsParams<Op>,
  ): Promise<VersionControlResponse<Op>> {
    if (!this.started) {
      return { id: 0, ok: false, error: 'Git is not running.' };
    }
    let outcome: Outcome;
    try {
      outcome = await this.perform(op, root === undefined ? undefined : path.resolve(root), params);
    } catch (error: unknown) {
      logger.warn('GitVersionControl', `${op} threw`, error);
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return { id: 0, ...outcome } as VersionControlResponse<Op>;
  }

  /**
   * Stops answering.
   */
  public dispose(): void {
    this.started = false;
  }

  /**
   * Routes an operation to its implementation.
   * @param op The operation.
   * @param root The resolved repository root, or undefined for a global operation.
   * @param untrusted The operation's parameters.
   * @returns Returns the outcome.
   */
  private perform(
    op: VersionControlOp,
    root: string | undefined,
    untrusted: unknown,
  ): Promise<Outcome> {
    const params: Record<string, unknown> =
      typeof untrusted === 'object' && untrusted !== null
        ? (untrusted as Record<string, unknown>)
        : {};
    if (op === 'resolveRoot') {
      return this.resolveRoot(params['path']);
    }
    if (op === 'clone') {
      return this.clone(params);
    }
    if (op === 'getIdentity') {
      return this.getIdentity();
    }
    if (op === 'setIdentity') {
      return this.setIdentity(params);
    }
    if (root === undefined) {
      return Promise.resolve(fail(`${op} needs a repository.`, 'refused'));
    }
    switch (op) {
      case 'status':
        return this.read(root, ['status', '--porcelain=v2', '--branch', '-z'], parseStatus);
      case 'operationState':
        return this.operationState(root).then(ok);
      case 'log':
        return this.read(
          root,
          ['log', `--max-count=${logLimit(params['limit'])}`, `--format=${LOG_FORMAT}`],
          parseLog,
        );
      case 'refs':
        return this.refs(root);
      case 'stashes':
        return this.read(root, ['stash', 'list', `--format=${STASH_FORMAT}`], parseStashes);
      case 'commitFiles':
        return isSafeOperand(params['hash'])
          ? this.read(
              root,
              ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', params['hash']],
              parseCommitFiles,
            )
          : Promise.resolve(fail('Invalid commit hash'));
      case 'readFile':
        return this.readFile(root, params['path'], params['version']);
      case 'discard':
        return this.discard(root, params['paths']);
      case 'stage':
        return this.pathCommand(root, params['paths'], ['add', '-A'], ['add', '--']);
      case 'unstage':
        return this.pathCommand(
          root,
          params['paths'],
          ['reset', '--quiet'],
          ['reset', '--quiet', '--'],
        );
      case 'commit':
        return typeof params['message'] === 'string' && params['message'].trim().length > 0
          ? this.mutate(root, ['commit', '-m', params['message']])
          : Promise.resolve(fail('A commit message is required'));
      case 'stash':
        return this.mutate(root, ['stash', 'push']);
      case 'stashApply':
        return this.stashCommand(root, 'apply', params['index']);
      case 'stashPop':
        return this.stashCommand(root, 'pop', params['index']);
      case 'stashDrop':
        return this.stashCommand(root, 'drop', params['index']);
      case 'checkout':
        return isSafeOperand(params['branch'])
          ? this.mutate(root, ['checkout', params['branch']])
          : Promise.resolve(fail('Invalid branch name'));
      case 'createBranch':
        return this.createBranch(root, params['name'], params['checkout']);
      case 'deleteBranch':
        return this.deleteBranch(root, params['name'], params['force'] === true);
      case 'renameBranch':
        return isSafeOperand(params['from']) && isSafeOperand(params['to'])
          ? this.mutate(root, ['branch', '-m', params['from'], params['to']])
          : Promise.resolve(fail('Invalid branch name'));
      case 'setUpstream':
        return this.setUpstream(root, params['branch'], params['upstream']);
      case 'fetch':
        return this.network(root, ['fetch', '--all', '--prune']);
      case 'fetchRef':
        return this.fetchRef(root, params['remote'], params['sourceRef'], params['localBranch']);
      case 'pull':
        return this.network(root, ['pull']);
      case 'push':
        return this.push(root, params['target']);
      case 'fetchRemote':
        return isSafeOperand(params['remote'])
          ? this.network(root, ['fetch', params['remote']])
          : Promise.resolve(fail('Invalid remote'));
      case 'pruneRemote':
        return isSafeOperand(params['remote'])
          ? this.network(root, ['remote', 'prune', params['remote']])
          : Promise.resolve(fail('Invalid remote'));
      case 'addRemote':
        return isSafeOperand(params['name']) && isSafeOperand(params['url'])
          ? this.mutate(root, ['remote', 'add', params['name'], params['url']])
          : Promise.resolve(fail('Invalid remote name or URL'));
      case 'removeRemote':
        return isSafeOperand(params['name'])
          ? this.mutate(root, ['remote', 'remove', params['name']])
          : Promise.resolve(fail('Invalid remote name'));
      case 'checkoutTracking':
        // Both operands are named rather than letting `--track` derive the local name, because what
        // git derives depends on configuration the panel cannot see.
        return isSafeOperand(params['remoteBranch']) && isSafeOperand(params['localBranch'])
          ? this.mutate(root, [
              'checkout',
              '-b',
              params['localBranch'],
              '--track',
              params['remoteBranch'],
            ])
          : Promise.resolve(fail('Invalid branch name'));
      case 'merge':
        return this.merge(root, params['branch'], params['mode']);
      case 'rebase':
        return isSafeOperand(params['onto'])
          ? this.integrate(root, ['rebase', params['onto']])
          : Promise.resolve(fail('Invalid branch name'));
      case 'operationContinue':
        return this.continueOperation(root);
      case 'operationSkip':
        return this.skipOperation(root);
      case 'operationAbort':
        return this.abortOperation(root);
      case 'createTag':
        return this.createTag(root, params['name'], params['commit'], params['message']);
      case 'deleteTag':
        return isSafeOperand(params['name'])
          ? this.mutate(root, ['tag', '-d', params['name']])
          : Promise.resolve(fail('Invalid tag name'));
      case 'deleteRemoteTag':
        return this.deleteRemoteTag(root, params['remote'], params['name']);
      case 'pushTag':
        // `git push <remote> tag <name>` names the tag without building a refspec from caller input,
        // so a name carrying a colon cannot become a source-and-destination pair.
        return isSafeOperand(params['remote']) && isSafeOperand(params['name'])
          ? this.network(root, ['push', params['remote'], 'tag', params['name']])
          : Promise.resolve(fail('Invalid remote or tag name'));
      case 'pushAllTags':
        return isSafeOperand(params['remote'])
          ? this.network(root, ['push', params['remote'], '--tags'])
          : Promise.resolve(fail('Invalid remote'));
      default:
        return Promise.resolve(fail(`Git does not support ${op}.`, 'unsupported'));
    }
  }

  /**
   * Finds the root of the repository containing a path.
   * @param target The absolute path to resolve from.
   * @returns Returns the root, or null when the path is in no repository.
   */
  private async resolveRoot(target: unknown): Promise<Outcome> {
    if (typeof target !== 'string' || !path.isAbsolute(target)) {
      return fail('The path is not absolute.');
    }
    const run: GitRun = await this.git(path.resolve(target), ['rev-parse', '--show-toplevel']);
    const root: string = run.success ? run.stdout.trim() : '';
    return ok({ root: root.length > 0 ? path.resolve(root) : null });
  }

  /**
   * Reads the multi-step operation the repository is in the middle of, if any.
   *
   * The git directory is asked for rather than assumed: a linked worktree's `.git` is a file pointing
   * elsewhere, and its merge and rebase state lives in that worktree's own directory.
   * @param root The repository root.
   * @returns Returns the operation state, whose kind is null when nothing is in flight.
   */
  private async operationState(root: string): Promise<VcsOperationState> {
    const located: GitRun = await this.git(root, ['rev-parse', '--absolute-git-dir']);
    const directory: string = located.stdout.trim();
    if (!located.success || directory.length === 0) {
      return { kind: null };
    }
    const state: VcsOperationState = classifyOperation(await probeOperation(directory));
    if (state.kind !== 'rebase' || state.target !== undefined) {
      return state;
    }
    // A rebase usually records only the commit it is replaying onto, so that commit is turned back
    // into a branch name rather than shown as a hash nobody asked about.
    const onto: string | null = await firstFile([
      path.join(directory, 'rebase-merge', 'onto'),
      path.join(directory, 'rebase-apply', 'onto'),
    ]);
    if (onto === null || !isSafeOperand(onto)) {
      return state;
    }
    const named: GitRun = await this.git(root, [
      'name-rev',
      '--name-only',
      '--refs=refs/heads/*',
      onto,
    ]);
    const name: string = named.stdout.trim();
    // `name-rev` answers `undefined` for a commit no branch reaches, which is a name for nothing.
    return {
      ...state,
      target: named.success && name.length > 0 && name !== 'undefined' ? name : onto.slice(0, 7),
    };
  }

  /**
   * Reads branches, remotes and tags. Two reads: `for-each-ref` knows the remote-tracking branches but
   * nothing of a remote's URL, and `git remote -v` knows the URLs but nothing of the branches.
   * @param root The repository root.
   * @returns Returns the refs.
   */
  private async refs(root: string): Promise<Outcome> {
    const [refs, remotes]: [GitRun, GitRun] = await Promise.all([
      this.git(root, [
        'for-each-ref',
        `--format=${REFS_FORMAT}`,
        'refs/heads',
        'refs/remotes',
        'refs/tags',
      ]),
      this.git(root, ['remote', '-v']),
    ]);
    if (!refs.success) {
      return fail(refs.error ?? 'git for-each-ref failed');
    }
    const parsed: VcsRefs = parseRefs(refs.stdout);
    return ok({
      ...parsed,
      remotes: mergeRemoteUrls(
        parsed.remotes,
        parseRemoteUrls(remotes.success ? remotes.stdout : ''),
      ),
    });
  }

  /**
   * Reads a version of a file. A file that does not exist in that version has null content: an added
   * or deleted file simply has an empty side.
   * @param root The repository root.
   * @param filePath The repository-relative path.
   * @param version The version to read.
   * @returns Returns the content.
   */
  private async readFile(root: string, filePath: unknown, version: unknown): Promise<Outcome> {
    if (confinedPaths(root, [filePath]) === null) {
      return fail('Invalid file path');
    }
    const relative: string = filePath as string;
    if (!isFileVersion(version)) {
      return fail('Invalid file version');
    }
    if (version.kind === 'working') {
      try {
        return ok({ content: await readFile(path.resolve(root, relative), 'utf8') });
      } catch {
        return ok({ content: null });
      }
    }
    const spec: string | null = revisionSpec(version, relative);
    if (spec === null) {
      return fail('Invalid file version');
    }
    const run: GitRun = await this.git(root, ['show', spec]);
    return ok({ content: run.success ? run.stdout : null });
  }

  /**
   * Discards the uncommitted changes to files — destructive, so the split between restore and delete
   * is decided from git's own view of the index, never trusted from the caller: tracked paths are
   * restored to `HEAD`, untracked (not ignored) paths are deleted, anything else is left alone.
   * @param root The repository root.
   * @param paths The repository-relative paths to discard; must not be empty.
   * @returns Returns the outcome.
   */
  private async discard(root: string, paths: unknown): Promise<Outcome> {
    const confined: string[] | null = confinedPaths(root, paths);
    if (confined === null || confined.length === 0) {
      return fail('Invalid path');
    }
    const tracked: Set<string> = await this.listed(root, ['ls-files'], confined);
    const untracked: Set<string> = await this.listed(
      root,
      ['ls-files', '--others', '--exclude-standard'],
      confined,
    );
    const toRestore: string[] = confined.filter((candidate: string): boolean =>
      tracked.has(candidate),
    );
    // An untracked directory is discarded by deleting it; ls-files lists the files inside it, so a
    // candidate counts as untracked when it is listed itself or is a listed file's ancestor.
    const toDelete: string[] = confined.filter(
      (candidate: string): boolean =>
        !tracked.has(candidate) &&
        [...untracked].some(
          (listed: string): boolean => listed === candidate || listed.startsWith(`${candidate}/`),
        ),
    );
    for (const relative of toDelete) {
      try {
        await rm(path.resolve(root, relative), { recursive: true, force: true });
      } catch (error: unknown) {
        logger.error('GitVersionControl', `Failed to delete ${relative} while discarding`, error);
        return fail(`Failed to delete ${relative}: ${String(error)}`);
      }
    }
    return toRestore.length > 0
      ? this.mutate(root, ['restore', '--staged', '--worktree', '--', ...toRestore])
      : ok(DONE);
  }

  /**
   * Lists the confined paths a git listing command reports.
   * @param root The repository root.
   * @param listing The `ls-files` variant.
   * @param confined The candidate paths to scope the listing to.
   * @returns Returns the listed paths.
   */
  private async listed(
    root: string,
    listing: readonly string[],
    confined: readonly string[],
  ): Promise<Set<string>> {
    const run: GitRun = await this.git(root, [...listing, '--', ...confined]);
    return new Set<string>(
      run.success ? run.stdout.split('\n').filter((line: string): boolean => line.length > 0) : [],
    );
  }

  /**
   * Runs a command over paths, or over everything when none are given (stage, unstage).
   * @param root The repository root.
   * @param paths The repository-relative paths, or an empty array for everything.
   * @param all The command for everything.
   * @param some The command prefix for named paths.
   * @returns Returns the outcome.
   */
  private pathCommand(
    root: string,
    paths: unknown,
    all: readonly string[],
    some: readonly string[],
  ): Promise<Outcome> {
    const confined: string[] | null = confinedPaths(root, paths);
    if (confined === null) {
      return Promise.resolve(fail('Invalid path'));
    }
    return this.mutate(root, confined.length === 0 ? all : [...some, ...confined]);
  }

  /**
   * Runs a stash-stack command against one entry, addressed by a validated index so no caller string
   * reaches the git command line.
   * @param root The repository root.
   * @param command The stash subcommand.
   * @param index The stack index (0 is the most recent).
   * @returns Returns the outcome.
   */
  private stashCommand(
    root: string,
    command: 'apply' | 'pop' | 'drop',
    index: unknown,
  ): Promise<Outcome> {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      return Promise.resolve(fail('Invalid stash index'));
    }
    return this.mutate(root, ['stash', command, `stash@{${index}}`]);
  }

  /**
   * Creates a branch at the current head, checking it out unless told not to.
   * @param root The repository root.
   * @param name The new branch name.
   * @param checkout Whether to check it out.
   * @returns Returns the outcome.
   */
  private createBranch(root: string, name: unknown, checkout: unknown): Promise<Outcome> {
    if (!isSafeOperand(name)) {
      return Promise.resolve(fail('Invalid branch name'));
    }
    return this.mutate(root, checkout === false ? ['branch', name] : ['checkout', '-b', name]);
  }

  /**
   * Deletes a local branch. An unforced delete git refuses is classified here rather than read out of
   * the error text: when the branch still exists and is not an ancestor of HEAD, it is unmerged — the
   * one refusal the user is offered a way past.
   * @param root The repository root.
   * @param name The branch name.
   * @param force Whether to delete it even when unmerged.
   * @returns Returns the outcome.
   */
  private async deleteBranch(root: string, name: unknown, force: boolean): Promise<Outcome> {
    if (!isSafeOperand(name)) {
      return fail('Invalid branch name');
    }
    const run: GitRun = await this.git(root, ['branch', force ? '-D' : '-d', name]);
    if (run.success) {
      return ok(DONE);
    }
    if (force) {
      return fail(run.error ?? 'git branch failed');
    }
    const exists: GitRun = await this.git(root, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${name}`,
    ]);
    if (!exists.success) {
      return fail(run.error ?? 'git branch failed');
    }
    const merged: GitRun = await this.git(root, ['merge-base', '--is-ancestor', name, 'HEAD']);
    return fail(run.error ?? 'git branch failed', merged.success ? undefined : 'branch-not-merged');
  }

  /**
   * Points a branch's upstream at a remote-tracking branch, or clears it.
   * @param root The repository root.
   * @param branch The local branch.
   * @param upstream The remote-tracking branch, or null to clear.
   * @returns Returns the outcome.
   */
  private setUpstream(root: string, branch: unknown, upstream: unknown): Promise<Outcome> {
    if (!isSafeOperand(branch)) {
      return Promise.resolve(fail('Invalid branch name'));
    }
    if (upstream === null) {
      return this.mutate(root, ['branch', '--unset-upstream', branch]);
    }
    if (!isSafeOperand(upstream)) {
      return Promise.resolve(fail('Invalid upstream'));
    }
    return this.mutate(root, ['branch', `--set-upstream-to=${upstream}`, branch]);
  }

  /**
   * Fetches one ref from a remote into a local branch. The refspec is built from three validated
   * operands rather than accepted whole: a colon would let one argument become several refspecs, and a
   * `+` prefix would make the fetch a force-update.
   * @param root The repository root.
   * @param remote The remote.
   * @param sourceRef The ref on the remote.
   * @param localBranch The local branch to create or update.
   * @returns Returns the outcome.
   */
  private fetchRef(
    root: string,
    remote: unknown,
    sourceRef: unknown,
    localBranch: unknown,
  ): Promise<Outcome> {
    if (
      !isSafeOperand(remote) ||
      !isSafeOperand(sourceRef) ||
      !isSafeOperand(localBranch) ||
      [remote, sourceRef, localBranch].some((part: string): boolean => part.includes(':'))
    ) {
      return Promise.resolve(fail('Invalid remote, ref, or branch name'));
    }
    return this.network(root, ['fetch', remote, `${sourceRef}:${localBranch}`]);
  }

  /**
   * Pushes the checked-out branch to its upstream, or a named branch to a remote — claiming the
   * upstream on the way only when asked, so a branch that already has one is not silently repointed.
   * @param root The repository root.
   * @param target Where to push, or null for the upstream.
   * @returns Returns the outcome.
   */
  private push(root: string, target: unknown): Promise<Outcome> {
    if (target === null || target === undefined) {
      return this.network(root, ['push']);
    }
    const where: Record<string, unknown> =
      typeof target === 'object' ? (target as Record<string, unknown>) : {};
    if (!isSafeOperand(where['remote']) || !isSafeOperand(where['branch'])) {
      return Promise.resolve(fail('Invalid push upstream'));
    }
    return this.network(
      root,
      where['setUpstream'] === false
        ? ['push', where['remote'], where['branch']]
        : ['push', '--set-upstream', where['remote'], where['branch']],
    );
  }

  /**
   * Merges a branch into the checked-out one. `--no-edit` is not decoration: without it git opens an
   * editor for the message and waits for an answer that cannot come.
   * @param root The repository root.
   * @param branch The branch to merge in.
   * @param mode How the merge records its result.
   * @returns Returns the outcome.
   */
  private merge(root: string, branch: unknown, mode: unknown): Promise<Outcome> {
    if (!isSafeOperand(branch)) {
      return Promise.resolve(fail('Invalid branch name'));
    }
    const options: readonly string[] =
      mode === 'squash'
        ? ['--squash']
        : mode === 'no-ff'
          ? ['--no-ff', '--no-edit']
          : ['--no-edit'];
    logger.info('GitVersionControl.merge', `Merging ${branch} (${String(mode)})`);
    return this.integrate(root, ['merge', ...options, branch]);
  }

  /**
   * Carries on the operation in flight. Which command that is follows from the operation the
   * repository is actually in, read now rather than taken from the caller's snapshot.
   * @param root The repository root.
   * @returns Returns the outcome.
   */
  private async continueOperation(root: string): Promise<Outcome> {
    const state: VcsOperationState = await this.operationState(root);
    switch (state.kind) {
      case 'rebase':
        return this.integrate(root, ['rebase', '--continue']);
      case 'merge':
        return this.integrate(root, ['merge', '--continue']);
      case 'cherry-pick':
        return this.integrate(root, ['cherry-pick', '--continue']);
      case 'revert':
        return this.integrate(root, ['revert', '--continue']);
      case 'squash-merge':
        // A squash records no merge, so what is staged is committed like any other change.
        return fail(
          'A squashed merge is finished by committing the staged result.',
          'squash-commit-required',
        );
      default:
        return fail(NO_OPERATION_ERROR, 'no-operation');
    }
  }

  /**
   * Skips the commit the operation in flight is stuck on.
   * @param root The repository root.
   * @returns Returns the outcome.
   */
  private async skipOperation(root: string): Promise<Outcome> {
    const state: VcsOperationState = await this.operationState(root);
    switch (state.kind) {
      case 'rebase':
        return this.integrate(root, ['rebase', '--skip']);
      case 'cherry-pick':
        return this.integrate(root, ['cherry-pick', '--skip']);
      case null:
        return fail(NO_OPERATION_ERROR, 'no-operation');
      default:
        // A merge applies one change rather than a sequence, so there is no next commit to move to.
        return fail(
          'This operation applies a single change, so there is nothing to skip.',
          'skip-unsupported',
        );
    }
  }

  /**
   * Abandons the operation in flight. A squash merge records no `MERGE_HEAD`, so `merge --abort`
   * refuses it; a `reset --merge` back to the head it never left undoes it without destroying a change
   * it did not touch.
   * @param root The repository root.
   * @returns Returns the outcome.
   */
  private async abortOperation(root: string): Promise<Outcome> {
    const state: VcsOperationState = await this.operationState(root);
    logger.info('GitVersionControl.abortOperation', `Aborting ${state.kind ?? 'nothing'}`);
    switch (state.kind) {
      case 'rebase':
        return this.integrate(root, ['rebase', '--abort']);
      case 'merge':
        return this.integrate(root, ['merge', '--abort']);
      case 'cherry-pick':
        return this.integrate(root, ['cherry-pick', '--abort']);
      case 'revert':
        return this.integrate(root, ['revert', '--abort']);
      case 'squash-merge':
        return this.integrate(root, ['reset', '--merge']);
      default:
        return fail(NO_OPERATION_ERROR, 'no-operation');
    }
  }

  /**
   * Creates a tag, annotated when a message is given. The message is bound positionally to `-m`, so it
   * is not held to {@link isSafeOperand}; it is still its own argument, never a shell string.
   * @param root The repository root.
   * @param name The tag name.
   * @param commit The commit to tag.
   * @param message The annotation, or undefined for a lightweight tag.
   * @returns Returns the outcome.
   */
  private createTag(
    root: string,
    name: unknown,
    commit: unknown,
    message: unknown,
  ): Promise<Outcome> {
    if (!isSafeOperand(name) || !isSafeOperand(commit)) {
      return Promise.resolve(fail('Invalid tag name or commit'));
    }
    if (message !== undefined && (typeof message !== 'string' || message.length === 0)) {
      return Promise.resolve(fail('Invalid tag message'));
    }
    return this.mutate(
      root,
      message === undefined ? ['tag', name, commit] : ['tag', '-a', name, '-m', message, commit],
    );
  }

  /**
   * Deletes a tag on a remote, spelled out as `refs/tags/<name>` so a branch of the same name cannot be
   * deleted instead.
   * @param root The repository root.
   * @param remote The remote.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  private deleteRemoteTag(root: string, remote: unknown, name: unknown): Promise<Outcome> {
    if (
      !isSafeOperand(remote) ||
      !isSafeOperand(name) ||
      remote.includes(':') ||
      name.includes(':')
    ) {
      return Promise.resolve(fail('Invalid remote or tag name'));
    }
    return this.network(root, ['push', remote, '--delete', `refs/tags/${name}`]);
  }

  /**
   * Copies a repository into a new directory, then checks out a branch when one is named — creating
   * it from the default branch when asked to.
   * @param params The clone's parameters, untrusted.
   * @returns Returns the outcome.
   */
  private async clone(params: Record<string, unknown>): Promise<Outcome> {
    const url: unknown = params['url'];
    const directory: unknown = params['directory'];
    const branch: unknown = params['branch'];
    if (!isSafeOperand(url) || typeof directory !== 'string' || !path.isAbsolute(directory)) {
      return fail('Invalid clone source or directory');
    }
    if (branch !== undefined && !isSafeOperand(branch)) {
      return fail('Invalid branch name');
    }
    const target: string = path.resolve(directory);
    const cloned: GitRun = await this.git(
      path.dirname(target),
      ['clone', '--', url, path.basename(target)],
      GIT_CLONE_TIMEOUT_MS,
      GIT_NETWORK_ENV,
    );
    if (!cloned.success) {
      return fail(networkFailureMessage(cloned));
    }
    if (branch === undefined) {
      return ok(DONE);
    }
    const switched: GitRun = await this.git(target, ['checkout', branch]);
    if (switched.success) {
      return ok(DONE);
    }
    if (params['createBranch'] !== true) {
      return fail(switched.error ?? 'git checkout failed');
    }
    const created: GitRun = await this.git(target, ['checkout', '-b', branch]);
    return created.success ? ok(DONE) : fail(created.error ?? 'git checkout failed');
  }

  /**
   * Reads the user's global committer identity.
   * @returns Returns the identity, with empty fields where unset.
   */
  private async getIdentity(): Promise<Outcome> {
    const [name, email]: [GitRun, GitRun] = await Promise.all([
      this.git(process.cwd(), ['config', '--global', 'user.name']),
      this.git(process.cwd(), ['config', '--global', 'user.email']),
    ]);
    return ok({
      name: name.success ? name.stdout.trim() : '',
      email: email.success ? email.stdout.trim() : '',
    });
  }

  /**
   * Sets the user's global committer identity.
   * @param params The identity, untrusted.
   * @returns Returns the outcome.
   */
  private async setIdentity(params: Record<string, unknown>): Promise<Outcome> {
    const identity: VcsIdentity | null =
      typeof params['name'] === 'string' && typeof params['email'] === 'string'
        ? { name: params['name'].trim(), email: params['email'].trim() }
        : null;
    if (identity === null || identity.name.length === 0 || identity.email.length === 0) {
      return fail('A name and an email address are required.');
    }
    for (const [key, value] of [
      ['user.name', identity.name],
      ['user.email', identity.email],
    ] as const) {
      const run: GitRun = await this.git(process.cwd(), ['config', '--global', key, value]);
      if (!run.success) {
        return fail(run.error ?? 'git config failed');
      }
    }
    return ok(DONE);
  }

  /**
   * Runs a read and parses its output.
   * @param root The repository root.
   * @param args The git arguments.
   * @param parse Parses the output.
   * @returns Returns the parsed result, or the failure.
   */
  private async read<Result>(
    root: string,
    args: readonly string[],
    parse: (output: string) => Result,
  ): Promise<Outcome> {
    const run: GitRun = await this.git(root, args);
    return run.success ? ok(parse(run.stdout)) : fail(run.error ?? `git ${args[0]} failed`);
  }

  /**
   * Runs a local mutation.
   * @param root The repository root.
   * @param args The git arguments.
   * @returns Returns the outcome.
   */
  private async mutate(root: string, args: readonly string[]): Promise<Outcome> {
    const run: GitRun = await this.git(root, args);
    return run.success ? ok(DONE) : fail(run.error ?? `git ${args[0]} failed`);
  }

  /**
   * Runs a network operation non-interactively, explaining an authentication failure.
   * @param root The repository root.
   * @param args The git arguments.
   * @returns Returns the outcome.
   */
  private async network(root: string, args: readonly string[]): Promise<Outcome> {
    const run: GitRun = await this.git(root, args, GIT_NETWORK_TIMEOUT_MS, GIT_NETWORK_ENV);
    if (!run.success) {
      logger.debug('GitVersionControl', `Network git ${args[0]} failed`);
    }
    return run.success ? ok(DONE) : fail(networkFailureMessage(run));
  }

  /**
   * Runs a merge, a rebase, or a command that finishes one: with no editor to block on, and with a
   * conflict told apart from a failure. Git exits non-zero for both; the difference is what it left
   * behind — an operation still in flight means it stopped to ask.
   * @param root The repository root.
   * @param args The git arguments.
   * @returns Returns the outcome, coded `conflicted` when it stopped on conflicts.
   */
  private async integrate(root: string, args: readonly string[]): Promise<Outcome> {
    const run: GitRun = await this.git(root, args, GIT_INTEGRATION_TIMEOUT_MS, GIT_NO_EDITOR_ENV);
    if (run.success) {
      return ok(DONE);
    }
    const state: VcsOperationState = await this.operationState(root);
    return fail(
      run.error ?? `git ${args[0]} failed`,
      state.kind === null ? undefined : 'conflicted',
    );
  }

  /**
   * Invokes git with array arguments in a working directory, capturing its output.
   * @param cwd The working directory.
   * @param args The git arguments.
   * @param timeoutMs How long it may run.
   * @param env An environment overlay.
   * @returns Returns the outcome.
   */
  private git(
    cwd: string,
    args: readonly string[],
    timeoutMs: number = GIT_TIMEOUT_MS,
    env: NodeJS.ProcessEnv = {},
  ): Promise<GitRun> {
    logger.trace('GitVersionControl', `git ${args.join(' ')} (cwd ${cwd})`);
    return new Promise<GitRun>((resolve: (run: GitRun) => void): void => {
      execFile(
        this.program,
        [...args],
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: GIT_MAX_BUFFER,
          windowsHide: true,
          // Reads (status in particular) must not opportunistically write the index: the repository
          // is watched for on-disk changes, and a status that refreshed the index would trigger the
          // watcher that triggered it.
          env: { ...process.env, ...env, GIT_OPTIONAL_LOCKS: '0' },
        },
        (error: Error | null, stdout: string, stderr: string): void => {
          if (error !== null) {
            // Git failing is often expected (a status outside a repository, a rejected push), so
            // this is debug; the caller surfaces the outcome.
            logger.debug('GitVersionControl', `git ${args[0] ?? ''} failed: ${error.message}`);
            resolve({
              success: false,
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              error: error.message,
            });
            return;
          }
          resolve({ success: true, stdout, stderr });
        },
      );
    });
  }
}

/**
 * Clamps an untrusted log limit.
 * @param limit The requested limit.
 * @returns Returns a count between 1 and {@link MAX_LOG_LIMIT}.
 */
function logLimit(limit: unknown): number {
  return typeof limit === 'number' && Number.isFinite(limit)
    ? Math.min(MAX_LOG_LIMIT, Math.max(1, Math.floor(limit)))
    : MAX_LOG_LIMIT;
}

/**
 * Determines whether an untrusted value is a file version.
 * @param value The candidate.
 * @returns Returns true when it is one.
 */
function isFileVersion(value: unknown): value is VcsFileVersion {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const kind: unknown = (value as Record<string, unknown>)['kind'];
  return (
    kind === 'working' ||
    kind === 'index' ||
    kind === 'head' ||
    kind === 'ours' ||
    (kind === 'commit' && typeof (value as Record<string, unknown>)['hash'] === 'string')
  );
}

/**
 * Builds a successful outcome.
 * @param result The result.
 * @returns Returns the outcome.
 */
function ok(result: unknown): Outcome {
  return { ok: true, result };
}

/**
 * Builds a failed outcome.
 * @param error The message to show.
 * @param code The outcome's code, when it is one a surface handles differently.
 * @returns Returns the outcome.
 */
function fail(error: string, code?: VcsErrorCode): Outcome {
  return { ok: false, error, ...(code === undefined ? {} : { code }) };
}
