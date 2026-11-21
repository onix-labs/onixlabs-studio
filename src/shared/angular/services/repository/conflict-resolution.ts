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

/**
 * Names one of the merge tool's panes (#1321): the file as it stands, with its markers; the user's own
 * work; the other side's; and a diff3 file's common ancestor.
 */
export type ConflictPane = 'result' | 'yours' | 'theirs' | 'base';

/**
 * Locates a run of lines in one pane, 1-based. An empty run (a side that removed the lines) has a count
 * of 0 and starts on the line that follows where it would be.
 */
export interface ConflictLineSpan {
  /**
   * Gets the first line of the run, or for an empty run the line after where it would be.
   */
  readonly start: number;

  /**
   * Gets how many lines the run holds.
   */
  readonly count: number;
}

/**
 * Locates one conflict in every pane of the merge tool: the whole block, markers and all, in the file,
 * and the section each side wrote in the side panes.
 */
export interface ConflictRegion {
  /**
   * Gets the conflict's lines in the file, from its opener to its closer.
   */
  readonly result: ConflictLineSpan;

  /**
   * Gets the user's own section in the Yours pane.
   */
  readonly yours: ConflictLineSpan;

  /**
   * Gets the other side's section in the Theirs pane.
   */
  readonly theirs: ConflictLineSpan;

  /**
   * Gets the common ancestor's section in the Base pane, or null when the file has no base pane.
   */
  readonly base: ConflictLineSpan | null;
}

/**
 * Holds what the merge tool shows beside a conflicted file: the file as each side would have it, and
 * where each conflict sits in each.
 */
export interface ConflictVersions {
  /**
   * Gets the file with every conflict settled the user's way.
   */
  readonly yours: string;

  /**
   * Gets the file with every conflict settled the other side's way.
   */
  readonly theirs: string;

  /**
   * Gets the file with every conflict put back as the common ancestor had it, or null unless every
   * conflict carries a diff3 base section.
   */
  readonly base: string | null;

  /**
   * Gets the conflicts, in the file's order.
   */
  readonly regions: readonly ConflictRegion[];
}

/**
 * Works out the merge tool's side panes from the file's own markers (#1321): the file as the user's
 * side would have it, as the other side's would, and — where git wrote diff3 base sections — as the
 * common ancestor had it, with where each conflict lands in each.
 *
 * Read from the markers rather than from git's index stages, so the panes follow the file as it is
 * edited: a conflict settled in the result disappears from the sides with it, and every line outside
 * the conflicts — already merged by git — is the same in all three panes, which is what lets them be
 * lined up conflict by conflict.
 * @param text The file's content, markers and all.
 * @param swapped Whether git wrote the user's own work below the divider (a rebase).
 * @returns Returns the side panes' text and the conflicts' places.
 */
export function conflictVersions(text: string, swapped: boolean): ConflictVersions {
  const eol: string = text.includes('\r\n') ? '\r\n' : '\n';
  const lines: readonly string[] = text.split(/\r?\n/);
  const blocks: readonly ConflictBlock[] = parseConflicts(text);
  const hasBase: boolean =
    blocks.length > 0 && blocks.every((block: ConflictBlock): boolean => block.base !== null);
  const yours: string[] = [];
  const theirs: string[] = [];
  const base: string[] = [];
  const regions: ConflictRegion[] = [];
  let next: number = 1;
  const copyUpTo: (line: number) => void = (line: number): void => {
    const shared: readonly string[] = lines.slice(next - 1, line - 1);
    yours.push(...shared);
    theirs.push(...shared);
    base.push(...shared);
  };
  const append: (pane: string[], section: readonly string[]) => ConflictLineSpan = (
    pane: string[],
    section: readonly string[],
  ): ConflictLineSpan => {
    const start: number = pane.length + 1;
    pane.push(...section);
    return { start, count: section.length };
  };
  for (const block of blocks) {
    copyUpTo(block.start);
    const top: readonly string[] = resolveConflictLines(lines, block, 'top');
    const bottom: readonly string[] = resolveConflictLines(lines, block, 'bottom');
    const ancestor: readonly string[] =
      block.base === null ? [] : lines.slice(block.base, block.divider - 1);
    regions.push({
      result: { start: block.start, count: block.end - block.start + 1 },
      yours: append(yours, swapped ? bottom : top),
      theirs: append(theirs, swapped ? top : bottom),
      base: hasBase ? append(base, ancestor) : null,
    });
    next = block.end + 1;
  }
  copyUpTo(lines.length + 1);
  return {
    yours: yours.join(eol),
    theirs: theirs.join(eol),
    base: hasBase ? base.join(eol) : null,
    regions,
  };
}

/**
 * Finds the line in one merge-tool pane that stands beside a line in another, so the panes can scroll
 * together. Outside the conflicts the panes hold the same lines, shifted by however much longer or
 * shorter the conflicts above are in each; inside a conflict, a line maps to the same distance into the
 * other side's section, or that section's last line when it is shorter.
 * @param line The line, 1-based, in the pane it was read from.
 * @param regions The conflicts.
 * @param from The pane the line is in.
 * @param to The pane to find its partner in.
 * @returns Returns the partner line, 1-based and never below 1; the line itself when either pane is
 * a base pane the file does not have.
 */
export function mapConflictLine(
  line: number,
  regions: readonly ConflictRegion[],
  from: ConflictPane,
  to: ConflictPane,
): number {
  let shift: number = 0;
  for (const region of regions) {
    const source: ConflictLineSpan | null = region[from];
    const target: ConflictLineSpan | null = region[to];
    if (source === null || target === null) {
      return line;
    }
    if (line < source.start) {
      return Math.max(1, line + target.start - source.start);
    }
    if (line < source.start + source.count) {
      const into: number = line - source.start;
      return Math.max(1, target.start + Math.min(into, Math.max(target.count - 1, 0)));
    }
    shift = target.start + target.count - (source.start + source.count);
  }
  return Math.max(1, line + shift);
}
