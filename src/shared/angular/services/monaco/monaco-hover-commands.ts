import type * as MonacoApi from 'monaco-editor';
import { FIND_PASSTHROUGH_CONTEXT_KEY, focusedEditor } from './monaco-find-commands';

/**
 * Names Monaco's Show Hover action (#1020), which opens Monaco's hover widget at the caret. Its chord
 * (⌘K ⌘I / Ctrl+K Ctrl+I) is removed, on every platform; Studio's Show Hover takes it instead.
 */
export const MONACO_SHOW_HOVER_COMMAND: string = 'editor.action.showHover';

/**
 * Lists Monaco's problem navigation actions (#1020): next and previous problem in the file (⌥F8 /
 * ⇧⌥F8) and across files (F8 / ⇧F8). Each opens Monaco's "View Problem" peek under the problem; each
 * has all of its chords removed, on every platform. Studio's Next and Previous Problem take them.
 */
export const MONACO_MARKER_COMMANDS: readonly string[] = [
  'editor.action.marker.next',
  'editor.action.marker.prev',
  'editor.action.marker.nextInFiles',
  'editor.action.marker.prevInFiles',
];

/**
 * Names Studio's Show Hover command, bound to ⌘K ⌘I (Ctrl+K Ctrl+I) in every editor.
 */
export const STUDIO_SHOW_HOVER_COMMAND: string = 'studio.showHover';

/**
 * Names Studio's Next Problem command, bound to F8 (and ⌥F8) in every editor.
 */
export const STUDIO_NEXT_PROBLEM_COMMAND: string = 'studio.nextProblem';

/**
 * Names Studio's Previous Problem command, bound to ⇧F8 (and ⇧⌥F8) in every editor.
 */
export const STUDIO_PREVIOUS_PROBLEM_COMMAND: string = 'studio.previousProblem';

/**
 * Names the editor contribution behind Monaco's hover over the text: it follows the pointer and the
 * keyboard and builds Monaco's hover widget, lazily, the first time it would show.
 */
export const CONTENT_HOVER_CONTRIBUTION: string = 'editor.contrib.contentHover';

/**
 * Names the editor contribution behind Monaco's hover over the gutter (a breakpoint's description).
 */
export const GLYPH_HOVER_CONTRIBUTION: string = 'editor.contrib.marginHover';

/**
 * Names the editor contribution behind Monaco's problem navigation: F8 and the "View Problem" link of
 * Monaco's hover both end in it, and it builds Monaco's problem peek.
 */
export const MARKER_CONTRIBUTION: string = 'editor.contrib.markerController';

/**
 * Lists the private members of Monaco's hover contribution the takeover replaces (#1020). A spec reads
 * Monaco's bundle for each, so an upgrade that renames one fails the build rather than bringing
 * Monaco's hover back.
 */
export const CONTENT_HOVER_HOOKS: readonly string[] = [
  '_getOrCreateContentWidget',
  '_onEditorMouseMove',
  '_reactToEditorMouseMove',
  'showContentHover',
];

/**
 * Lists the private members of Monaco's gutter hover contribution the takeover replaces.
 */
export const GLYPH_HOVER_HOOKS: readonly string[] = [
  '_getOrCreateGlyphWidget',
  '_onEditorMouseMove',
  '_reactToEditorMouseMove',
  '_tryShowHoverWidget',
];

/**
 * Lists the members of Monaco's problem navigation contribution the takeover replaces.
 */
export const MARKER_HOOKS: readonly string[] = ['navigate', 'showAtMarker', '_getOrCreateModel'];

/**
 * Holds the editor options that keep Monaco's hover off in every editor (#1020), as a second line
 * behind the takeover: with it off, Monaco's contributions never try to show a hover on their own.
 * Applied to every editor as it is created, and to the options every editor is created with.
 */
export const HOVER_EDITOR_OPTIONS: MonacoApi.editor.IEditorOptions = {
  hover: { enabled: 'off' },
};

/**
 * Names which way Studio's problem navigation goes.
 */
export type ProblemDirection = 'next' | 'previous';

/**
 * What the takeover hands to Studio.
 */
export interface HoverCommandHandlers {
  /**
   * Shows Studio's hover card in an editor: at a position, or at the caret when none is given.
   * @param editor The editor.
   * @param position The one-based position, or undefined for the caret.
   */
  showHover(editor: MonacoApi.editor.ICodeEditor, position?: MonacoApi.IPosition): void;

  /**
   * Moves an editor's caret to its next or previous problem and shows the problem's card.
   * @param editor The editor.
   * @param direction Which way to go.
   */
  goToProblem(editor: MonacoApi.editor.ICodeEditor, direction: ProblemDirection): void;

  /**
   * Shows the card of one problem in an editor, with the caret moved to it.
   * @param editor The editor.
   * @param problem The problem's span, one-based.
   */
  showProblem(editor: MonacoApi.editor.ICodeEditor, problem: MonacoApi.IRange): void;
}

/**
 * The part of Monaco's hover contribution Studio replaces.
 */
interface ContentHoverContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Gets the editor the contribution belongs to.
   */
  readonly _editor?: MonacoApi.editor.ICodeEditor;

  /**
   * Gets Monaco's hover widget, once it has been built.
   */
  readonly _contentWidget?: unknown;

  /**
   * Builds Monaco's hover widget, the first time it is wanted, and returns it.
   */
  _getOrCreateContentWidget?: () => unknown;

  /**
   * Follows the pointer over the editor.
   */
  _onEditorMouseMove?: (event: unknown) => void;

  /**
   * Shows or hides Monaco's hover for where the pointer rests.
   */
  _reactToEditorMouseMove?: (event: unknown) => void;

  /**
   * Shows Monaco's hover over a span — what Show Hover, the colour picker and the definition preview
   * run.
   */
  showContentHover?: (
    range: MonacoApi.IRange,
    mode: number,
    source: number,
    focus: boolean,
  ) => void;
}

/**
 * The part of Monaco's gutter hover contribution Studio replaces.
 */
interface GlyphHoverContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Gets Monaco's gutter hover widget, once it has been built.
   */
  readonly _glyphWidget?: unknown;

  /**
   * Builds Monaco's gutter hover widget, the first time it is wanted, and returns it.
   */
  _getOrCreateGlyphWidget?: () => unknown;

  /**
   * Follows the pointer over the editor.
   */
  _onEditorMouseMove?: (event: unknown) => void;

  /**
   * Shows or hides Monaco's gutter hover for where the pointer rests.
   */
  _reactToEditorMouseMove?: (event: unknown) => void;

  /**
   * Shows Monaco's gutter hover for a pointer event, returning whether it shows.
   */
  _tryShowHoverWidget?: (event: unknown) => boolean;
}

/**
 * The part of Monaco's problem navigation contribution Studio replaces.
 */
interface MarkerContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Gets the editor the contribution belongs to.
   */
  readonly _editor?: MonacoApi.editor.ICodeEditor;

  /**
   * Gets Monaco's problem peek, once it has been built.
   */
  readonly _widget?: unknown;

  /**
   * Goes to the next or previous problem and opens Monaco's peek under it.
   */
  navigate?: (next: boolean, multiFile: boolean) => Promise<void>;

  /**
   * Opens Monaco's peek under one problem — what the "View Problem" link of Monaco's hover runs.
   */
  showAtMarker?: (marker: MonacoApi.IRange) => void;

  /**
   * Builds Monaco's peek with the problems of a model.
   */
  _getOrCreateModel?: (uri: unknown) => unknown;
}

/**
 * Stands in for Monaco's hover widgets wherever Monaco's own code still asks for one: it never shows,
 * is never visible or focused, and builds no DOM.
 */
const INERT_HOVER_WIDGET: Readonly<Record<string, unknown>> = Object.freeze({
  isVisible: false,
  isFocused: false,
  isResizing: false,
  isColorPickerVisible: false,
  isVisibleFromKeyboard: false,
  widget: Object.freeze({ isResizing: false }),
  showsOrWillShow: (): boolean => false,
  startShowingAtRange: (): void => undefined,
  hide: (): void => undefined,
  focus: (): void => undefined,
  focusedHoverPartIndex: (): number => -1,
  updateHoverVerbosityLevel: (): void => undefined,
  containsNode: (): boolean => false,
  onContentsChanged: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
  dispose: (): void => undefined,
});

/**
 * Removes Monaco's Show Hover chord and its problem navigation chords from a Monaco instance and binds
 * Studio's in their place (#1020): Show Hover on ⌘K ⌘I (Ctrl+K Ctrl+I), Next Problem on F8 and ⌥F8,
 * Previous Problem on ⇧F8 and ⇧⌥F8. Then makes sure Monaco's hover, its gutter hover and its problem
 * peek can never be built in any editor the instance creates — each contribution's ways into its
 * widget are replaced, once for the instance, on its class — and turns Monaco's hover off in each
 * editor as a second line. Each instance (the main window's, and each child window's) has its own
 * keybinding service and its own classes, so each is prepared once, as it loads.
 *
 * A markdown code fence sets the find passthrough context key, and the chords pass through it as the
 * find, go-to and navigation chords do: a fence is a few lines inside a document.
 * @param monaco The Monaco instance.
 * @param handlers Receive the editor when Studio's commands, or any route into Monaco's hover or
 * problem peek, run.
 */
export function installHoverCommands(
  monaco: typeof MonacoApi,
  handlers: HoverCommandHandlers,
): void {
  const focused: (run: (editor: MonacoApi.editor.ICodeEditor) => void) => () => void =
    (run: (editor: MonacoApi.editor.ICodeEditor) => void): (() => void) =>
    (): void => {
      const editor: MonacoApi.editor.ICodeEditor | undefined = focusedEditor(monaco);
      if (editor !== undefined) {
        run(editor);
      }
    };
  monaco.editor.registerCommand(
    STUDIO_SHOW_HOVER_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void => handlers.showHover(editor)),
  );
  monaco.editor.registerCommand(
    STUDIO_NEXT_PROBLEM_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void => handlers.goToProblem(editor, 'next')),
  );
  monaco.editor.registerCommand(
    STUDIO_PREVIOUS_PROBLEM_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void =>
      handlers.goToProblem(editor, 'previous'),
    ),
  );
  const when: string = `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`;
  monaco.editor.addKeybindingRules([
    // A removal with no chord drops every chord the command has, whichever platform Monaco runs on.
    { keybinding: 0, command: `-${MONACO_SHOW_HOVER_COMMAND}` },
    ...MONACO_MARKER_COMMANDS.map((command: string): MonacoApi.editor.IKeybindingRule => ({
      keybinding: 0,
      command: `-${command}`,
    })),
    {
      // ⌘ on macOS and Ctrl elsewhere: Monaco reads CtrlCmd per platform.
      keybinding: monaco.KeyMod.chord(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI,
      ),
      command: STUDIO_SHOW_HOVER_COMMAND,
      when,
    },
    { keybinding: monaco.KeyCode.F8, command: STUDIO_NEXT_PROBLEM_COMMAND, when },
    {
      keybinding: monaco.KeyMod.Alt | monaco.KeyCode.F8,
      command: STUDIO_NEXT_PROBLEM_COMMAND,
      when,
    },
    {
      keybinding: monaco.KeyMod.Shift | monaco.KeyCode.F8,
      command: STUDIO_PREVIOUS_PROBLEM_COMMAND,
      when,
    },
    {
      keybinding: monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.F8,
      command: STUDIO_PREVIOUS_PROBLEM_COMMAND,
      when,
    },
  ]);
  let hover: boolean = false;
  let glyph: boolean = false;
  let markers: boolean = false;
  monaco.editor.onDidCreateEditor((editor: MonacoApi.editor.ICodeEditor): void => {
    editor.updateOptions(HOVER_EDITOR_OPTIONS);
    hover ||= takeOverContentHover(editor, handlers);
    glyph ||= takeOverGlyphHover(editor);
    markers ||= takeOverMarkerNavigation(editor, handlers);
  });
}

/**
 * Replaces the ways Monaco's hover contribution builds and shows its widget, on its class, so every
 * editor of the instance — those made before and after — never builds Monaco's hover. Following the
 * pointer does nothing (Studio's hover card follows it instead), the widget it would build is an inert
 * stand-in, and a request to show it over a span — Show Hover run some other way, the colour picker,
 * the definition preview — shows Studio's card there instead.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @param handlers Receive the editor a hover was asked of.
 * @returns Returns true when the class was reached and its ways in replaced.
 */
export function takeOverContentHover(
  editor: MonacoApi.editor.ICodeEditor,
  handlers: Pick<HoverCommandHandlers, 'showHover'>,
): boolean {
  // ⛔ Reaching the contribution makes it if it was not yet made, but the hover controller builds its
  // widget lazily — only `_getOrCreateContentWidget` builds DOM — so nothing is added to the page.
  const contribution: ContentHoverContribution | null =
    editor.getContribution<ContentHoverContribution>(CONTENT_HOVER_CONTRIBUTION);
  const prototype: ContentHoverContribution | null =
    contribution === null
      ? null
      : (Object.getPrototypeOf(contribution) as ContentHoverContribution);
  if (
    prototype === null ||
    CONTENT_HOVER_HOOKS.some(
      (hook: string): boolean =>
        typeof (prototype as unknown as Record<string, unknown>)[hook] !== 'function',
    )
  ) {
    return false;
  }
  prototype._getOrCreateContentWidget = (): unknown => INERT_HOVER_WIDGET;
  prototype._onEditorMouseMove = (): void => undefined;
  prototype._reactToEditorMouseMove = (): void => undefined;
  prototype.showContentHover = function (
    this: ContentHoverContribution,
    range: MonacoApi.IRange,
  ): void {
    handlers.showHover(this._editor ?? editor, {
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
  };
  return true;
}

/**
 * Replaces the ways Monaco's gutter hover contribution builds and shows its widget, on its class, so
 * no editor of the instance ever builds Monaco's gutter hover: Studio's hover card shows a gutter
 * decoration's description instead.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @returns Returns true when the class was reached and its ways in replaced.
 */
export function takeOverGlyphHover(editor: MonacoApi.editor.ICodeEditor): boolean {
  const contribution: GlyphHoverContribution | null =
    editor.getContribution<GlyphHoverContribution>(GLYPH_HOVER_CONTRIBUTION);
  const prototype: GlyphHoverContribution | null =
    contribution === null ? null : (Object.getPrototypeOf(contribution) as GlyphHoverContribution);
  if (
    prototype === null ||
    GLYPH_HOVER_HOOKS.some(
      (hook: string): boolean =>
        typeof (prototype as unknown as Record<string, unknown>)[hook] !== 'function',
    )
  ) {
    return false;
  }
  prototype._getOrCreateGlyphWidget = (): unknown => INERT_HOVER_WIDGET;
  prototype._onEditorMouseMove = (): void => undefined;
  prototype._reactToEditorMouseMove = (): void => undefined;
  prototype._tryShowHoverWidget = (): boolean => false;
  return true;
}

/**
 * Replaces the ways Monaco's problem navigation contribution opens its peek, on its class, so no
 * editor of the instance ever builds Monaco's problem peek: going to the next or previous problem runs
 * Studio's, which moves the caret and shows the problem's card, and showing one problem (the "View
 * Problem" link) shows that problem's card. The peek's builder is replaced too, so nothing left can
 * build it.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @param handlers Receive the editor and the problem.
 * @returns Returns true when the class was reached and its ways in replaced.
 */
export function takeOverMarkerNavigation(
  editor: MonacoApi.editor.ICodeEditor,
  handlers: Pick<HoverCommandHandlers, 'goToProblem' | 'showProblem'>,
): boolean {
  // The contribution is made lazily, on first reach; making it builds nothing (its peek is built only
  // by `_getOrCreateModel`, which the takeover replaces).
  const contribution: MarkerContribution | null =
    editor.getContribution<MarkerContribution>(MARKER_CONTRIBUTION);
  const prototype: MarkerContribution | null =
    contribution === null ? null : (Object.getPrototypeOf(contribution) as MarkerContribution);
  if (
    prototype === null ||
    MARKER_HOOKS.some(
      (hook: string): boolean =>
        typeof (prototype as unknown as Record<string, unknown>)[hook] !== 'function',
    )
  ) {
    return false;
  }
  prototype.navigate = function (this: MarkerContribution, next: boolean): Promise<void> {
    handlers.goToProblem(this._editor ?? editor, next ? 'next' : 'previous');
    return Promise.resolve();
  };
  prototype.showAtMarker = function (this: MarkerContribution, marker: MonacoApi.IRange): void {
    handlers.showProblem(this._editor ?? editor, marker);
  };
  prototype._getOrCreateModel = (): never => {
    throw new Error("Monaco's problem peek is Studio's to show.");
  };
  return true;
}
