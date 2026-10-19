import type * as MonacoApi from 'monaco-editor';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Holds how long the caret, the text and the problems must stay still before the icon asks whether
 * fixes exist at the caret, so moving through a file or typing does not ask on every step.
 */
export const QUICK_FIX_INDICATOR_DELAY_MS: number = 250;

/**
 * Holds the CSS class the icon is drawn with, beside the icon set's own classes; see `_quick-fix.scss`.
 */
export const QUICK_FIX_GLYPH_CLASS: string = 'quick-fix-glyph';

/**
 * Holds Monaco's `GlyphMarginLane.Right`, written as its value for an editor whose window has no Monaco
 * to read it from. The icon has the glyph margin's right lane to itself, so it never shares a cell with
 * a breakpoint (the centre lane, Monaco's default) and a click on it is told apart from one on a
 * breakpoint.
 */
const RIGHT_LANE: MonacoApi.editor.GlyphMarginLane = 3;

/**
 * Holds Monaco's `MouseTargetType.GUTTER_GLYPH_MARGIN`, written as its value for the same reason.
 */
const GLYPH_MARGIN_TARGET: MonacoApi.editor.MouseTargetType = 2;

/**
 * Holds Monaco's `TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges`, written as its value.
 */
const NEVER_GROWS: MonacoApi.editor.TrackedRangeStickiness = 1;

/**
 * What the icon asks of the quick fixes behind it.
 */
export interface QuickFixIndicatorHooks {
  /**
   * Asks whether fixes exist at the editor's caret.
   * @returns Returns a promise resolving to true when they do.
   */
  hasFixes(): Promise<boolean>;

  /**
   * Opens the quick-fix menu at the caret, when the icon is clicked.
   */
  open(): void;

  /**
   * Determines whether fixes can be offered in the editor at all: it can be edited, and its language
   * offers code actions. The icon never shows where they cannot.
   * @returns Returns true when they can.
   */
  enabled(): boolean;

  /**
   * Subscribes to changes of the problems Monaco holds, by the models they changed in, or undefined
   * when the editor's window has no Monaco to subscribe to.
   */
  readonly onMarkersChanged?: (
    listener: (uris: readonly MonacoApi.Uri[]) => void,
  ) => MonacoApi.IDisposable;
}

/**
 * Draws Studio's fix icon in one Monaco editor (#1016): a lightbulb from Studio's icon set, in the
 * glyph margin beside the caret's line, while fixes exist at the caret. Clicking it opens the quick-fix
 * menu. Monaco's own lightbulb is off; this is a glyph-margin decoration of Studio's, in the margin's
 * right lane so it sits beside a breakpoint on the same line rather than over it.
 *
 * It asks whether fixes exist a moment after the caret, the text or the problems stop changing; an
 * answer to an older question is dropped. It hides as soon as the caret leaves its line or the text
 * changes, and never shows in an editor that cannot be edited.
 */
export class QuickFixIndicator {
  /**
   * Holds the editor the icon is drawn in.
   */
  private readonly editor: MonacoApi.editor.ICodeEditor;

  /**
   * Holds the Monaco instance the editor belongs to, or undefined when its window has none.
   */
  private readonly monaco: typeof MonacoApi | undefined;

  /**
   * Holds what the icon asks of the quick fixes behind it.
   */
  private readonly hooks: QuickFixIndicatorHooks;

  /**
   * Holds the subscriptions to the editor's and Monaco's events.
   */
  private readonly subscriptions: MonacoApi.IDisposable[] = [];

  /**
   * Holds the icon's decoration: one, on the caret's line, while it shows; none otherwise.
   */
  private readonly decorations: MonacoApi.editor.IEditorDecorationsCollection;

  /**
   * Holds the line the icon shows on, or null while it is hidden.
   */
  private line: number | null = null;

  /**
   * Holds the pending question's timer, or null when none is pending.
   */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether the primary button went down on the icon, so its release there opens the menu.
   */
  private armed: boolean = false;

  /**
   * Counts the questions asked, so an answer to an older one is recognised and dropped.
   */
  private generation: number = 0;

  /**
   * Holds whether the icon has been disposed.
   */
  private disposed: boolean = false;

  /**
   * Initializes a new instance of the {@link QuickFixIndicator} class, following the editor's caret,
   * text and problems, and the presses in its glyph margin.
   * @param editor The editor to draw the icon in.
   * @param monaco The Monaco instance the editor belongs to, or undefined when its window has none.
   * @param hooks What the icon asks of the quick fixes behind it.
   */
  public constructor(
    editor: MonacoApi.editor.ICodeEditor,
    monaco: typeof MonacoApi | undefined,
    hooks: QuickFixIndicatorHooks,
  ) {
    this.editor = editor;
    this.monaco = monaco;
    this.hooks = hooks;
    this.decorations = editor.createDecorationsCollection([]);
    this.subscriptions.push(
      editor.onDidChangeCursorPosition(
        (event: MonacoApi.editor.ICursorPositionChangedEvent): void => {
          if (this.line !== null && event.position.lineNumber !== this.line) {
            this.hide();
          }
          this.schedule();
        },
      ),
      editor.onDidChangeModelContent((): void => {
        this.hide();
        this.schedule();
      }),
      editor.onDidChangeModel((): void => {
        this.hide();
        this.schedule();
      }),
      editor.onDidChangeConfiguration((): void => {
        if (this.line !== null && !this.hooks.enabled()) {
          this.hide();
        }
      }),
      editor.onMouseDown((event: MonacoApi.editor.IEditorMouseEvent): void =>
        this.onMouseDown(event),
      ),
      editor.onMouseUp((event: MonacoApi.editor.IEditorMouseEvent): void => this.onMouseUp(event)),
    );
    if (hooks.onMarkersChanged !== undefined) {
      this.subscriptions.push(
        hooks.onMarkersChanged((uris: readonly MonacoApi.Uri[]): void => {
          const model: MonacoApi.editor.ITextModel | null = editor.getModel();
          const own: string | undefined = model?.uri.toString();
          if (uris.some((uri: MonacoApi.Uri): boolean => uri.toString() === own)) {
            this.schedule();
          }
        }),
      );
    }
  }

  /**
   * Gets whether the icon is showing, and on which line.
   * @returns Returns the line it shows on, or null while it is hidden.
   */
  public shownLine(): number | null {
    return this.line;
  }

  /**
   * Stops following the editor and takes the icon away.
   */
  public dispose(): void {
    this.disposed = true;
    this.generation += 1;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
    this.line = null;
    this.decorations.clear();
  }

  /**
   * Arms the icon when it is pressed with the primary button: a press in the glyph margin's right
   * lane, on the icon's line. Monaco leaves the caret where it is for a press in the margin. The menu
   * opens on release ({@link onMouseUp}), as a button does.
   * @param event The editor's mouse event.
   */
  private onMouseDown(event: MonacoApi.editor.IEditorMouseEvent): void {
    this.armed = event.event.leftButton && this.onIcon(event);
    if (this.armed) {
      event.event.preventDefault();
      event.event.stopPropagation();
    }
  }

  /**
   * Opens the menu when a press that began on the icon is released on it.
   *
   * ⛔ Opened only once the click has finished. The release is followed by a click, and a menu opened
   * on the press — or on the release itself — took that click, from outside it, as the user clicking
   * away, and closed the moment the button came up.
   * @param event The editor's mouse event.
   */
  private onMouseUp(event: MonacoApi.editor.IEditorMouseEvent): void {
    const armed: boolean = this.armed;
    this.armed = false;
    if (!armed || !this.onIcon(event)) {
      return;
    }
    setTimeout((): void => {
      if (!this.disposed && this.line !== null) {
        this.hooks.open();
      }
    });
  }

  /**
   * Determines whether a mouse event is on the icon: in the glyph margin's right lane, on its line.
   * @param event The editor's mouse event.
   * @returns Returns true when the event is on the icon.
   */
  private onIcon(event: MonacoApi.editor.IEditorMouseEvent): boolean {
    if (this.line === null) {
      return false;
    }
    // The lane is read only once the target is known to be in the glyph margin.
    const target: MonacoApi.editor.IMouseTargetMargin =
      event.target as MonacoApi.editor.IMouseTargetMargin;
    const glyphMargin: MonacoApi.editor.MouseTargetType =
      this.monaco?.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ?? GLYPH_MARGIN_TARGET;
    return (
      target.type === glyphMargin &&
      target.detail.glyphMarginLane === this.rightLane() &&
      target.position?.lineNumber === this.line
    );
  }

  /**
   * Asks whether fixes exist at the caret once things have stayed still for a moment, dropping any
   * question still waiting and any answer still to come.
   */
  private schedule(): void {
    this.generation += 1;
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout((): void => {
      this.timer = null;
      void this.ask();
    }, QUICK_FIX_INDICATOR_DELAY_MS);
  }

  /**
   * Asks whether fixes exist at the caret, and shows or hides the icon by the answer — unless a newer
   * question has been asked since.
   * @returns Returns a promise that resolves once the answer has been acted on.
   */
  private async ask(): Promise<void> {
    const generation: number = this.generation;
    const caret: MonacoApi.Position | null = this.editor.getPosition();
    if (this.disposed || caret === null || !this.hooks.enabled()) {
      this.hide();
      return;
    }
    let fixes: boolean;
    try {
      fixes = await this.hooks.hasFixes();
    } catch {
      fixes = false;
    }
    if (this.disposed || generation !== this.generation) {
      return;
    }
    if (fixes) {
      this.show(caret.lineNumber);
    } else {
      this.hide();
    }
  }

  /**
   * Shows the icon in the glyph margin beside a line.
   * @param line The one-based line.
   */
  private show(line: number): void {
    if (this.editor.getModel() === null) {
      return;
    }
    this.line = line;
    this.decorations.set([
      {
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: {
          glyphMarginClassName: `${Icon.QUICK_FIX.classList} ${QUICK_FIX_GLYPH_CLASS}`,
          glyphMargin: { position: this.rightLane() },
          stickiness:
            this.monaco?.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges ?? NEVER_GROWS,
        },
      },
    ]);
  }

  /**
   * Hides the icon.
   */
  private hide(): void {
    if (this.line === null) {
      return;
    }
    this.line = null;
    this.decorations.clear();
  }

  /**
   * Gets the glyph margin's right lane, the icon's own.
   * @returns Returns the lane.
   */
  private rightLane(): MonacoApi.editor.GlyphMarginLane {
    return this.monaco?.editor.GlyphMarginLane.Right ?? RIGHT_LANE;
  }
}
