import type { TextEditorLineRange } from '@shared/angular/components/text-editor/text-editor';
import { computeLineChanges, splitLines } from './line-diff';

/**
 * Finds the runs of lines that are new or modified since a saved version, for formatting only those.
 * A run that only lost lines has nothing left to format.
 * @param saved The saved text.
 * @param current The current text.
 * @returns Returns the runs, last first.
 */
export function changedLineRanges(saved: string, current: string): readonly TextEditorLineRange[] {
  const lines: readonly number[] = [
    ...computeLineChanges(splitLines(saved), splitLines(current)).changedLines,
  ].sort((left: number, right: number): number => right - left);
  const ranges: TextEditorLineRange[] = [];
  for (const line of lines) {
    const latest: TextEditorLineRange | undefined = ranges.at(-1);
    if (latest?.first === line + 1) {
      ranges[ranges.length - 1] = { first: line, last: latest.last };
    } else {
      ranges.push({ first: line, last: line });
    }
  }
  return ranges;
}
