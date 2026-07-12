import { InsertPlacement } from '@shared/api/ai-types';

/**
 * The result of resolving a string-anchored operation against a document: either the spliced ranges to
 * apply, or a model-facing reason the operation could not be resolved.
 */
export interface EditOutcome {
  /**
   * Gets a value indicating whether the operation resolved.
   */
  readonly ok: boolean;

  /**
   * Gets the resulting document text (unchanged when the operation did not resolve).
   */
  readonly text: string;

  /**
   * Gets the character range the edit touched, for range-based application: the start offset and the
   * replaced length in the ORIGINAL document, plus the replacement text. Absent for whole-document
   * operations (replace-all), which are applied as a full-text replacement.
   */
  readonly range?: { readonly start: number; readonly length: number; readonly insert: string };

  /**
   * Gets the model-facing detail: a confirmation for applied edits, or the reason the operation was
   * not applied (anchor missing or ambiguous), phrased so the model can recover.
   */
  readonly detail: string;
}

/**
 * Builds the failed outcome for an anchor that does not occur in the document.
 * @param source The unchanged document text.
 * @param label What the missing text was for ("old_string" or "anchor").
 * @returns Returns the failed outcome.
 */
function notFound(source: string, label: string): EditOutcome {
  return {
    ok: false,
    text: source,
    detail: `The ${label} was not found in the document. Read the document again and pass the text exactly as it appears, including whitespace and indentation.`,
  };
}

/**
 * Builds the failed outcome for an anchor that occurs more than once when a unique match is required.
 * @param source The unchanged document text.
 * @param label What the ambiguous text was for ("old_string" or "anchor").
 * @param count How many times it occurred.
 * @returns Returns the failed outcome.
 */
function ambiguous(source: string, label: string, count: number): EditOutcome {
  return {
    ok: false,
    text: source,
    detail: `The ${label} matches ${count} places in the document. Include more surrounding context so it matches exactly once.`,
  };
}

/**
 * Counts the non-overlapping occurrences of a needle in a document.
 * @param source The document text.
 * @param needle The text to count.
 * @returns Returns the occurrence count.
 */
function countOccurrences(source: string, needle: string): number {
  let count: number = 0;
  let index: number = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Resolves a string-anchored edit: replaces one exact occurrence of `oldString` (or every occurrence
 * when `replaceAll`) with `newString`. A single-occurrence edit carries the touched range so callers
 * can apply it as a granular, undoable range edit; a replace-all is applied whole-document.
 * @param source The current document text.
 * @param oldString The exact text to replace.
 * @param newString The replacement (empty deletes the matched text).
 * @param replaceAll Whether to replace every occurrence instead of requiring a unique match.
 * @returns Returns the {@link EditOutcome}.
 */
export function resolveEdit(
  source: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): EditOutcome {
  if (oldString.length === 0) {
    return { ok: false, text: source, detail: 'The old_string must not be empty.' };
  }
  if (oldString === newString) {
    return {
      ok: false,
      text: source,
      detail: 'The old_string and new_string are identical — there is nothing to change.',
    };
  }
  const count: number = countOccurrences(source, oldString);
  if (count === 0) {
    return notFound(source, 'old_string');
  }
  if (replaceAll) {
    return {
      ok: true,
      text: source.split(oldString).join(newString),
      detail: `Replaced ${count} occurrence${count === 1 ? '' : 's'}.`,
    };
  }
  if (count > 1) {
    return ambiguous(source, 'old_string', count);
  }
  const start: number = source.indexOf(oldString);
  return {
    ok: true,
    text: source.slice(0, start) + newString + source.slice(start + oldString.length),
    range: { start, length: oldString.length, insert: newString },
    detail: newString.length === 0 ? 'The matched text was deleted.' : 'The edit was applied.',
  };
}

/**
 * Resolves an insert: places `text` before or after a uniquely-matching anchor, or at the document's
 * start or end. Every insert carries its touched (zero-length) range for granular application.
 * @param source The current document text.
 * @param text The text to insert.
 * @param placement Where to insert.
 * @param anchor The anchor for before/after placements.
 * @returns Returns the {@link EditOutcome}.
 */
export function resolveInsert(
  source: string,
  text: string,
  placement: InsertPlacement,
  anchor?: string,
): EditOutcome {
  if (text.length === 0) {
    return { ok: false, text: source, detail: 'The text to insert must not be empty.' };
  }
  let start: number;
  if (placement === 'start') {
    start = 0;
  } else if (placement === 'end') {
    start = source.length;
  } else {
    if (anchor === undefined || anchor.length === 0) {
      return {
        ok: false,
        text: source,
        detail: `An anchor is required to insert ${placement} it. Pass the exact text to anchor on, or use placement "start" or "end".`,
      };
    }
    const count: number = countOccurrences(source, anchor);
    if (count === 0) {
      return notFound(source, 'anchor');
    }
    if (count > 1) {
      return ambiguous(source, 'anchor', count);
    }
    const index: number = source.indexOf(anchor);
    start = placement === 'before' ? index : index + anchor.length;
  }
  return {
    ok: true,
    text: source.slice(0, start) + text + source.slice(start),
    range: { start, length: 0, insert: text },
    detail: 'The text was inserted.',
  };
}
