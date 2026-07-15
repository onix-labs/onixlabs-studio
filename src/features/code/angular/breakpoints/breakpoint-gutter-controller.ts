import type * as MonacoApi from 'monaco-editor';
import { Breakpoint } from '@shared/angular/services/debug/breakpoints';

/**
 * Identifies the CSS class drawing an ordinary breakpoint glyph.
 */
const BREAKPOINT_CLASS: string = 'breakpoint-glyph';

/**
 * Identifies the modifier class for a conditional breakpoint glyph.
 */
const CONDITIONAL_CLASS: string = 'breakpoint-glyph--conditional';

/**
 * Identifies the modifier class for a logpoint glyph.
 */
const LOGPOINT_CLASS: string = 'breakpoint-glyph--logpoint';

/**
 * Identifies the modifier class for a disabled breakpoint glyph.
 */
const DISABLED_CLASS: string = 'breakpoint-glyph--disabled';

/**
 * Identifies the modifier class for a breakpoint the adapter has verified (bound) in a live session.
 */
const VERIFIED_CLASS: string = 'breakpoint-glyph--verified';

/**
 * Draws breakpoint glyphs in one Monaco editor's glyph margin and turns clicks in that margin into
 * toggle and edit requests, the debug counterpart of the {@link
 * import('../change-margin/change-margin-controller').ChangeMarginController}.
 *
 * The controller is framework-agnostic and owns exactly one editor's glyph decorations and mouse
 * listener. It holds no breakpoint state of its own: the host pushes the file's breakpoints through
 * {@link render} whenever the model changes, and the controller reports gutter clicks back through the
 * toggle and edit callbacks, so the flow is unidirectional (store → render; click → callback → store →
 * render).
 */
export class BreakpointGutterController {
  /**
   * Holds the Monaco namespace used to construct ranges and read mouse-target types.
   */
  private readonly monaco: typeof MonacoApi;

  /**
   * Holds the editor whose glyph margin this controller draws.
   */
  private readonly editor: MonacoApi.editor.IStandaloneCodeEditor;

  /**
   * Reports a left-click in the glyph margin, toggling the breakpoint at the 1-based line.
   */
  private readonly onToggle: (line: number) => void;

  /**
   * Reports a request to edit the breakpoint at the 1-based line (a right-click or click on an existing
   * breakpoint's glyph), so the host can offer a condition/logpoint editor.
   */
  private readonly onEdit: (line: number) => void;

  /**
   * Holds the glyph decorations collection.
   */
  private readonly decorations: MonacoApi.editor.IEditorDecorationsCollection;

  /**
   * Holds the editor listeners disposed when this controller is torn down.
   */
  private readonly disposables: MonacoApi.IDisposable[] = [];

  /**
   * Holds the breakpoints currently drawn, so a click can tell whether a line already has one.
   */
  private current: readonly Breakpoint[] = [];

  /**
   * Initialises the controller and begins listening for glyph-margin clicks.
   * @param monaco The Monaco namespace.
   * @param editor The editor to draw breakpoint glyphs in.
   * @param onToggle Reports a toggle request for a line.
   * @param onEdit Reports an edit request for a line.
   */
  public constructor(
    monaco: typeof MonacoApi,
    editor: MonacoApi.editor.IStandaloneCodeEditor,
    onToggle: (line: number) => void,
    onEdit: (line: number) => void,
  ) {
    this.monaco = monaco;
    this.editor = editor;
    this.onToggle = onToggle;
    this.onEdit = onEdit;
    this.decorations = editor.createDecorationsCollection([]);
    this.disposables.push(
      editor.onMouseDown((event: MonacoApi.editor.IEditorMouseEvent): void =>
        this.onMouseDown(event),
      ),
    );
  }

  /**
   * Draws the given breakpoints as glyphs, replacing whatever was drawn before.
   * @param breakpoints The file's breakpoints.
   */
  public render(breakpoints: readonly Breakpoint[]): void {
    this.current = breakpoints;
    this.decorations.set(
      breakpoints.map((breakpoint: Breakpoint): MonacoApi.editor.IModelDeltaDecoration =>
        this.glyphDecoration(breakpoint),
      ),
    );
  }

  /**
   * Disposes the decorations and listeners.
   */
  public dispose(): void {
    this.decorations.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.current = [];
  }

  /**
   * Handles a mouse-down: a left-click in the glyph margin toggles the line's breakpoint (or edits it
   * when one already exists), and any click in the margin with the secondary button edits it.
   * @param event The editor mouse event.
   */
  private onMouseDown(event: MonacoApi.editor.IEditorMouseEvent): void {
    if (event.target.type !== this.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
      return;
    }
    const line: number | undefined = event.target.position?.lineNumber;
    if (line === undefined) {
      return;
    }
    const hasBreakpoint: boolean = this.current.some(
      (breakpoint: Breakpoint): boolean => breakpoint.line === line,
    );
    // The secondary (right) button edits; the primary button toggles, but edits an existing breakpoint
    // when the Alt modifier is held so a condition can be added without removing it first.
    if (event.event.rightButton || (hasBreakpoint && event.event.altKey)) {
      this.onEdit(line);
      return;
    }
    this.onToggle(line);
  }

  /**
   * Builds the glyph-margin decoration for a breakpoint, choosing the classes for its kind and state.
   * @param breakpoint The breakpoint to draw.
   * @returns Returns the decoration.
   */
  private glyphDecoration(breakpoint: Breakpoint): MonacoApi.editor.IModelDeltaDecoration {
    const classes: string[] = [BREAKPOINT_CLASS];
    if (!breakpoint.enabled) {
      classes.push(DISABLED_CLASS);
    } else if (breakpoint.logMessage !== undefined) {
      classes.push(LOGPOINT_CLASS);
    } else if (breakpoint.condition !== undefined) {
      classes.push(CONDITIONAL_CLASS);
    }
    if (breakpoint.verified) {
      classes.push(VERIFIED_CLASS);
    }
    return {
      range: new this.monaco.Range(breakpoint.line, 1, breakpoint.line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: classes.join(' '),
        glyphMarginHoverMessage: { value: hoverText(breakpoint) },
        stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    };
  }
}

/**
 * Builds the hover text describing a breakpoint's kind and condition.
 * @param breakpoint The breakpoint.
 * @returns Returns the hover text.
 */
function hoverText(breakpoint: Breakpoint): string {
  if (!breakpoint.enabled) {
    return 'Disabled breakpoint';
  }
  if (breakpoint.logMessage !== undefined) {
    return `Logpoint: ${breakpoint.logMessage}`;
  }
  if (breakpoint.condition !== undefined) {
    return `Conditional breakpoint: ${breakpoint.condition}`;
  }
  return 'Breakpoint';
}
