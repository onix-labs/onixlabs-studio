import { ArrayChange, diffArrays } from 'diff';

/**
 * Describes the per-line save-state changes of one document version relative to another, expressed in
 * the modified document's own (1-based) line coordinates so the result can be applied directly as
 * editor decorations.
 */
export interface LineChangeSet {
  /**
   * Gets the line numbers that are new or modified relative to the original.
   */
  readonly changedLines: ReadonlySet<number>;

  /**
   * Gets the surviving line numbers immediately above a pure deletion. A value of zero indicates the
   * deletion occurred before the first line, where there is no surviving line above to anchor to.
   */
  readonly deletionAnchors: ReadonlySet<number>;
}

/**
 * Splits document content into lines using the one canonical splitter, so CRLF, CR and LF inputs all
 * yield identical line arrays.
 * @param content The document content to split.
 * @returns Returns the lines of the content.
 */
export function splitLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/);
}

/**
 * Holds one segment of a line diff: a run of lines that are common, added, or removed.
 */
interface DiffHunk {
  /**
   * Gets the lines in this segment.
   */
  value: string[];

  /**
   * Gets a value indicating whether this segment was added in the modified document.
   */
  added: boolean;

  /**
   * Gets a value indicating whether this segment was removed from the original document.
   */
  removed: boolean;
}

/**
 * Normalises a line diff by sliding each pure insertion or deletion as far up as the surrounding
 * identical context allows. When a line is inserted next to an identical line (for example a blank
 * line typed next to an existing blank line), the diff is free to attribute the change to either line;
 * sliding upward attributes it to the earliest position, which is the line the edit was made on. This
 * is purely an attribution change — the original and modified contents the hunks describe are
 * preserved, because a slide only swaps lines of equal value.
 * @param input The raw diff hunks.
 * @returns Returns the normalised hunks.
 */
function slideChangesUpward(input: ArrayChange<string>[]): DiffHunk[] {
  const hunks: DiffHunk[] = input.map(
    (hunk: ArrayChange<string>): DiffHunk => ({
      value: [...hunk.value],
      added: hunk.added === true,
      removed: hunk.removed === true,
    }),
  );

  for (let index: number = 0; index < hunks.length; index += 1) {
    const hunk: DiffHunk = hunks[index];
    if (!hunk.added && !hunk.removed) {
      continue;
    }
    const previous: DiffHunk | undefined = hunks[index - 1];
    let following: DiffHunk | undefined = hunks[index + 1];
    // Slide only a pure run that has common context before it and common (or no) context after it. A
    // run adjacent to the other change kind (an in-place modification) is left as the diff found it.
    while (
      previous !== undefined &&
      !previous.added &&
      !previous.removed &&
      previous.value.length > 0 &&
      (following === undefined || (!following.added && !following.removed)) &&
      previous.value[previous.value.length - 1] === hunk.value[hunk.value.length - 1]
    ) {
      if (following === undefined) {
        // The run is at the end of the document; create the trailing common context to slide into.
        following = { value: [], added: false, removed: false };
        hunks.splice(index + 1, 0, following);
      }
      const carried: string = previous.value.pop()!;
      const rotated: string = hunk.value.pop()!;
      hunk.value.unshift(carried);
      following.value.unshift(rotated);
    }
  }

  return hunks.filter((hunk: DiffHunk): boolean => hunk.value.length > 0);
}

/**
 * Computes the per-line changes of {@link modifiedLines} relative to {@link originalLines}. A removed
 * hunk immediately followed by an added hunk is treated as an in-place modification (marked by the
 * added lines); a removed hunk not followed by an addition is a pure deletion, anchored on the
 * surviving line above it.
 * @param originalLines The baseline lines to compare against.
 * @param modifiedLines The current lines being classified.
 * @returns Returns the changed lines and deletion anchors in modified-document coordinates.
 */
export function computeLineChanges(
  originalLines: readonly string[],
  modifiedLines: readonly string[],
): LineChangeSet {
  const changedLines: Set<number> = new Set<number>();
  const deletionAnchors: Set<number> = new Set<number>();

  const hunks: DiffHunk[] = slideChangesUpward(
    diffArrays(originalLines as string[], modifiedLines as string[]),
  );

  let currentLine: number = 0;
  let index: number = 0;

  for (const hunk of hunks) {
    if (hunk.added) {
      // New lines, also covering the additive half of an in-place modification.
      for (const [offset] of hunk.value.entries()) {
        changedLines.add(currentLine + offset + 1);
      }
      currentLine += hunk.value.length;
    } else if (hunk.removed) {
      // A removal followed by an addition is a modification already marked by the added branch; a
      // removal not followed by an addition is a pure deletion anchored on the line above.
      const next: DiffHunk | undefined = hunks[index + 1];
      if (next?.added !== true) {
        deletionAnchors.add(currentLine);
      }
    } else {
      currentLine += hunk.value.length;
    }
    index += 1;
  }

  return { changedLines, deletionAnchors };
}
