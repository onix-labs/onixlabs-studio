import { signal, Signal, WritableSignal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { FindAdapter, FindQuery } from '@shared/angular/components/find-panel/find-adapter';

/**
 * Word-boundary separators passed to Monaco when a whole-word search is requested; a null separator
 * set disables the whole-word constraint.
 */
const WORD_SEPARATORS: string = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/? \t\n';

/**
 * Drives find-and-replace over a Monaco code editor for the shared find panel. It computes matches
 * through the model, highlights them with Monaco's own find-match decoration classes (so they read
 * exactly like the native widget's), navigates by moving and revealing the selection, and replaces
 * through editor edit operations. Reporting the reactive match totals the panel shows.
 */
export class CodeFindAdapter implements FindAdapter {
  /**
   * Holds the total number of matches for the active query.
   */
  private readonly matchCountState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the one-based index of the active match, or zero when none.
   */
  private readonly activeMatchState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the matches for the active query, in document order.
   */
  private matches: readonly MonacoApi.editor.FindMatch[] = [];

  /**
   * Holds the zero-based index of the active match, or -1 when none is active.
   */
  private activeIndex: number = -1;

  /**
   * Holds the most recent query, so matches can be recomputed after an edit.
   */
  private lastQuery: FindQuery | null = null;

  /**
   * Holds the decoration collection painting the match highlights, or null before one is created.
   */
  private decorations: MonacoApi.editor.IEditorDecorationsCollection | null = null;

  /**
   * Gets the total number of matches for the active query.
   */
  public readonly matchCount: Signal<number> = this.matchCountState.asReadonly();

  /**
   * Gets the one-based index of the active match, or zero when there is none.
   */
  public readonly activeMatch: Signal<number> = this.activeMatchState.asReadonly();

  /**
   * Initializes a new instance of the {@link CodeFindAdapter} class.
   * @param editorOf Resolves the current Monaco editor, or null before it is ready.
   */
  public constructor(
    private readonly editorOf: () => MonacoApi.editor.IStandaloneCodeEditor | null,
  ) {}

  /**
   * Applies a find query, highlighting its matches and refreshing the totals.
   * @param query The query to search for.
   */
  public setQuery(query: FindQuery): void {
    this.lastQuery = query;
    this.activeIndex = -1;
    this.recompute();
  }

  /**
   * Moves to and reveals the next match, wrapping past the end.
   */
  public next(): void {
    this.step(1);
  }

  /**
   * Moves to and reveals the previous match, wrapping before the start.
   */
  public previous(): void {
    this.step(-1);
  }

  /**
   * Replaces the active match with the replacement text, then advances to the next match.
   * @param replacement The text to replace the active match with.
   */
  public replace(replacement: string): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    if (editor === null || this.activeIndex < 0 || this.activeIndex >= this.matches.length) {
      return;
    }
    const range: MonacoApi.IRange = this.matches[this.activeIndex].range;
    editor.executeEdits('find-panel', [{ range, text: replacement, forceMoveMarkers: true }]);
    this.recompute();
  }

  /**
   * Replaces every match with the replacement text.
   * @param replacement The text to replace each match with.
   */
  public replaceAll(replacement: string): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    if (editor === null || this.matches.length === 0) {
      return;
    }
    const edits: MonacoApi.editor.IIdentifiedSingleEditOperation[] = this.matches.map(
      (match: MonacoApi.editor.FindMatch): MonacoApi.editor.IIdentifiedSingleEditOperation => ({
        range: match.range,
        text: replacement,
        forceMoveMarkers: true,
      }),
    );
    editor.executeEdits('find-panel', edits);
    this.activeIndex = -1;
    this.recompute();
  }

  /**
   * Clears the active query and removes its highlights.
   */
  public clear(): void {
    this.lastQuery = null;
    this.matches = [];
    this.activeIndex = -1;
    this.decorations?.clear();
    this.matchCountState.set(0);
    this.activeMatchState.set(0);
  }

  /**
   * Recomputes the match set for the active query and repaints the highlights.
   */
  private recompute(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    const query: FindQuery | null = this.lastQuery;
    if (editor === null || model === null || query === null || query.text.length === 0) {
      this.matches = [];
      this.decorations?.clear();
      this.matchCountState.set(0);
      this.activeMatchState.set(0);
      return;
    }
    this.matches = model.findMatches(
      query.text,
      false,
      query.regexp,
      query.caseSensitive,
      query.wholeWord ? WORD_SEPARATORS : null,
      false,
    );
    if (this.activeIndex >= this.matches.length) {
      this.activeIndex = this.matches.length - 1;
    }
    this.paint();
    this.matchCountState.set(this.matches.length);
    this.activeMatchState.set(this.activeIndex + 1);
  }

  /**
   * Advances the active match by the given signed step, wrapping at either end, and reveals it.
   * @param delta The number of matches to move by (1 forward, -1 back).
   */
  private step(delta: number): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    if (editor === null || this.matches.length === 0) {
      return;
    }
    const count: number = this.matches.length;
    this.activeIndex = (this.activeIndex + delta + count) % count;
    const range: MonacoApi.IRange = this.matches[this.activeIndex].range;
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
    this.paint();
    this.activeMatchState.set(this.activeIndex + 1);
  }

  /**
   * Repaints the match highlights, marking the active match with Monaco's current-match class.
   */
  private paint(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    if (editor === null) {
      return;
    }
    this.decorations ??= editor.createDecorationsCollection([]);
    this.decorations.set(
      this.matches.map(
        (
          match: MonacoApi.editor.FindMatch,
          index: number,
        ): MonacoApi.editor.IModelDeltaDecoration => ({
          range: match.range,
          options: {
            className: index === this.activeIndex ? 'currentFindMatch' : 'findMatch',
          },
        }),
      ),
    );
  }
}
