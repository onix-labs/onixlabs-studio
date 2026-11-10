import type { VcsOperationState } from '@shared/api/version-control-protocol';

/**
 * Names the two sides of a conflict as the user reads them (#1321): their own work, and the other
 * side's, each by the branch it belongs to when that is known.
 */
export interface ConflictSides {
  /**
   * Gets the name of the user's own side — the branch checked out in a merge, the branch being replayed
   * in a rebase — or null when nothing names it.
   */
  readonly yours: string | null;

  /**
   * Gets the name of the other side — the branch being merged in, or the one being replayed onto — or
   * null when nothing names it.
   */
  readonly theirs: string | null;
}

/**
 * Counts the conflicts git left in a file: each `<<<<<<<` that is followed, in order, by a `=======` and
 * a `>>>>>>>`, every marker at the start of its line. A whole block is required, so prose that merely
 * contains one of the markers — a `=======` under a heading, a document about git — counts as none.
 * A diff3 file's `|||||||` section sits between the opener and the divider and needs no handling.
 * @param text The file's content as it stands on disk.
 * @returns Returns the number of conflicts left in it.
 */
export function countConflicts(text: string): number {
  let count: number = 0;
  let stage: 'outside' | 'ours' | 'theirs' = 'outside';
  for (const line of text.split(/\r?\n/)) {
    if (/^<{7}( |$)/.test(line)) {
      stage = 'ours';
    } else if (stage === 'ours' && /^={7}$/.test(line)) {
      stage = 'theirs';
    } else if (stage === 'theirs' && /^>{7}( |$)/.test(line)) {
      count += 1;
      stage = 'outside';
    }
  }
  return count;
}

/**
 * Names the two sides of the conflicts an operation stopped on. "Yours" is always the user's own work,
 * whatever git calls it: git's `ours` is the branch checked out, which in a rebase is the branch being
 * replayed *onto*, so there the names swap — the plugin does the same when a side is taken.
 * @param operation The operation in flight.
 * @param currentBranch The branch checked out, or null when detached.
 * @returns Returns the names, null where nothing names a side.
 */
export function conflictSides(
  operation: VcsOperationState,
  currentBranch: string | null,
): ConflictSides {
  if (operation.kind === 'rebase') {
    return { yours: operation.branch ?? null, theirs: operation.target ?? null };
  }
  if (operation.kind === 'merge' || operation.kind === 'squash-merge') {
    return { yours: currentBranch, theirs: operation.target ?? null };
  }
  return { yours: currentBranch, theirs: null };
}

/**
 * Labels the command that settles a conflicted file with one side: "Keep main (Yours)", or "Keep
 * Yours" when nothing names the side.
 * @param side Which side.
 * @param sides The sides' names.
 * @returns Returns the label.
 */
export function keepSideLabel(side: 'yours' | 'theirs', sides: ConflictSides): string {
  const name: string | null = side === 'yours' ? sides.yours : sides.theirs;
  const role: string = side === 'yours' ? 'Yours' : 'Theirs';
  return name === null ? `Keep ${role}` : `Keep ${name} (${role})`;
}

/**
 * Says what an operation is doing, in the user's words: "Merging feature/x into main", "Rebasing
 * feature/x onto main — commit 3 of 7". Whatever git did not name is left out rather than guessed.
 * @param operation The operation in flight.
 * @param currentBranch The branch checked out, or null when detached.
 * @returns Returns the sentence, or empty when nothing is in flight.
 */
export function describeOperation(
  operation: VcsOperationState,
  currentBranch: string | null,
): string {
  const sides: ConflictSides = conflictSides(operation, currentBranch);
  const named: (name: string | null, prefix: string) => string = (
    name: string | null,
    prefix: string,
  ): string => (name === null ? '' : `${prefix}${name}`);
  switch (operation.kind) {
    case null:
      return '';
    case 'merge':
    case 'squash-merge': {
      const verb: string = operation.kind === 'merge' ? 'Merging' : 'Squash merging';
      return `${verb}${named(sides.theirs, ' ')}${named(sides.yours, ' into ')}`;
    }
    case 'rebase': {
      const progress: string =
        operation.step === undefined || operation.total === undefined
          ? ''
          : ` — commit ${operation.step} of ${operation.total}`;
      return `Rebasing${named(sides.yours, ' ')}${named(sides.theirs, ' onto ')}${progress}`;
    }
    case 'cherry-pick':
      return `Cherry-picking${named(sides.yours, ' onto ')}`;
    case 'revert':
      return `Reverting${named(sides.yours, ' on ')}`;
  }
}

/**
 * Says how far through resolving the user is: "2 of 5 files resolved", or null before any file has
 * been seen conflicted.
 * @param resolved The files resolved so far.
 * @param total The files that were conflicted.
 * @returns Returns the line, or null.
 */
export function resolvedProgress(resolved: number, total: number): string | null {
  if (total === 0) {
    return null;
  }
  return `${resolved} of ${total} ${total === 1 ? 'file' : 'files'} resolved`;
}

/**
 * Words a refused Mark Resolved: which file, and how many conflicts it still holds.
 * @param name The file's name.
 * @param count How many conflicts are left.
 * @returns Returns the message.
 */
export function conflictsLeftMessage(name: string, count: number): string {
  return `${name} still has ${count} ${count === 1 ? 'conflict' : 'conflicts'}. Resolve ${count === 1 ? 'it' : 'them'}, or choose Mark Resolved Anyway to stage it as it is.`;
}
