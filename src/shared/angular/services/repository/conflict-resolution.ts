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
 * Locates one conflict git left in a file, by the 1-based lines of its markers (#1321).
 *
 * The section above the divider is git's `ours` and the one below it git's `theirs`, which is not
 * always the user's own work against the other side's: in a rebase git swaps them (see
 * {@link conflictSides}).
 */
export interface ConflictBlock {
  /**
   * Gets the line of the `<<<<<<<` opener.
   */
  readonly start: number;

  /**
   * Gets the line of a diff3 file's `|||||||` base marker, or null when the file has none.
   */
  readonly base: number | null;

  /**
   * Gets the line of the `=======` divider.
   */
  readonly divider: number;

  /**
   * Gets the line of the `>>>>>>>` closer.
   */
  readonly end: number;
}

/**
 * Says which part of a conflict to keep: the section above the divider, the one below it, or both in
 * the file's order. The base section of a diff3 file is never kept.
 */
export type ConflictChoice = 'top' | 'bottom' | 'both';

/**
 * Finds the conflicts git left in a file: each `<<<<<<<` that is followed, in order, by a `=======` and
 * a `>>>>>>>`, every marker at the start of its line. A whole block is required, so prose that merely
 * contains one of the markers — a `=======` under a heading, a document about git — is none. A diff3
 * file's `|||||||` base section sits between the opener and the divider. An opener met inside an
 * unfinished block starts over, as git never nests them.
 * @param text The file's content.
 * @returns Returns the conflicts, in the file's order.
 */
export function parseConflicts(text: string): readonly ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  let start: number | null = null;
  let base: number | null = null;
  let divider: number | null = null;
  const lines: readonly string[] = text.split(/\r?\n/);
  for (let index: number = 0; index < lines.length; index += 1) {
    const line: string = lines[index];
    const number: number = index + 1;
    if (/^<{7}( |$)/.test(line)) {
      start = number;
      base = null;
      divider = null;
    } else if (start !== null && divider === null && base === null && /^\|{7}( |$)/.test(line)) {
      base = number;
    } else if (start !== null && divider === null && /^={7}$/.test(line)) {
      divider = number;
    } else if (start !== null && divider !== null && /^>{7}( |$)/.test(line)) {
      blocks.push({ start, base, divider, end: number });
      start = null;
      base = null;
      divider = null;
    }
  }
  return blocks;
}

/**
 * Counts the conflicts git left in a file, by {@link parseConflicts}'s rules: a whole block each, so
 * prose that merely contains a marker counts as none.
 * @param text The file's content as it stands on disk.
 * @returns Returns the number of conflicts left in it.
 */
export function countConflicts(text: string): number {
  return parseConflicts(text).length;
}

/**
 * Gives the lines that replace a conflict, markers and all, when one part of it is kept.
 * @param lines The file's lines, in order (the first is line 1).
 * @param block The conflict.
 * @param choice Which part to keep.
 * @returns Returns the lines to put in the conflict's place; empty when the kept part was empty.
 */
export function resolveConflictLines(
  lines: readonly string[],
  block: ConflictBlock,
  choice: ConflictChoice,
): readonly string[] {
  // Lines are 1-based and `slice` is 0-based and end-exclusive, so a section from line a to line b
  // (inclusive) is `slice(a - 1, b)`.
  const top: readonly string[] = lines.slice(block.start, (block.base ?? block.divider) - 1);
  const bottom: readonly string[] = lines.slice(block.divider, block.end - 1);
  switch (choice) {
    case 'top':
      return top;
    case 'bottom':
      return bottom;
    case 'both':
      return [...top, ...bottom];
  }
}

/**
 * Says which part of a conflict is the user's own work: the top in a merge, where git's `ours` is the
 * branch checked out, and the bottom in a rebase, where git swaps the two.
 * @param side Which side the user chose.
 * @param swapped Whether git swapped the sections (a rebase).
 * @returns Returns the part to keep.
 */
export function choiceForSide(side: 'yours' | 'theirs', swapped: boolean): ConflictChoice {
  return (side === 'yours') !== swapped ? 'top' : 'bottom';
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
