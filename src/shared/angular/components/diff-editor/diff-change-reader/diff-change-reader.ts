import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';

/**
 * The most lines a side of one change shows; the rest are counted rather than drawn, so a change of
 * thousands of lines does not build thousands of rows.
 */
export const MAX_READER_LINES: number = 200;

/**
 * The line ranges of one change, as Monaco reports them: a zero end line means that side has no lines
 * at all — a pure insertion has no original lines, a pure deletion no modified ones.
 */
export interface DiffChangeRange {
  /**
   * Gets the first original line.
   */
  readonly originalStartLineNumber: number;

  /**
   * Gets the last original line, or zero when no original lines changed.
   */
  readonly originalEndLineNumber: number;

  /**
   * Gets the first modified line.
   */
  readonly modifiedStartLineNumber: number;

  /**
   * Gets the last modified line, or zero when no modified lines changed.
   */
  readonly modifiedEndLineNumber: number;
}

/**
 * One line the reader shows: removed from the original, or added in the modified.
 */
export interface DiffReaderLine {
  /**
   * Gets whether the line was removed or added.
   */
  readonly kind: 'removed' | 'added';

  /**
   * Gets the line's number on its own side.
   */
  readonly number: number;

  /**
   * Gets the line's text.
   */
  readonly text: string;
}

/**
 * What the reader shows: one change of a diff, or — with a total of zero — that there is none.
 */
export interface DiffReaderView {
  /**
   * Gets the change's one-based position, or zero when the diff has no changes.
   */
  readonly index: number;

  /**
   * Gets how many changes the diff has.
   */
  readonly total: number;

  /**
   * Gets the change in plain words, as a screen reader announces it.
   */
  readonly label: string;

  /**
   * Gets the change's lines: the removed, then the added.
   */
  readonly lines: readonly DiffReaderLine[];

  /**
   * Gets how many lines were left out past {@link MAX_READER_LINES} on either side.
   */
  readonly hidden: number;
}

/**
 * Says a change in plain words (#1026): "Line 12 removed", "Lines 14–15 added", or both, joined.
 * @param change The change's line ranges.
 * @returns Returns the description.
 */
export function describeChange(change: DiffChangeRange): string {
  const parts: string[] = [];
  if (change.originalEndLineNumber > 0) {
    parts.push(span(change.originalStartLineNumber, change.originalEndLineNumber) + ' removed');
  }
  if (change.modifiedEndLineNumber > 0) {
    parts.push(span(change.modifiedStartLineNumber, change.modifiedEndLineNumber) + ' added');
  }
  if (parts.length === 0) {
    return 'No lines changed';
  }
  return parts
    .map((part: string, at: number): string =>
      at === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1),
    )
    .join(', ');
}

/**
 * Names a line range: "Line 12" or "Lines 14–15".
 * @param start The first line.
 * @param end The last line.
 * @returns Returns the name.
 */
function span(start: number, end: number): string {
  return start === end ? `Line ${start}` : `Lines ${start}–${end}`;
}

/**
 * Builds the reader's view of one change from the two sides' text.
 * @param change The change's line ranges.
 * @param index The change's one-based position.
 * @param total How many changes the diff has.
 * @param originalLine Reads an original line's text by number.
 * @param modifiedLine Reads a modified line's text by number.
 * @returns Returns the view.
 */
export function readerViewOf(
  change: DiffChangeRange,
  index: number,
  total: number,
  originalLine: (line: number) => string,
  modifiedLine: (line: number) => string,
): DiffReaderView {
  const lines: DiffReaderLine[] = [];
  let hidden: number = 0;
  const take: (
    kind: 'removed' | 'added',
    start: number,
    end: number,
    read: (line: number) => string,
  ) => void = (
    kind: 'removed' | 'added',
    start: number,
    end: number,
    read: (line: number) => string,
  ): void => {
    if (end <= 0) {
      return;
    }
    const last: number = Math.min(end, start + MAX_READER_LINES - 1);
    for (let line: number = start; line <= last; line++) {
      lines.push({ kind, number: line, text: read(line) });
    }
    hidden += end - last;
  };
  take('removed', change.originalStartLineNumber, change.originalEndLineNumber, originalLine);
  take('added', change.modifiedStartLineNumber, change.modifiedEndLineNumber, modifiedLine);
  return { index, total, label: describeChange(change), lines, hidden };
}

/**
 * Studio's accessible change reader for diffs (#1026): one change at a time — its position, its lines
 * removed and added with their numbers, and the change in plain words — stepped through with F7 and
 * ⇧F7, in place of the Monaco-drawn accessible diff viewer #1024 removed.
 *
 * Docked along the foot of the diff it reads, in the diff's own window. Keyboard-driven throughout:
 * F7 / ⇧F7 step (the owner moves both sides of the diff there), Esc closes and hands focus back to the
 * editor. Each change is announced through a polite live region, so a screen reader reads it on
 * arrival without the reader taking over.
 */
@Component({
  selector: 'app-diff-change-reader',
  imports: [Button],
  templateUrl: './diff-change-reader.html',
  styleUrl: './diff-change-reader.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'region',
    'aria-label': 'Change reader',
    tabindex: '-1',
    '(keydown)': 'onKeydown($event)',
  },
})
export class DiffChangeReader {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets what the reader shows.
   */
  public readonly view: InputSignal<DiffReaderView> = input.required<DiffReaderView>();

  /**
   * Emits when the next change is asked for (F7, or the Next button).
   */
  public readonly next: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when the previous change is asked for (⇧F7, or the Previous button).
   */
  public readonly previous: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when the reader is closed (Esc, or the Close button).
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the reader's element, focused when it opens so a screen reader lands in it.
   */
  private readonly host: ElementRef<HTMLElement> = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Moves keyboard focus into the reader.
   */
  public focus(): void {
    this.host.nativeElement.focus();
  }

  /**
   * Steps or closes from the keyboard: F7 forward, ⇧F7 back, Esc closes.
   * @param event The key press.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'F7') {
      event.preventDefault();
      if (event.shiftKey) {
        this.previous.emit();
      } else {
        this.next.emit();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
    }
  }
}
