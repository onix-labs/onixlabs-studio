import type * as MonacoApi from 'monaco-editor';
import { computeLineChanges, LineChangeSet, splitLines } from './line-diff';

/**
 * Holds the canvas colour the overview ruler draws the unsaved marks in, resolved from the theme's
 * change-margin tokens. The gutter bars themselves are coloured by CSS; the overview ruler is drawn on
 * a canvas that does not resolve CSS custom properties, so it needs a concrete colour string.
 */
export interface ChangeMarginColors {
  /**
   * Gets the colour for lines that differ from the saved content.
   */
  readonly unsaved: string;

  /**
   * Gets the colour for lines that are in sync with the saved content.
   */
  readonly saved: string;
}

/**
 * Holds the tuning options for a {@link ChangeMarginController}.
 */
export interface ChangeMarginOptions {
  /**
   * Gets the delay, in milliseconds, the diff is debounced by after a content change.
   */
  readonly debounceMs: number;

  /**
   * Gets the line count above which the diff is skipped and the margin cleared, guarding against jank
   * on very large files.
   */
  readonly maxLineCount: number;

  /**
   * Gets the overview-ruler colours for the change marks.
   */
  readonly colors: ChangeMarginColors;
}

/**
 * Holds the default change-margin options. The colours fall back to the light-theme token values; the
 * host resolves the active theme's colours and supplies them through {@link ChangeMarginController}.
 */
export const DEFAULT_CHANGE_MARGIN_OPTIONS: ChangeMarginOptions = {
  debounceMs: 200,
  maxLineCount: 20000,
  colors: { unsaved: '#d7a824', saved: '#2ea043' },
};

/**
 * Identifies the CSS class drawing the unsaved (yellow) gutter bar.
 */
const UNSAVED_CLASS: string = 'change-margin--unsaved';

/**
 * Identifies the CSS class drawing the saved (green) gutter bar.
 */
const SAVED_CLASS: string = 'change-margin--saved';

/**
 * Identifies the CSS class drawing the deletion (red) caret.
 */
const DELETED_CLASS: string = 'change-margin--deleted';

/**
 * Draws a Visual-Studio-style change margin for one Monaco editor, marking each line's save state: a
 * green bar on every line in sync with the saved content, a yellow bar on every line that differs from
 * it (new or modified), and a caret where lines were deleted. These are save-state semantics, not
 * version-control semantics; there is no VCS baseline.
 *
 * A document with no saved version yet (a new, never-saved file) has an empty baseline, so all of its
 * lines read as unsaved until it is first saved.
 *
 * The controller is framework-agnostic and owns exactly one editor's decorations, content listener and
 * debounce timer. The host drives the saved baseline through {@link setBaseline} on a successful save,
 * save-as or reload, because the controller cannot observe the application's save pipeline on its own.
 */
export class ChangeMarginController {
  /**
   * Holds the Monaco namespace used to construct ranges and reference the overview-ruler lane.
   */
  private readonly monaco: typeof MonacoApi;

  /**
   * Holds the editor whose change margin this controller draws.
   */
  private readonly editor: MonacoApi.editor.IStandaloneCodeEditor;

  /**
   * Holds the decorations collection the change marks are written to.
   */
  private readonly decorations: MonacoApi.editor.IEditorDecorationsCollection;

  /**
   * Holds the editor listeners disposed when this controller is torn down.
   */
  private readonly disposables: MonacoApi.IDisposable[] = [];

  /**
   * Holds the tuning options, with the overview-ruler colours kept current by {@link setColors}.
   */
  private options: ChangeMarginOptions;

  /**
   * Holds the saved content's lines, against which the current content is classified. Empty when the
   * document has no saved version yet, so every current line then reads as unsaved.
   */
  private baseline: readonly string[];

  /**
   * Holds the cooldown timer coalescing a burst of changes, or null when no burst is in progress.
   */
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether a change arrived mid-burst and still needs a trailing redraw once typing settles.
   */
  private trailingPending: boolean = false;

  /**
   * Initialises the controller, seeding the baseline from the saved content and beginning to track the
   * editor.
   * @param monaco The Monaco namespace.
   * @param editor The editor to draw the change margin for.
   * @param savedContent The document's last-saved content.
   * @param hasSavedVersion Whether the document has a saved version; when false the baseline is empty.
   * @param options The tuning options; defaults to {@link DEFAULT_CHANGE_MARGIN_OPTIONS}.
   */
  public constructor(
    monaco: typeof MonacoApi,
    editor: MonacoApi.editor.IStandaloneCodeEditor,
    savedContent: string,
    hasSavedVersion: boolean,
    options: ChangeMarginOptions = DEFAULT_CHANGE_MARGIN_OPTIONS,
  ) {
    this.monaco = monaco;
    this.editor = editor;
    this.options = options;
    this.decorations = editor.createDecorationsCollection([]);
    this.baseline = hasSavedVersion ? splitLines(savedContent) : [];

    this.disposables.push(editor.onDidChangeModelContent((): void => this.scheduleRefresh()));
    this.disposables.push(editor.onDidChangeModel((): void => this.refresh()));

    this.refresh();
  }

  /**
   * Sets the saved baseline, used on a successful save, save-as or reload from disk. An unsaved
   * document (no saved version) is given an empty baseline so all of its lines read as unsaved.
   * @param savedContent The document's last-saved content.
   * @param hasSavedVersion Whether the document has a saved version.
   */
  public setBaseline(savedContent: string, hasSavedVersion: boolean): void {
    this.baseline = hasSavedVersion ? splitLines(savedContent) : [];
    this.refresh();
  }

  /**
   * Updates the overview-ruler colours, used when the theme changes, and redraws.
   * @param colors The new overview-ruler colours.
   */
  public setColors(colors: ChangeMarginColors): void {
    this.options = { ...this.options, colors };
    this.refresh();
  }

  /**
   * Disposes the decorations, listeners and any pending debounce timer.
   */
  public dispose(): void {
    this.cancelScheduledRefresh();
    this.decorations.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  /**
   * Redraws on a content change with a leading edge: the first change of a burst redraws immediately
   * so the marks track the edit without a visible lag, and Monaco's transient downward shift of the
   * old marks when a line is inserted is never seen. Further changes during the burst are coalesced
   * into a single trailing redraw once typing settles.
   */
  private scheduleRefresh(): void {
    if (this.debounceHandle === null) {
      this.refresh();
    } else {
      clearTimeout(this.debounceHandle);
      this.trailingPending = true;
    }
    this.debounceHandle = setTimeout((): void => {
      this.debounceHandle = null;
      if (this.trailingPending) {
        this.trailingPending = false;
        this.refresh();
      }
    }, this.options.debounceMs);
  }

  /**
   * Cancels any pending redraw and clears the burst state.
   */
  private cancelScheduledRefresh(): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.trailingPending = false;
  }

  /**
   * Recomputes the change marks from the current content and writes them to the decorations
   * collection. Clears the margin when there is no model or the file exceeds the line-count guard.
   */
  private refresh(): void {
    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    if (model === null || model.getLineCount() > this.options.maxLineCount) {
      this.decorations.clear();
      return;
    }

    const current: readonly string[] = splitLines(model.getValue());
    const changes: LineChangeSet = computeLineChanges(this.baseline, current);

    const next: MonacoApi.editor.IModelDeltaDecoration[] = [];
    for (const [index] of current.entries()) {
      const line: number = index + 1;
      if (changes.changedLines.has(line)) {
        next.push(this.lineDecoration(line, UNSAVED_CLASS, this.options.colors.unsaved));
      } else {
        next.push(this.lineDecoration(line, SAVED_CLASS, null));
      }
    }
    for (const anchor of changes.deletionAnchors) {
      if (anchor >= 1) {
        next.push(this.deletionDecoration(anchor));
      }
    }

    this.decorations.set(next);
  }

  /**
   * Builds a whole-line gutter-bar decoration, adding an overview-ruler mark only when an overview
   * colour is given (unsaved lines), so the ruler highlights changes rather than every clean line.
   * @param line The 1-based line number.
   * @param className The gutter-bar CSS class.
   * @param overviewColor The overview-ruler colour, or null for no overview mark.
   * @returns Returns the decoration.
   */
  private lineDecoration(
    line: number,
    className: string,
    overviewColor: string | null,
  ): MonacoApi.editor.IModelDeltaDecoration {
    return {
      range: new this.monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: className,
        ...(overviewColor === null
          ? {}
          : {
              overviewRuler: {
                color: overviewColor,
                position: this.monaco.editor.OverviewRulerLane.Left,
              },
            }),
      },
    };
  }

  /**
   * Builds a whole-line deletion-caret decoration on the surviving line above a deletion.
   * @param line The 1-based surviving line number.
   * @returns Returns the decoration.
   */
  private deletionDecoration(line: number): MonacoApi.editor.IModelDeltaDecoration {
    return {
      range: new this.monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: DELETED_CLASS,
      },
    };
  }
}
