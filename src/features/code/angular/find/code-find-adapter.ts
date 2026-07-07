import { signal, Signal, WritableSignal } from '@angular/core';
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
 * Tracks a single match: the decoration that keeps its position live across edits, the range it was
 * found at (used to restore it on undo), and, once replaced, a frozen display snapshot shown greyed.
 */
interface Entry {
  /**
   * Gets the Monaco decoration id highlighting this match, or the empty string once it is replaced.
   */
  decorationId: string;

  /**
   * Gets the range the match was originally found at, for restoring the highlight on undo.
   */
  readonly originalRange: MonacoApi.IRange;

  /**
   * Gets a value indicating whether the match has been replaced.
   */
  replaced: boolean;

  /**
   * Gets the display snapshot frozen when the match was replaced, or null while it is live.
   */
  frozen: FindResultItem | null;
}

/**
 * Records a replace so it can be undone: the entries it affected (to un-grey), the Monaco edit itself
 * having been pushed to the editor's own undo stack.
 */
interface UndoRecord {
  /**
   * Gets the indices of the entries replaced by this operation.
   */
  readonly indices: readonly number[];
}

/**
 * Drives find-and-replace over a Monaco code editor for the shared find panel. It computes the match
 * set through the model, keeps each match's position live with a decoration (so navigation and replace
 * stay correct as the text changes), renders a preview of each match's line, replaces through editor
 * edits, and undoes the last replace through the editor's own undo stack.
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
   * Holds whether the last replace can be undone.
   */
  private readonly canUndoState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the per-match tracking entries, parallel to the match list.
   */
  private entries: Entry[] = [];

  /**
   * Holds the undo history of replaces.
   */
  private undoStack: UndoRecord[] = [];

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
  public readonly canUndo: Signal<boolean> = this.canUndoState.asReadonly();

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
    this.disposeDecorations();
    this.entries = [];
    this.undoStack = [];
    this.canUndoState.set(false);
    this.activeIndexState.set(-1);
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (editor === null || model === null || query.text.length === 0) {
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
    const ids: string[] = editor.deltaDecorations(
      [],
      found.map(
        (match: MonacoApi.editor.FindMatch): MonacoApi.editor.IModelDeltaDecoration => ({
          range: match.range,
          options: { className: 'findMatch' },
        }),
      ),
    );
    this.entries = found.map(
      (match: MonacoApi.editor.FindMatch, index: number): Entry => ({
        decorationId: ids[index],
        originalRange: match.range,
        replaced: false,
        frozen: null,
      }),
    );
    this.rebuild(model);
  }

  /**
   * Selects and reveals the match at the given index.
   * @param index The zero-based index of the match to select.
   */
  public select(index: number): void {
    if (index < 0 || index >= this.entries.length) {
      return;
    }
    this.activeIndexState.set(index);
    const entry: Entry = this.entries[index];
    if (entry.replaced) {
      return;
    }
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (editor === null || model === null) {
      return;
    }
    const range: MonacoApi.IRange | null = model.getDecorationRange(entry.decorationId);
    if (range !== null) {
      editor.setSelection(range);
      editor.revealRangeInCenterIfOutsideViewport(range);
    }
  }

  /**
   * Selects the next match, stopping at the last.
   */
  public next(): void {
    if (this.entries.length === 0) {
      return;
    }
    const index: number = this.activeIndexState() + 1;
    if (index <= this.entries.length - 1) {
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
   * Replaces the active match, greys it, and advances to the next match.
   * @param replacement The text to replace the active match with.
   */
  public replace(replacement: string): void {
    const index: number = this.activeIndexState();
    if (index < 0 || index >= this.entries.length || this.entries[index].replaced) {
      return;
    }
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (editor === null || model === null) {
      return;
    }
    if (this.applyReplace(editor, model, [index], replacement)) {
      this.undoStack.push({ indices: [index] });
      this.canUndoState.set(true);
      this.rebuild(model);
      if (index + 1 <= this.entries.length - 1) {
        this.select(index + 1);
      }
    }
  }

  /**
   * Replaces every not-yet-replaced match.
   * @param replacement The text to replace each match with.
   */
  public replaceAll(replacement: string): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (editor === null || model === null) {
      return;
    }
    const indices: number[] = this.entries
      .map((entry: Entry, index: number): number => (entry.replaced ? -1 : index))
      .filter((index: number): boolean => index >= 0);
    if (indices.length === 0) {
      return;
    }
    if (this.applyReplace(editor, model, indices, replacement)) {
      this.undoStack.push({ indices });
      this.canUndoState.set(true);
      this.rebuild(model);
    }
  }

  /**
   * Undoes the most recent replace, restoring the text and un-greying its matches.
   */
  public undo(): void {
    const record: UndoRecord | undefined = this.undoStack.pop();
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (record === undefined || editor === null || model === null) {
      return;
    }
    editor.trigger('find-panel', 'undo', null);
    for (const index of record.indices) {
      const entry: Entry = this.entries[index];
      const ids: string[] = editor.deltaDecorations(
        [],
        [{ range: entry.originalRange, options: { className: 'findMatch' } }],
      );
      entry.decorationId = ids[0];
      entry.replaced = false;
      entry.frozen = null;
    }
    this.canUndoState.set(this.undoStack.length > 0);
    this.rebuild(model);
    this.select(record.indices[0]);
  }

  /**
   * Clears the active query and removes its highlights.
   */
  public clear(): void {
    this.disposeDecorations();
    this.entries = [];
    this.undoStack = [];
    this.canUndoState.set(false);
    this.activeIndexState.set(-1);
    this.matchesState.set([]);
  }

  /**
   * Applies a replacement to the given entries as a single undoable edit, greying them and freezing
   * their display.
   * @param editor The editor.
   * @param model The model.
   * @param indices The entries to replace.
   * @param replacement The replacement text.
   * @returns Returns true when the edit was applied.
   */
  private applyReplace(
    editor: MonacoApi.editor.IStandaloneCodeEditor,
    model: MonacoApi.editor.ITextModel,
    indices: readonly number[],
    replacement: string,
  ): boolean {
    const edits: MonacoApi.editor.IIdentifiedSingleEditOperation[] = [];
    for (const index of indices) {
      const entry: Entry = this.entries[index];
      const range: MonacoApi.IRange | null = model.getDecorationRange(entry.decorationId);
      if (range === null) {
        continue;
      }
      entry.frozen = { ...this.itemFromRange(model, range), replaced: true };
      edits.push({ range, text: replacement, forceMoveMarkers: true });
    }
    if (edits.length === 0) {
      return false;
    }
    editor.executeEdits('find-panel', edits);
    for (const index of indices) {
      const entry: Entry = this.entries[index];
      if (entry.decorationId.length > 0) {
        editor.deltaDecorations([entry.decorationId], []);
        entry.decorationId = '';
      }
      entry.replaced = true;
    }
    return true;
  }

  /**
   * Rebuilds the match list from the entries, reading live positions for un-replaced matches and the
   * frozen snapshot for replaced ones.
   * @param model The model to read line content from.
   */
  private rebuild(model: MonacoApi.editor.ITextModel): void {
    const items: FindResultItem[] = this.entries.map((entry: Entry): FindResultItem => {
      if (entry.replaced && entry.frozen !== null) {
        return entry.frozen;
      }
      const range: MonacoApi.IRange =
        model.getDecorationRange(entry.decorationId) ?? entry.originalRange;
      return this.itemFromRange(model, range);
    });
    this.matchesState.set(items);
  }

  /**
   * Builds a match item from a range: its position, matched text, and the surrounding line trimmed to
   * a preview length.
   * @param model The model to read from.
   * @param range The match range.
   * @returns Returns the match item (not replaced).
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
      replaced: false,
    };
  }

  /**
   * Removes every match decoration still on the editor.
   */
  private disposeDecorations(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf();
    if (editor === null) {
      return;
    }
    const ids: string[] = this.entries
      .map((entry: Entry): string => entry.decorationId)
      .filter((id: string): boolean => id.length > 0);
    if (ids.length > 0) {
      editor.deltaDecorations(ids, []);
    }
  }
}
