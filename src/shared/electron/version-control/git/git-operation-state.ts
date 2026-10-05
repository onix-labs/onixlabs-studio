import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { VcsOperationState } from '@shared/api/version-control-protocol';

// Reading which multi-step operation (merge, rebase, cherry-pick, revert) a git repository is in the
// middle of, from the state files git leaves in its git directory. Moved from `GitManager` (#816).

/**
 * Holds the state files git writes into a repository's git directory while a multi-step operation is
 * unfinished, read together so one look says which operation is in flight and how far through it is.
 *
 * Presence is what matters for the first six; the rest carry the detail, and are null when git wrote
 * no such file. Kept as plain data so {@link classifyOperation} can be a pure function with a test —
 * the reading is trivial, the *rules* are not.
 */
export interface OperationProbe {
  /**
   * Gets a value indicating whether the `rebase-merge` directory exists (the rebase backend used for
   * interactive rebases and, since git 2.26, ordinary ones).
   */
  readonly rebaseMerge: boolean;

  /**
   * Gets a value indicating whether the `rebase-apply` directory exists (the older patch-applying
   * rebase backend, and the one `git am` uses).
   */
  readonly rebaseApply: boolean;

  /**
   * Gets a value indicating whether `MERGE_HEAD` exists — the commit being merged in.
   */
  readonly mergeHead: boolean;

  /**
   * Gets a value indicating whether `CHERRY_PICK_HEAD` exists.
   */
  readonly cherryPickHead: boolean;

  /**
   * Gets a value indicating whether `REVERT_HEAD` exists.
   */
  readonly revertHead: boolean;

  /**
   * Gets a value indicating whether `SQUASH_MSG` exists — written by a squash merge, which records no
   * `MERGE_HEAD` and so cannot be recognised any other way.
   */
  readonly squashMessage: boolean;

  /**
   * Gets the contents of the rebase's `head-name` (the full ref of the branch being replayed).
   */
  readonly headName: string | null;

  /**
   * Gets the contents of the rebase's `onto_name` (the ref the replay is onto, as the user named it).
   * Frequently absent: git writes it on some rebase paths and not others, which is why a rebase with
   * no name here has the commit it recorded resolved into one instead.
   */
  readonly ontoName: string | null;

  /**
   * Gets the contents of the rebase's `msgnum`/`next` (the commit being applied).
   */
  readonly step: string | null;

  /**
   * Gets the contents of the rebase's `end`/`last` (how many commits are to be applied).
   */
  readonly total: string | null;

  /**
   * Gets the first line of `MERGE_MSG`, which names what is being merged in the way a human would.
   */
  readonly mergeMessage: string | null;
}

/**
 * Strips the `refs/heads/` prefix from a ref, leaving a branch name as a user reads it.
 * @param ref The ref, or null.
 * @returns Returns the short name, or undefined when there was no ref.
 */
function shortBranchName(ref: string | null): string | undefined {
  if (ref === null || ref.length === 0) {
    return undefined;
  }
  const prefix: string = 'refs/heads/';
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

/**
 * Pulls the quoted ref out of a merge message's first line — `Merge branch 'topic'` yields `topic`.
 *
 * Git's own generated message is the only place a plain merge records what it is merging under a name
 * rather than a hash, so it is worth reading; but it is prose, and prose is not a contract. A line
 * that does not match simply yields nothing, and the caller shows the operation without a target.
 *
 * @param message The merge message's first line, or null.
 * @returns Returns the quoted ref, or undefined when the line names none.
 */
function mergeTargetName(message: string | null): string | undefined {
  if (message === null) {
    return undefined;
  }
  const match: RegExpMatchArray | null = /'([^']+)'/.exec(message);
  return match === null ? undefined : match[1];
}

/**
 * Parses one of git's small counter files into a positive integer.
 * @param value The file's contents, or null.
 * @returns Returns the number, or undefined when there was none to read.
 */
function counter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed: number = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Decides which multi-step operation a repository is in the middle of from the state files git left.
 *
 * The order is the point. A rebase applying a commit that conflicts leaves `REBASE_HEAD` *and*, on
 * some paths, the same marker files a cherry-pick would — because replaying a commit is what a rebase
 * does — so the rebase directories are tested first and win. Squash is tested last, because it is
 * recognised only by the absence of everything else plus a `SQUASH_MSG`, and a plain merge that has
 * written its message would otherwise be mistaken for one.
 *
 * @param probe The state files read from the repository's git directory.
 * @returns Returns the operation state, whose kind is null when nothing is in flight.
 */
export function classifyOperation(probe: OperationProbe): VcsOperationState {
  if (probe.rebaseMerge || probe.rebaseApply) {
    return {
      kind: 'rebase',
      ...(shortBranchName(probe.headName) === undefined
        ? {}
        : { branch: shortBranchName(probe.headName) }),
      ...(shortBranchName(probe.ontoName) === undefined
        ? {}
        : { target: shortBranchName(probe.ontoName) }),
      ...(counter(probe.step) === undefined ? {} : { step: counter(probe.step) }),
      ...(counter(probe.total) === undefined ? {} : { total: counter(probe.total) }),
    };
  }
  if (probe.cherryPickHead) {
    return { kind: 'cherry-pick' };
  }
  if (probe.revertHead) {
    return { kind: 'revert' };
  }
  const target: string | undefined = mergeTargetName(probe.mergeMessage);
  if (probe.mergeHead) {
    return { kind: 'merge', ...(target === undefined ? {} : { target }) };
  }
  if (probe.squashMessage) {
    return { kind: 'squash-merge', ...(target === undefined ? {} : { target }) };
  }
  return { kind: null };
}

/**
 * Reads the state files a multi-step operation leaves in a repository's git directory. Every read
 * is forgiving: a file that is not there is the ordinary case, and means the operation that writes
 * it is not running.
 * @param directory The absolute git directory.
 * @returns Returns the probe.
 */
export async function probeOperation(directory: string): Promise<OperationProbe> {
  const at: (...parts: readonly string[]) => string = (...parts: readonly string[]): string =>
    path.join(directory, ...parts);
  const [
    rebaseMerge,
    rebaseApply,
    mergeHead,
    cherryPickHead,
    revertHead,
    squashMessage,
    headName,
    ontoName,
    step,
    total,
    mergeMessage,
  ]: [
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
  ] = await Promise.all([
    exists(at('rebase-merge')),
    exists(at('rebase-apply')),
    exists(at('MERGE_HEAD')),
    exists(at('CHERRY_PICK_HEAD')),
    exists(at('REVERT_HEAD')),
    exists(at('SQUASH_MSG')),
    // The two rebase backends name the same facts differently, so each is read from whichever
    // directory is present; only one of the pair can exist at a time.
    firstFile([at('rebase-merge', 'head-name'), at('rebase-apply', 'head-name')]),
    // Only some rebases write a name here at all; the caller resolves the
    // recorded commit when they do not.
    firstFile([at('rebase-merge', 'onto_name')]),
    firstFile([at('rebase-merge', 'msgnum'), at('rebase-apply', 'next')]),
    firstFile([at('rebase-merge', 'end'), at('rebase-apply', 'last')]),
    firstLine(at('MERGE_MSG')),
  ]);
  return {
    rebaseMerge,
    rebaseApply,
    mergeHead,
    cherryPickHead,
    revertHead,
    squashMessage,
    headName,
    ontoName,
    step,
    total,
    mergeMessage,
  };
}

/**
 * Determines whether a path exists, treating any failure to look as absence — which is what it means
 * here, since these are files git writes only while an operation is unfinished.
 * @param target The absolute path to test.
 * @returns Returns true when the path exists.
 */
async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the first of several candidate files that exists, trimmed.
 * @param candidates The absolute paths to try, in order.
 * @returns Returns the contents, or null when none of them could be read.
 */
export async function firstFile(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      return (await readFile(candidate, 'utf8')).trim();
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Reads a file's first line, trimmed.
 * @param target The absolute path to read.
 * @returns Returns the first line, or null when the file could not be read.
 */
async function firstLine(target: string): Promise<string | null> {
  try {
    const content: string = await readFile(target, 'utf8');
    return (content.split('\n')[0] ?? '').trim();
  } catch {
    return null;
  }
}
