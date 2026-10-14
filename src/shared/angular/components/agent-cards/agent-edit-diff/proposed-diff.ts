import { structuredPatch, StructuredPatch, StructuredPatchHunk } from 'diff';

/**
 * Says what one line of a proposed change does.
 */
export type ProposedDiffLineKind = 'context' | 'add' | 'remove';

/**
 * Describes one line of a proposed change, with its number in the file before and after.
 */
export interface ProposedDiffLine {
  /**
   * Gets what the line does.
   */
  readonly kind: ProposedDiffLineKind;

  /**
   * Gets the line's text, without its line ending.
   */
  readonly text: string;

  /**
   * Gets the line's number in the file as it is, or null for an added line.
   */
  readonly oldLine: number | null;

  /**
   * Gets the line's number in the file as it would be, or null for a removed line.
   */
  readonly newLine: number | null;
}

/**
 * Describes one run of changed lines and the unchanged lines around it.
 */
export interface ProposedDiffHunk {
  /**
   * Gets the hunk's lines, in order.
   */
  readonly lines: readonly ProposedDiffLine[];
}

/**
 * Describes a change an agent proposes to a file, as the approval card shows it (#891): computed once,
 * when the request arrives, so a conversation reopened later shows what was asked rather than a diff
 * against whatever the file has since become.
 */
export interface ProposedDiff {
  /**
   * Gets the file the change is to.
   */
  readonly path: string;

  /**
   * Gets a value indicating whether the file does not exist yet.
   */
  readonly newFile: boolean;

  /**
   * Gets how many lines the change adds.
   */
  readonly additions: number;

  /**
   * Gets how many lines the change removes.
   */
  readonly deletions: number;

  /**
   * Gets the change's hunks, with a few unchanged lines of context around each.
   */
  readonly hunks: readonly ProposedDiffHunk[];

  /**
   * Gets a value indicating whether lines were left out because the change was too long to show.
   */
  readonly truncated: boolean;

  /**
   * Gets a value indicating whether only the replaced text is shown, not the file: the edit's text was
   * not found in the file as it is now, so where it lands cannot be said, and lines are not numbered.
   */
  readonly fragmentsOnly?: boolean;
}

/**
 * The unchanged lines shown either side of a change, as a code review shows them.
 */
const CONTEXT_LINES: number = 3;

/**
 * The most lines a card shows, past which the rest is left out and said to be: a whole-file write of a
 * generated file should not put thousands of lines into a conversation.
 */
const MAX_LINES: number = 400;

/**
 * Computes the diff an approval card shows for a proposed change.
 * @param path The file the change is to.
 * @param original The file's text as it is, or null when it does not exist yet.
 * @param modified The file's text as the change would leave it.
 * @returns Returns the diff.
 */
export function proposedDiff(
  path: string,
  original: string | null,
  modified: string,
): ProposedDiff {
  const patch: StructuredPatch = structuredPatch(path, path, original ?? '', modified, '', '', {
    context: CONTEXT_LINES,
  });
  let additions: number = 0;
  let deletions: number = 0;
  let shown: number = 0;
  let truncated: boolean = false;
  const hunks: ProposedDiffHunk[] = [];
  for (const hunk of patch.hunks) {
    const lines: ProposedDiffLine[] = linesOf(hunk);
    additions += lines.filter((line: ProposedDiffLine): boolean => line.kind === 'add').length;
    deletions += lines.filter((line: ProposedDiffLine): boolean => line.kind === 'remove').length;
    if (truncated) {
      continue;
    }
    const room: number = MAX_LINES - shown;
    if (lines.length > room) {
      truncated = true;
      if (room > 0) {
        hunks.push({ lines: lines.slice(0, room) });
      }
      shown = MAX_LINES;
      continue;
    }
    hunks.push({ lines });
    shown += lines.length;
  }
  return { path, newFile: original === null, additions, deletions, hunks, truncated };
}

/**
 * Reads a hunk's lines, numbering each in the file before and after.
 * @param hunk The hunk.
 * @returns Returns the lines.
 */
function linesOf(hunk: StructuredPatchHunk): ProposedDiffLine[] {
  let oldLine: number = hunk.oldStart;
  let newLine: number = hunk.newStart;
  const lines: ProposedDiffLine[] = [];
  for (const raw of hunk.lines) {
    // jsdiff marks a missing final newline with a line of its own; it is not a line of the file.
    if (raw.startsWith('\\')) {
      continue;
    }
    const text: string = raw.slice(1);
    if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text, oldLine: null, newLine: newLine++ });
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'remove', text, oldLine: oldLine++, newLine: null });
    } else {
      lines.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return lines;
}

/**
 * Computes the diff of an edit whose text is not in the file as it is: the text it replaces against
 * what it puts in its place, unnumbered, since where in the file it would land cannot be said.
 * @param path The file the edit is to.
 * @param replacements The edit's replacements.
 * @returns Returns the diff.
 */
export function fragmentDiff(
  path: string,
  replacements: readonly ProposedReplacement[],
): ProposedDiff {
  const diff: ProposedDiff = proposedDiff(
    path,
    replacements.map((replacement: ProposedReplacement): string => replacement.oldText).join('\n'),
    replacements.map((replacement: ProposedReplacement): string => replacement.newText).join('\n'),
  );
  return { ...diff, fragmentsOnly: true };
}

/**
 * Describes one replacement an edit proposes: the text it finds and what it puts in its place.
 */
export interface ProposedReplacement {
  /**
   * Gets the text to find.
   */
  readonly oldText: string;

  /**
   * Gets the text to put in its place.
   */
  readonly newText: string;

  /**
   * Gets a value indicating whether every occurrence is replaced, rather than the first.
   */
  readonly replaceAll?: boolean;
}

/**
 * Applies an edit's replacements to a file's text, in order, as the agent's own edit tool would.
 * @param original The file's text as it is.
 * @param replacements The replacements, in order.
 * @returns Returns the text the edit would leave, or null when a replacement's text is not in the file,
 * so the edit cannot be shown as it would land.
 */
export function applyReplacements(
  original: string,
  replacements: readonly ProposedReplacement[],
): string | null {
  let text: string = original;
  for (const replacement of replacements) {
    if (replacement.oldText.length === 0) {
      // An empty search is how an edit tool creates a file's whole content.
      text = replacement.newText;
      continue;
    }
    if (!text.includes(replacement.oldText)) {
      return null;
    }
    text = replacement.replaceAll
      ? text.split(replacement.oldText).join(replacement.newText)
      : text.replace(replacement.oldText, (): string => replacement.newText);
  }
  return text;
}
