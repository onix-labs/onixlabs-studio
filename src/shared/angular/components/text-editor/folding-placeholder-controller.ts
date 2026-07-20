import type * as MonacoApi from 'monaco-editor';

/**
 * The class Monaco tags the collapsed-region placeholder with, used to find which lines are currently
 * folded (Monaco has no public "which ranges are collapsed" query, but every collapsed range carries a
 * decoration with this `afterContentClassName`).
 */
const INLINE_FOLDED_CLASS: string = 'inline-folded';

/**
 * The placeholder class applied to every collapsed line (for shared styling), plus the per-kind class
 * whose `::after` supplies the text. Monaco renders injected `after` text unreliably in this build, so
 * the placeholder is drawn as an `afterContentClassName` `::after` (the mechanism Monaco's own folded
 * `⋯` uses) with the text provided by the stylesheet.
 */
const PLACEHOLDER_CLASS: string = 'fold-placeholder';
const ALLMAN_CLASS: string = 'fold-placeholder--allman';
const KNR_CLASS: string = 'fold-placeholder--knr';
const REGION_CLASS: string = 'fold-placeholder--region';

/**
 * Matches a region-marker line, so a collapsed region's placeholder is an ellipsis rather than a brace
 * (mirrors the folding provider's region detection).
 */
const REGION_MARKER: RegExp =
  /^\s*(?:#\s*(?:pragma\s+)?(?:end)?region\b|\/\/\s*#?\s*(?:end)?region\b|\/\/\s*<\/?editor-fold\b)/i;

/**
 * Matches a line whose content is (or begins as) a comment, so a collapsed comment's placeholder is an
 * ellipsis rather than a brace.
 */
const COMMENT_LINE: RegExp = /^\s*(?:\/\/|\/\*|\*)/;

/**
 * Chooses the per-kind placeholder variant class for a collapsed line from its text: {@link KNR_CLASS}
 * (`...}`) when the line already ends with an opening brace, {@link REGION_CLASS} (an ellipsis) for a
 * region or comment line, and {@link ALLMAN_CLASS} (` {...}`) otherwise (an Allman brace block, whose
 * `{` was folded away). The stylesheet supplies each class's `::after` text. Pure, so it is unit-tested
 * directly.
 * @param lineText The collapsed line's text.
 * @returns Returns the placeholder variant class name.
 */
export function foldPlaceholderClass(lineText: string): string {
  if (lineText.replace(/\s+$/, '').endsWith('{')) {
    return KNR_CLASS;
  }
  if (REGION_MARKER.test(lineText) || COMMENT_LINE.test(lineText)) {
    return REGION_CLASS;
  }
  return ALLMAN_CLASS;
}

/**
 * Draws Visual-Studio-style collapsed-region placeholders for one Monaco editor. Monaco renders a
 * single global placeholder glyph for every folded range regardless of what was folded; this controller
 * replaces it (the glyph is blanked in the stylesheet) with a per-fold placeholder injected as an
 * `after` decoration on each collapsed line:
 *  - a brace block folded from an Allman signature reads `signature {...}` (the brace was hidden);
 *  - a brace block folded from a K&R signature (the `{` on the signature line) reads `signature {...}`
 *    too, appending only `...}` since the `{` is still visible;
 *  - a `#region` or comment reads with a trailing ellipsis.
 * Clicking the placeholder (or anywhere past the collapsed line's text) expands the block, matching the
 * fold-control box.
 *
 * The controller is framework-agnostic and owns exactly one editor's placeholder decorations and
 * listeners. It refreshes on {@link MonacoApi.editor.IStandaloneCodeEditor.onDidChangeHiddenAreas},
 * which fires only when folds change — never in response to the controller's own decoration writes — so
 * there is no update loop.
 */
export class FoldingPlaceholderController {
  /**
   * Holds the Monaco namespace used to construct ranges.
   */
  private readonly monaco: typeof MonacoApi;

  /**
   * Holds the editor whose placeholders this controller draws.
   */
  private readonly editor: MonacoApi.editor.IStandaloneCodeEditor;

  /**
   * Holds the decorations collection the injected placeholders are written to.
   */
  private readonly decorations: MonacoApi.editor.IEditorDecorationsCollection;

  /**
   * Holds the editor listeners disposed when this controller is torn down.
   */
  private readonly disposables: MonacoApi.IDisposable[] = [];

  /**
   * Holds the lines currently showing a collapsed placeholder, so a click on one can expand it.
   */
  private collapsedLines: Set<number> = new Set<number>();

  /**
   * Initialises the controller and begins tracking the editor's folds.
   * @param monaco The Monaco namespace.
   * @param editor The editor to draw collapsed placeholders for.
   */
  public constructor(monaco: typeof MonacoApi, editor: MonacoApi.editor.IStandaloneCodeEditor) {
    this.monaco = monaco;
    this.editor = editor;
    this.decorations = editor.createDecorationsCollection([]);
    this.disposables.push(editor.onDidChangeHiddenAreas((): void => this.refresh()));
    this.disposables.push(editor.onDidChangeModel((): void => this.refresh()));
    this.disposables.push(
      editor.onMouseDown((event: MonacoApi.editor.IEditorMouseEvent): void =>
        this.onMouseDown(event),
      ),
    );
    this.refresh();
  }

  /**
   * Disposes the injected decorations and listeners.
   */
  public dispose(): void {
    this.decorations.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.collapsedLines = new Set<number>();
  }

  /**
   * Recomputes the collapsed placeholders from the editor's current folds and writes them.
   */
  private refresh(): void {
    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    if (model === null) {
      this.decorations.clear();
      this.collapsedLines = new Set<number>();
      return;
    }
    const collapsed: Set<number> = this.collapsedStartLines(model);
    const next: MonacoApi.editor.IModelDeltaDecoration[] = [];
    for (const line of collapsed) {
      next.push({
        range: new this.monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          afterContentClassName: `${PLACEHOLDER_CLASS} ${foldPlaceholderClass(model.getLineContent(line))}`,
        },
      });
    }
    this.collapsedLines = collapsed;
    this.decorations.set(next);
  }

  /**
   * Finds the start lines of the editor's currently collapsed folds, by the decoration Monaco tags each
   * collapsed range with.
   * @param model The editor's model.
   * @returns Returns the one-based collapsed start lines.
   */
  private collapsedStartLines(model: MonacoApi.editor.ITextModel): Set<number> {
    const lines: Set<number> = new Set<number>();
    for (const decoration of model.getAllDecorations()) {
      if (decoration.options.afterContentClassName === INLINE_FOLDED_CLASS) {
        lines.add(decoration.range.startLineNumber);
      }
    }
    return lines;
  }

  /**
   * Expands a collapsed block when its placeholder (or the empty space past the collapsed line's text)
   * is clicked, matching the fold-control box.
   * @param event The editor mouse-down event.
   */
  private onMouseDown(event: MonacoApi.editor.IEditorMouseEvent): void {
    const position: MonacoApi.Position | null = event.target.position;
    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    if (position === null || model === null || !this.collapsedLines.has(position.lineNumber)) {
      return;
    }
    if (position.column < model.getLineMaxColumn(position.lineNumber)) {
      return;
    }
    this.editor.setPosition({ lineNumber: position.lineNumber, column: 1 });
    void this.editor.getAction('editor.unfold')?.run();
  }
}
