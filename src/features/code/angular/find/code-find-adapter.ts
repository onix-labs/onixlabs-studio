import { computed, signal, Signal, WritableSignal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import {
  FindAdapter,
  FindQuery,
  FindResultItem,
} from '@shared/angular/components/find-panel/find-adapter';

/**
 * Word-boundary separators passed to Monaco when a whole-word search is requested; a null separator
 * set disables the whole-word constraint.
 */
const WORD_SEPARATORS: string = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/? \t\n';

/**
 * Caps the length of each side of a match's line preview, so a long line does not bloat a row.
 */
const PREVIEW_SIDE: number = 40;

/**
 * Drives find-and-replace over a Monaco code editor for the shared find panel. It computes the match
 * set through the model, highlights every match, renders a preview of each match's line, and replaces
 * through editor edits. A replaced match no longer matches, so the list is recomputed after each
 * replace and the match drops out; undo restores the text (through the editor's own undo stack) and
 * the match reappears.
 */
export class CodeFindAdapter implements FindAdapter {
  /**
   * Holds the match list shown by the panel.
   */
  private readonly matchesState: WritableSignal<readonly FindResultItem[]> = signal<
    readonly FindResultItem[]
  >([]);

  /**
   * Holds the zero-based index of the active match, or -1 when none.
   */
  private readonly activeIndexState: WritableSignal<number> = signal<number>(-1);

  /**
   * Holds the number of replaces that can be undone.
   */
  private readonly undoDepthState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the current match ranges, parallel to the match list.
   */
  private ranges: readonly MonacoApi.IRange[] = [];

  /**
   * Holds the decoration collection highlighting the matches.
   */
  private decorations: MonacoApi.editor.IEditorDecorationsCollection | null = null;

  /**
   * Holds the most recent query, so the match set can be recomputed after an edit.
   */
  private lastQuery: FindQuery | null = null;

  /**
   * Gets the match list.
   */
  public readonly matches: Signal<readonly FindResultItem[]> = this.matchesState.asReadonly();

  /**
   * Gets the zero-based index of the active match, or -1 when there is none.
   */
  public readonly activeIndex: Signal<number> = this.activeIndexState.asReadonly();

  /**
   * Gets a value indicating that a Monaco editor supports replace.
   */
  public readonly supportsReplace: boolean = true;

  /**
   * Gets whether the last replace can be undone.
   */
  public readonly canUndo: Signal<boolean> = computed((): boolean => this.undoDepthState() > 0);

  /**
   * Initializes a new instance of the {@link CodeFindAdapter} class.
   * @param editorOf Resolves the current Monaco editor, or null before it is ready.
   */
  public constructor(
    private readonly editorOf: () => MonacoApi.editor.IStandaloneCodeEditor | null,
  ) {}

  /**
   * Applies a find query, rebuilding the match set and its highlights.
   * @param query The query to search for.
   */
  public setQuery(query: FindQuery): void {
    this.lastQuery = query;
    this.undoDepthState.set(0);
    this.activeIndexState.set(-1);
    this.recompute();
  }

  /**
   * Selects and reveals the match at the given index.
   * @param index The zero-based index of the match to select.
   */
  public select(index: number): void {
    if (index < 0 || index >= this.ranges.length) {
      return;
    }
    this.activeIndexState.set(index);
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    if (editor === null) {
      return;
    }
    const range: MonacoApi.IRange = this.ranges[index];
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
  }

  /**
   * Selects the next match, stopping at the last.
   */
  public next(): void {
    const index: number = this.activeIndexState() + 1;
    if (this.ranges.length > 0 && index <= this.ranges.length - 1) {
      this.select(index);
    }
  }

  /**
   * Selects the previous match, stopping at the first.
   */
  public previous(): void {
    const index: number = this.activeIndexState() - 1;
    if (index >= 0) {
      this.select(index);
    }
  }

  /**
   * Replaces the active match and drops it from the list, keeping the selection on the match that
   * takes its place.
   * @param replacement The text to replace the active match with.
   */
  public replace(replacement: string): void {
    const index: number = this.activeIndexState();
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    if (editor === null || index < 0 || index >= this.ranges.length) {
      return;
    }
    editor.executeEdits('find-panel', [
      { range: this.ranges[index], text: replacement, forceMoveMarkers: true },
    ]);
    this.undoDepthState.update((depth: number): number => depth + 1);
    this.recompute();
    if (this.ranges.length > 0) {
      this.select(Math.min(index, this.ranges.length - 1));
    } else {
      this.activeIndexState.set(-1);
    }
  }

  /**
   * Replaces every match; all replaced matches drop from the list.
   * @param replacement The text to replace each match with.
   */
  public replaceAll(replacement: string): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    if (editor === null || this.ranges.length === 0) {
      return;
    }
    editor.executeEdits(
      'find-panel',
      this.ranges.map(
        (range: MonacoApi.IRange): MonacoApi.editor.IIdentifiedSingleEditOperation => ({
          range,
          text: replacement,
          forceMoveMarkers: true,
        }),
      ),
    );
    this.undoDepthState.update((depth: number): number => depth + 1);
    this.activeIndexState.set(-1);
    this.recompute();
  }

  /**
   * Undoes the most recent replace, restoring the text so its match reappears.
   */
  public undo(): void {
    if (this.undoDepthState() === 0) {
      return;
    }
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    if (editor === null) {
      return;
    }
    editor.trigger('find-panel', 'undo', null);
    this.undoDepthState.update((depth: number): number => Math.max(0, depth - 1));
    this.recompute();
  }

  /**
   * Clears the active query and removes its highlights.
   */
  public clear(): void {
    this.lastQuery = null;
    this.ranges = [];
    this.undoDepthState.set(0);
    this.activeIndexState.set(-1);
    this.decorations?.clear();
    this.matchesState.set([]);
  }

  /**
   * Recomputes the match set from the current query and repaints the highlights.
   */
  private recompute(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    const query: FindQuery | null = this.lastQuery;
    if (editor === null || model === null || query === null || query.text.length === 0) {
      this.ranges = [];
      this.decorations?.clear();
      this.matchesState.set([]);
      return;
    }
    const found: MonacoApi.editor.FindMatch[] = model.findMatches(
      query.text,
      false,
      query.regexp,
      query.caseSensitive,
      query.wholeWord ? WORD_SEPARATORS : null,
      false,
    );
    this.ranges = found.map((match: MonacoApi.editor.FindMatch): MonacoApi.IRange => match.range);
    this.decorations ??= editor.createDecorationsCollection([]);
    this.decorations.set(
      this.ranges.map((range: MonacoApi.IRange): MonacoApi.editor.IModelDeltaDecoration => ({
        range,
        options: { className: 'findMatch' },
      })),
    );
    this.matchesState.set(
      this.ranges.map((range: MonacoApi.IRange): FindResultItem =>
        this.itemFromRange(model, range),
      ),
    );
  }

  /**
   * Builds a match item from a range: its position, matched text, and the surrounding line trimmed to
   * a preview length.
   * @param model The model to read from.
   * @param range The match range.
   * @returns Returns the match item.
   */
  private itemFromRange(
    model: MonacoApi.editor.ITextModel,
    range: MonacoApi.IRange,
  ): FindResultItem {
    const lineText: string = model.getLineContent(range.startLineNumber);
    const before: string = lineText.slice(
      Math.max(0, range.startColumn - 1 - PREVIEW_SIDE),
      range.startColumn - 1,
    );
    const after: string = lineText.slice(range.endColumn - 1, range.endColumn - 1 + PREVIEW_SIDE);
    const text: string = model.getValueInRange(range);
    return {
      line: range.startLineNumber,
      column: range.startColumn,
      before,
      text,
      after,
    };
  }
}
