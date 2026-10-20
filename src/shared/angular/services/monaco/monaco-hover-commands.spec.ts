import type * as MonacoApi from 'monaco-editor';
import { FIND_PASSTHROUGH_CONTEXT_KEY } from './monaco-find-commands';
import {
  CONTENT_HOVER_CONTRIBUTION,
  GLYPH_HOVER_CONTRIBUTION,
  HOVER_EDITOR_OPTIONS,
  installHoverCommands,
  MARKER_CONTRIBUTION,
  MONACO_MARKER_COMMANDS,
  ProblemDirection,
  STUDIO_NEXT_PROBLEM_COMMAND,
  STUDIO_PREVIOUS_PROBLEM_COMMAND,
  STUDIO_SHOW_HOVER_COMMAND,
} from './monaco-hover-commands';

/**
 * Monaco's key modifiers and codes, as the fake instance numbers them.
 */
const CTRL_CMD: number = 2048;
const SHIFT: number = 1024;
const ALT: number = 512;
const KEY_K: number = 41;
const KEY_I: number = 39;
const F8: number = 66;

/**
 * Adds Monaco's hover DOM to the page, as Monaco's own widgets would: what every stand-in contribution
 * does if any of its original ways in is reached.
 * @param kind The widget's class.
 * @returns Returns a widget-shaped object.
 */
function buildMonacoWidget(kind: string): unknown {
  const node: HTMLElement = document.createElement('div');
  node.className = kind;
  document.body.appendChild(node);
  return { showsOrWillShow: (): boolean => true, hide: (): void => undefined };
}

/**
 * Stands in for Monaco's hover contribution: each of its ways in builds Monaco's hover.
 */
class FakeContentHover {
  /**
   * Initializes a new instance of the {@link FakeContentHover} class.
   * @param _editor The editor it belongs to.
   */
  public constructor(public readonly _editor: MonacoApi.editor.ICodeEditor) {}

  /**
   * Builds Monaco's hover widget.
   * @returns Returns the widget.
   */
  public _getOrCreateContentWidget(): unknown {
    return buildMonacoWidget('monaco-hover');
  }

  /**
   * Follows the pointer, building the widget.
   */
  public _onEditorMouseMove(): void {
    this._reactToEditorMouseMove();
  }

  /**
   * Shows the widget for the pointer.
   */
  public _reactToEditorMouseMove(): void {
    this._getOrCreateContentWidget();
  }

  /**
   * Shows the widget over a span.
   */
  public showContentHover(): void {
    this._getOrCreateContentWidget();
  }

  /**
   * Releases nothing.
   */
  public dispose(): void {
    // Nothing to release.
  }
}

/**
 * Stands in for Monaco's gutter hover contribution: each of its ways in builds Monaco's gutter hover.
 */
class FakeGlyphHover {
  /**
   * Builds Monaco's gutter hover widget.
   * @returns Returns the widget.
   */
  public _getOrCreateGlyphWidget(): unknown {
    return buildMonacoWidget('monaco-glyph-hover');
  }

  /**
   * Follows the pointer, building the widget.
   */
  public _onEditorMouseMove(): void {
    this._reactToEditorMouseMove();
  }

  /**
   * Shows the widget for the pointer.
   */
  public _reactToEditorMouseMove(): void {
    this._tryShowHoverWidget();
  }

  /**
   * Builds and shows the widget.
   * @returns Returns true: it shows.
   */
  public _tryShowHoverWidget(): boolean {
    this._getOrCreateGlyphWidget();
    return true;
  }

  /**
   * Releases nothing.
   */
  public dispose(): void {
    // Nothing to release.
  }
}

/**
 * Stands in for Monaco's problem navigation contribution: each of its ways in builds Monaco's peek.
 */
class FakeMarkerController {
  /**
   * Initializes a new instance of the {@link FakeMarkerController} class.
   * @param _editor The editor it belongs to.
   */
  public constructor(public readonly _editor: MonacoApi.editor.ICodeEditor) {}

  /**
   * Goes to a problem, building the peek.
   * @returns Returns a promise that resolves at once.
   */
  public navigate(): Promise<void> {
    this._getOrCreateModel();
    return Promise.resolve();
  }

  /**
   * Shows the peek under one problem.
   */
  public showAtMarker(): void {
    this._getOrCreateModel();
  }

  /**
   * Builds the peek.
   * @returns Returns the peek.
   */
  public _getOrCreateModel(): unknown {
    return buildMonacoWidget('marker-widget');
  }

  /**
   * Releases nothing.
   */
  public dispose(): void {
    // Nothing to release.
  }
}

/**
 * The contributions' classes a fake editor builds its contributions from.
 */
interface Classes {
  readonly content: new (editor: MonacoApi.editor.ICodeEditor) => FakeContentHover;
  readonly glyph: new (editor: MonacoApi.editor.ICodeEditor) => FakeGlyphHover;
  readonly marker: new (editor: MonacoApi.editor.ICodeEditor) => FakeMarkerController;
}

/**
 * Makes classes of their own for one spec, so replacing their methods leaves the other specs alone.
 * @returns Returns the classes.
 */
function freshClasses(): Classes {
  return {
    content: class extends FakeContentHover {},
    glyph: class extends FakeGlyphHover {},
    marker: class extends FakeMarkerController {},
  };
}

/**
 * What the takeover handed to Studio.
 */
interface Handled {
  readonly shown: { editor: MonacoApi.editor.ICodeEditor; position?: MonacoApi.IPosition }[];
  readonly problems: { editor: MonacoApi.editor.ICodeEditor; direction: ProblemDirection }[];
  readonly problemCards: { editor: MonacoApi.editor.ICodeEditor; problem: MonacoApi.IRange }[];
}

/**
 * What a fake Monaco instance was asked to do.
 */
interface Installed {
  readonly rules: MonacoApi.editor.IKeybindingRule[];
  readonly commands: Map<string, () => void>;
  readonly handled: Handled;
  create(editor: MonacoApi.editor.ICodeEditor): void;
}

/**
 * Installs the hover commands into a fake Monaco instance holding the given editors.
 * @param editors The editors the instance holds.
 * @returns Returns what the instance was asked to do.
 */
function install(editors: readonly MonacoApi.editor.ICodeEditor[]): Installed {
  let onCreate: ((editor: MonacoApi.editor.ICodeEditor) => void) | null = null;
  const handled: Handled = { shown: [], problems: [], problemCards: [] };
  const installed: Installed = {
    rules: [],
    commands: new Map(),
    handled,
    create: (editor: MonacoApi.editor.ICodeEditor): void => onCreate?.(editor),
  };
  const fake: typeof MonacoApi = {
    KeyMod: {
      CtrlCmd: CTRL_CMD,
      Shift: SHIFT,
      Alt: ALT,
      chord: (first: number, second: number): number => first | (second << 16),
    },
    KeyCode: { KeyK: KEY_K, KeyI: KEY_I, F8 },
    editor: {
      getEditors: (): readonly MonacoApi.editor.ICodeEditor[] => editors,
      registerCommand: (id: string, handler: () => void): void =>
        void installed.commands.set(id, handler),
      addKeybindingRules: (rules: MonacoApi.editor.IKeybindingRule[]): void =>
        void installed.rules.push(...rules),
      onDidCreateEditor: (listener: (editor: MonacoApi.editor.ICodeEditor) => void): void => {
        onCreate = listener;
      },
    },
  } as unknown as typeof MonacoApi;
  installHoverCommands(fake, {
    showHover: (editor: MonacoApi.editor.ICodeEditor, position?: MonacoApi.IPosition): void =>
      void handled.shown.push(position === undefined ? { editor } : { editor, position }),
    goToProblem: (editor: MonacoApi.editor.ICodeEditor, direction: ProblemDirection): void =>
      void handled.problems.push({ editor, direction }),
    showProblem: (editor: MonacoApi.editor.ICodeEditor, problem: MonacoApi.IRange): void =>
      void handled.problemCards.push({ editor, problem }),
  });
  return installed;
}

/**
 * A stand-in editor and what was done to it.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly options: MonacoApi.editor.IEditorOptions[];
  contribution<T>(id: string): T;
}

/**
 * Builds a fake editor whose contributions are instances of the given classes.
 * @param focused Whether its text holds the keyboard.
 * @param classes The contributions' classes, or null for an editor with none.
 * @returns Returns the editor and its recorders.
 */
function fakeEditor(focused: boolean, classes: Classes | null): FakeEditor {
  const made: Map<string, unknown> = new Map<string, unknown>();
  const options: MonacoApi.editor.IEditorOptions[] = [];
  const editor: MonacoApi.editor.ICodeEditor = {
    hasTextFocus: (): boolean => focused,
    hasWidgetFocus: (): boolean => focused,
    updateOptions: (value: MonacoApi.editor.IEditorOptions): void => void options.push(value),
    getContribution: (id: string): unknown => {
      if (classes === null) {
        return null;
      }
      if (!made.has(id)) {
        const Type: (new (editor: MonacoApi.editor.ICodeEditor) => unknown) | undefined =
          id === CONTENT_HOVER_CONTRIBUTION
            ? classes.content
            : id === GLYPH_HOVER_CONTRIBUTION
              ? classes.glyph
              : id === MARKER_CONTRIBUTION
                ? classes.marker
                : undefined;
        made.set(id, Type === undefined ? null : new Type(editor));
      }
      return made.get(id);
    },
  } as unknown as MonacoApi.editor.ICodeEditor;
  return {
    editor,
    options,
    contribution: <T>(id: string): T => editor.getContribution(id) as T,
  };
}

/**
 * Counts Monaco's hover, gutter hover and problem peek elements in the page.
 * @returns Returns how many there are.
 */
function monacoWidgets(): number {
  return document.querySelectorAll('.monaco-hover, .monaco-glyph-hover, .marker-widget').length;
}

describe('installHoverCommands (#1020)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('removesMonacosHoverAndProblemChords_andBindsStudios_outsideACodeFence', () => {
    const installed: Installed = install([]);
    const when: string = `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`;

    expect(installed.rules).toEqual([
      { keybinding: 0, command: '-editor.action.showHover' },
      { keybinding: 0, command: '-editor.action.marker.next' },
      { keybinding: 0, command: '-editor.action.marker.prev' },
      { keybinding: 0, command: '-editor.action.marker.nextInFiles' },
      { keybinding: 0, command: '-editor.action.marker.prevInFiles' },
      {
        keybinding: CTRL_CMD | KEY_K | ((CTRL_CMD | KEY_I) << 16),
        command: STUDIO_SHOW_HOVER_COMMAND,
        when,
      },
      { keybinding: F8, command: STUDIO_NEXT_PROBLEM_COMMAND, when },
      { keybinding: ALT | F8, command: STUDIO_NEXT_PROBLEM_COMMAND, when },
      { keybinding: SHIFT | F8, command: STUDIO_PREVIOUS_PROBLEM_COMMAND, when },
      { keybinding: SHIFT | ALT | F8, command: STUDIO_PREVIOUS_PROBLEM_COMMAND, when },
    ]);
    expect(MONACO_MARKER_COMMANDS).toHaveLength(4);
  });

  it('studiosCommands_runInTheFocusedEditor', () => {
    const focused: FakeEditor = fakeEditor(true, null);
    const installed: Installed = install([fakeEditor(false, null).editor, focused.editor]);

    installed.commands.get(STUDIO_SHOW_HOVER_COMMAND)?.();
    installed.commands.get(STUDIO_NEXT_PROBLEM_COMMAND)?.();
    installed.commands.get(STUDIO_PREVIOUS_PROBLEM_COMMAND)?.();

    expect(installed.handled.shown).toEqual([{ editor: focused.editor }]);
    expect(installed.handled.problems).toEqual([
      { editor: focused.editor, direction: 'next' },
      { editor: focused.editor, direction: 'previous' },
    ]);
  });

  it('studiosCommands_doNothing_withNoEditorFocused', () => {
    const installed: Installed = install([fakeEditor(false, null).editor]);

    installed.commands.get(STUDIO_SHOW_HOVER_COMMAND)?.();
    installed.commands.get(STUDIO_NEXT_PROBLEM_COMMAND)?.();

    expect(installed.handled.shown).toEqual([]);
    expect(installed.handled.problems).toEqual([]);
  });

  it('everyEditor_hasMonacosHoverOff', () => {
    const installed: Installed = install([]);
    const editor: FakeEditor = fakeEditor(false, freshClasses());

    installed.create(editor.editor);

    expect(editor.options).toEqual([HOVER_EDITOR_OPTIONS]);
    expect(HOVER_EDITOR_OPTIONS.hover).toEqual({ enabled: 'off' });
  });

  it('monacosHover_isNeverBuilt_byThePointerOrAnyRouteIn_andShowingOverASpanShowsStudiosCard', () => {
    const classes: Classes = freshClasses();
    const installed: Installed = install([]);
    const first: FakeEditor = fakeEditor(false, classes);
    const second: FakeEditor = fakeEditor(false, classes);
    installed.create(first.editor);
    installed.create(second.editor);
    const hover: FakeContentHover = second.contribution<FakeContentHover>(
      CONTENT_HOVER_CONTRIBUTION,
    );

    hover._onEditorMouseMove();
    hover._reactToEditorMouseMove();
    const widget: { showsOrWillShow(): boolean; isVisible: boolean } =
      hover._getOrCreateContentWidget() as { showsOrWillShow(): boolean; isVisible: boolean };
    (hover as unknown as { showContentHover(range: MonacoApi.IRange): void }).showContentHover({
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 5,
    });

    expect(widget.showsOrWillShow()).toBe(false);
    expect(widget.isVisible).toBe(false);
    expect(installed.handled.shown).toEqual([
      { editor: second.editor, position: { lineNumber: 3, column: 5 } },
    ]);
    expect(monacoWidgets()).toBe(0);
  });

  it('monacosGutterHover_isNeverBuilt', () => {
    const classes: Classes = freshClasses();
    const installed: Installed = install([]);
    const editor: FakeEditor = fakeEditor(false, classes);
    installed.create(editor.editor);
    const glyph: FakeGlyphHover = editor.contribution<FakeGlyphHover>(GLYPH_HOVER_CONTRIBUTION);

    glyph._onEditorMouseMove();
    glyph._reactToEditorMouseMove();

    expect(glyph._tryShowHoverWidget()).toBe(false);
    expect(monacoWidgets()).toBe(0);
  });

  it('monacosProblemNavigation_goesToStudios_andViewProblemShowsItsCard_neverBuildingThePeek', async () => {
    const classes: Classes = freshClasses();
    const installed: Installed = install([]);
    const editor: FakeEditor = fakeEditor(false, classes);
    installed.create(editor.editor);
    const markers: FakeMarkerController & {
      navigate(next: boolean, multiFile: boolean): Promise<void>;
      showAtMarker(marker: MonacoApi.IRange): void;
    } = editor.contribution(MARKER_CONTRIBUTION);
    const problem: MonacoApi.IRange = {
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 4,
    };

    await markers.navigate(true, true);
    await markers.navigate(false, false);
    markers.showAtMarker(problem);

    expect(installed.handled.problems).toEqual([
      { editor: editor.editor, direction: 'next' },
      { editor: editor.editor, direction: 'previous' },
    ]);
    expect(installed.handled.problemCards).toEqual([{ editor: editor.editor, problem }]);
    expect((): unknown => markers._getOrCreateModel()).toThrow();
    expect(monacoWidgets()).toBe(0);
  });

  it('anEditorWithoutTheContributions_isLeft_andTheNextOneTakenOver', async () => {
    const classes: Classes = freshClasses();
    const installed: Installed = install([]);
    installed.create(fakeEditor(false, null).editor);
    const later: FakeEditor = fakeEditor(false, classes);
    installed.create(later.editor);

    later.contribution<FakeContentHover>(CONTENT_HOVER_CONTRIBUTION)._onEditorMouseMove();
    await later.contribution<FakeMarkerController>(MARKER_CONTRIBUTION).navigate();

    expect(installed.handled.problems).toHaveLength(1);
    expect(monacoWidgets()).toBe(0);
  });

  it('aContributionMissingAHook_isNotTakenOver', () => {
    // An upgrade that renames a hook must be seen, not half taken over: see the contract spec.
    class Partial extends FakeContentHover {}
    Object.defineProperty(Partial.prototype, 'showContentHover', { value: undefined });
    const classes: Classes = { ...freshClasses(), content: Partial };
    const installed: Installed = install([]);
    const editor: FakeEditor = fakeEditor(false, classes);
    installed.create(editor.editor);

    editor.contribution<FakeContentHover>(CONTENT_HOVER_CONTRIBUTION)._onEditorMouseMove();

    expect(monacoWidgets()).toBe(1);
  });
});
