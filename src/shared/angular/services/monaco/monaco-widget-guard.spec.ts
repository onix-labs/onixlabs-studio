import type * as MonacoApi from 'monaco-editor';
import { FIND_PASSTHROUGH_CONTEXT_KEY } from './monaco-find-commands';
import {
  DIFF_GUARD_EDITOR_OPTIONS,
  FIND_CONTRIBUTION,
  INLAY_HINTS_CONTRIBUTION,
  installWidgetGuard,
  MONACO_SHOW_CONTEXT_MENU_COMMAND,
  MONACO_WIDGET_GUARD_COMMANDS,
  READ_ONLY_MESSAGE_CONTRIBUTION,
  STANDALONE_COLOR_PICKER_CONTRIBUTION,
  STUDIO_SHOW_CONTEXT_MENU_COMMAND,
  UNUSUAL_LINE_TERMINATORS_CONTRIBUTION,
  WIDGET_GUARD_EDITOR_OPTIONS,
} from './monaco-widget-guard';

/**
 * Monaco's `KeyMod.Shift`, as the fake instance numbers it.
 */
const SHIFT: number = 1024;

/**
 * Monaco's `KeyCode.F10`, as the fake instance numbers it.
 */
const F10: number = 68;

/**
 * Monaco's `EditorOption.readOnly`, as the fake instance numbers it.
 */
const READ_ONLY_OPTION: number = 104;

/**
 * What a fake Monaco instance was asked to do, and what the guard handed to Studio.
 */
interface Installed {
  readonly rules: MonacoApi.editor.IKeybindingRule[];
  readonly commands: Map<string, () => void>;
  readonly menus: MonacoApi.editor.ICodeEditor[];
  readonly readOnlyEdits: MonacoApi.editor.ICodeEditor[];
  readonly questions: string[];
  create(editor: MonacoApi.editor.ICodeEditor): void;
}

/**
 * Adds a Monaco widget's DOM to the page, as Monaco's own code would: what every stand-in contribution
 * does if its original way in is reached.
 * @param kind The widget's class.
 */
function buildMonacoWidget(kind: string): void {
  const node: HTMLElement = document.createElement('div');
  node.className = kind;
  document.body.appendChild(node);
}

/**
 * Counts the Monaco widgets on the page.
 * @returns Returns how many there are.
 */
function monacoWidgets(): number {
  return document.querySelectorAll('.monaco-widget').length;
}

/**
 * Stands in for a Monaco editor contribution, which releases nothing.
 */
class FakeContribution {
  /**
   * Initializes a new instance of the {@link FakeContribution} class.
   * @param editor The editor it belongs to.
   */
  public constructor(public readonly editor: MonacoApi.editor.ICodeEditor) {}

  /**
   * Releases nothing.
   */
  public dispose(): void {
    // Nothing to release.
  }
}

/**
 * Stands in for Monaco's standalone colour picker contribution.
 */
class FakeColorPicker extends FakeContribution {
  /**
   * Builds Monaco's standalone colour picker.
   */
  public showOrFocus(): void {
    buildMonacoWidget('monaco-widget standalone-colorpicker-body');
  }
}

/**
 * Stands in for Monaco's find contribution.
 */
class FakeFind extends FakeContribution {
  /**
   * Builds Monaco's find widget and flashes its options.
   */
  public highlightFindOptions(): void {
    buildMonacoWidget('monaco-widget find-widget');
  }
}

/**
 * Stands in for Monaco's inlay hints contribution.
 */
class FakeInlayHints extends FakeContribution {
  /**
   * Listens for a right-click on a hint, which opens Monaco's menu.
   * @returns Returns the listener's disposable.
   */
  public _installContextMenu(): MonacoApi.IDisposable {
    buildMonacoWidget('monaco-widget context-view');
    return { dispose: (): void => undefined };
  }
}

/**
 * Stands in for Monaco's read-only message contribution.
 */
class FakeReadOnlyMessage extends FakeContribution {
  /**
   * Shows Monaco's overlay message.
   */
  public _onDidAttemptReadOnlyEdit(): void {
    buildMonacoWidget('monaco-widget monaco-editor-overlaymessage');
  }
}

/**
 * Stands in for Monaco's unusual line terminators contribution: like Monaco's, it reads the option as
 * it is made and checks the document straight away, and asks in the browser's confirm box.
 */
class FakeLineTerminators extends FakeContribution {
  /**
   * Counts the browser confirm boxes Monaco's own check opened.
   */
  public static confirms: number = 0;

  /**
   * Holds the option, as the contribution last read it.
   */
  public _config: string;

  /**
   * Holds whether it is asking already.
   */
  public _isPresentingDialog: boolean = false;

  /**
   * Gets the editor it belongs to, under Monaco's name for it.
   */
  public readonly _editor: MonacoApi.editor.ICodeEditor;

  /**
   * Initializes a new instance of the {@link FakeLineTerminators} class.
   * @param editor The editor it belongs to.
   */
  public constructor(editor: MonacoApi.editor.ICodeEditor) {
    super(editor);
    this._editor = editor;
    this._config = editor.getRawOptions().unusualLineTerminators ?? 'prompt';
    void this._checkForUnusualLineTerminators();
  }

  /**
   * Asks in the browser's confirm box, unless the option is off.
   * @returns Returns a promise that resolves at once.
   */
  public _checkForUnusualLineTerminators(): Promise<void> {
    if (this._config !== 'off') {
      FakeLineTerminators.confirms += 1;
    }
    return Promise.resolve();
  }
}

/**
 * The contribution classes a fake editor makes, fresh for each spec so replacing their members leaves
 * the other specs alone.
 */
interface Classes {
  readonly picker: new (editor: MonacoApi.editor.ICodeEditor) => FakeColorPicker;
  readonly find: new (editor: MonacoApi.editor.ICodeEditor) => FakeFind;
  readonly hints: new (editor: MonacoApi.editor.ICodeEditor) => FakeInlayHints;
  readonly readOnly: new (editor: MonacoApi.editor.ICodeEditor) => FakeReadOnlyMessage;
  readonly terminators: new (editor: MonacoApi.editor.ICodeEditor) => FakeLineTerminators;
}

/**
 * Makes fresh subclasses of the stand-in contributions.
 * @returns Returns them.
 */
function freshClasses(): Classes {
  return {
    picker: class extends FakeColorPicker {},
    find: class extends FakeFind {},
    hints: class extends FakeInlayHints {},
    readOnly: class extends FakeReadOnlyMessage {},
    terminators: class extends FakeLineTerminators {},
  };
}

/**
 * The document of a fake editor, and what was done to it.
 */
interface FakeDocument {
  readonly model: MonacoApi.editor.ITextModel;
  removed: number;
}

/**
 * Builds a fake document.
 * @param unusual Whether it holds unusual line terminators.
 * @param path Its path, or undefined for a document never saved.
 * @returns Returns the document.
 */
function fakeDocument(unusual: boolean, path?: string): FakeDocument {
  const document: FakeDocument = {
    removed: 0,
    model: undefined as unknown as MonacoApi.editor.ITextModel,
  };
  (document as { model: unknown }).model = {
    uri: { scheme: path === undefined ? 'inmemory' : 'file', path: path ?? '/1' },
    mightContainUnusualLineTerminators: (): boolean => unusual,
    removeUnusualLineTerminators: (): void => void (document.removed += 1),
  };
  return document;
}

/**
 * A stand-in editor and what was done to it.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly options: MonacoApi.editor.IEditorOptions[];
}

/**
 * Builds a fake editor whose contributions are instances of the given classes.
 * @param focused Whether its text holds the keyboard.
 * @param classes The contributions' classes, or null for an editor without them.
 * @param document The document it shows, if any.
 * @param readOnly Whether it is read-only.
 * @returns Returns the editor and its recorder.
 */
function fakeEditor(
  focused: boolean,
  classes: Classes | null,
  document: FakeDocument | null = null,
  readOnly: boolean = false,
): FakeEditor {
  const made: Map<string, FakeContribution> = new Map<string, FakeContribution>();
  const options: MonacoApi.editor.IEditorOptions[] = [];
  let raw: MonacoApi.editor.IEditorOptions = {};
  const editor: MonacoApi.editor.ICodeEditor = {
    hasTextFocus: (): boolean => focused,
    hasWidgetFocus: (): boolean => focused,
    getModel: (): MonacoApi.editor.ITextModel | null => document?.model ?? null,
    getSelections: (): null => null,
    getRawOptions: (): MonacoApi.editor.IEditorOptions => raw,
    getOption: (id: number): unknown => (id === READ_ONLY_OPTION ? readOnly : undefined),
    updateOptions: (value: MonacoApi.editor.IEditorOptions): void => {
      options.push(value);
      raw = { ...raw, ...value };
      // As Monaco's contribution does, a change of the option is read, and the document checked.
      const detector: FakeContribution | undefined = made.get(
        UNUSUAL_LINE_TERMINATORS_CONTRIBUTION,
      );
      if (detector instanceof FakeLineTerminators && value.unusualLineTerminators !== undefined) {
        detector._config = value.unusualLineTerminators;
        void detector._checkForUnusualLineTerminators();
      }
    },
    getContribution: (id: string): unknown => {
      if (classes === null) {
        return null;
      }
      const type: (new (editor: MonacoApi.editor.ICodeEditor) => FakeContribution) | undefined = {
        [STANDALONE_COLOR_PICKER_CONTRIBUTION]: classes.picker,
        [FIND_CONTRIBUTION]: classes.find,
        [INLAY_HINTS_CONTRIBUTION]: classes.hints,
        [READ_ONLY_MESSAGE_CONTRIBUTION]: classes.readOnly,
        [UNUSUAL_LINE_TERMINATORS_CONTRIBUTION]: classes.terminators,
      }[id];
      if (type === undefined) {
        return null;
      }
      if (!made.has(id)) {
        made.set(id, new type(editor));
      }
      return made.get(id);
    },
  } as unknown as MonacoApi.editor.ICodeEditor;
  return { editor, options };
}

/**
 * Installs the guard into a fake Monaco instance holding the given editors.
 * @param editors The editors the instance holds.
 * @param remove What Studio's dialog answers when asked about unusual line terminators.
 * @returns Returns what the instance was asked to do.
 */
function install(
  editors: readonly MonacoApi.editor.ICodeEditor[],
  remove: boolean = true,
): Installed {
  let onCreate: ((editor: MonacoApi.editor.ICodeEditor) => void) | null = null;
  const installed: Installed = {
    rules: [],
    commands: new Map(),
    menus: [],
    readOnlyEdits: [],
    questions: [],
    create: (editor: MonacoApi.editor.ICodeEditor): void => onCreate?.(editor),
  };
  const fake: typeof MonacoApi = {
    KeyMod: { Shift: SHIFT },
    KeyCode: { F10 },
    editor: {
      EditorOption: { readOnly: READ_ONLY_OPTION },
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
  installWidgetGuard(fake, {
    showContextMenu: (editor: MonacoApi.editor.ICodeEditor): void =>
      void installed.menus.push(editor),
    readOnlyEdit: (editor: MonacoApi.editor.ICodeEditor): void =>
      void installed.readOnlyEdits.push(editor),
    confirmUnusualLineTerminators: (
      _editor: MonacoApi.editor.ICodeEditor,
      document: string,
    ): Promise<boolean> => {
      installed.questions.push(document);
      return Promise.resolve(remove);
    },
  });
  return installed;
}

/**
 * Waits for the promises already settling to settle: Studio's dialog answers asynchronously.
 * @returns Returns a promise that resolves once they have.
 */
function settled(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => void setTimeout(resolve));
}

describe('installWidgetGuard (#1024)', () => {
  beforeEach(() => {
    FakeLineTerminators.confirms = 0;
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('removesEveryGuardedChord_andBindsStudiosMenuToShiftF10_outsideACodeFence', () => {
    const installed: Installed = install([]);

    expect(installed.rules).toEqual([
      ...MONACO_WIDGET_GUARD_COMMANDS.map((command: string): MonacoApi.editor.IKeybindingRule => ({
        keybinding: 0,
        command: `-${command}`,
      })),
      {
        keybinding: SHIFT | F10,
        command: STUDIO_SHOW_CONTEXT_MENU_COMMAND,
        when: `editorTextFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`,
      },
    ]);
    expect(MONACO_WIDGET_GUARD_COMMANDS).toContain(MONACO_SHOW_CONTEXT_MENU_COMMAND);
  });

  it('shiftF10_opensStudiosMenuInTheFocusedEditor_andNothingWithNoneFocused', () => {
    const focused: FakeEditor = fakeEditor(true, null);
    const installed: Installed = install([fakeEditor(false, null).editor, focused.editor]);

    installed.commands.get(STUDIO_SHOW_CONTEXT_MENU_COMMAND)?.();

    expect(installed.menus).toEqual([focused.editor]);

    const unfocused: Installed = install([fakeEditor(false, null).editor]);
    unfocused.commands.get(STUDIO_SHOW_CONTEXT_MENU_COMMAND)?.();
    expect(unfocused.menus).toEqual([]);
  });

  it('everyEditor_hasTheSwatchClickInlineSuggestionsAndPasteMenusOff', () => {
    const installed: Installed = install([]);
    const first: FakeEditor = fakeEditor(false, freshClasses());
    const second: FakeEditor = fakeEditor(false, freshClasses());

    installed.create(first.editor);
    installed.create(second.editor);

    expect(WIDGET_GUARD_EDITOR_OPTIONS).toEqual({
      colorDecoratorsActivatedOn: 'hover',
      inlineSuggest: { enabled: false },
      pasteAs: { showPasteSelector: 'never' },
      dropIntoEditor: { showDropSelector: 'never' },
    });
    expect(first.options[0]).toBe(WIDGET_GUARD_EDITOR_OPTIONS);
    // Once the line terminators check is taken over, a later editor is given nothing else.
    expect(second.options).toEqual([WIDGET_GUARD_EDITOR_OPTIONS]);
  });

  it('diffEditors_drawNoToolbarOrRevertArrowsInTheGutter', () => {
    expect(DIFF_GUARD_EDITOR_OPTIONS).toEqual({
      renderGutterMenu: false,
      renderMarginRevertIcon: false,
    });
    // The folded runs of unchanged lines are left as Monaco draws them.
    expect('hideUnchangedRegions' in DIFF_GUARD_EDITOR_OPTIONS).toBe(false);
  });

  it('theColourPickerFindOptionsAndInlayHintMenu_areNeverBuilt_inEveryEditor', () => {
    const classes: Classes = freshClasses();
    const installed: Installed = install([]);
    const first: FakeEditor = fakeEditor(false, classes);
    const second: FakeEditor = fakeEditor(false, classes);
    installed.create(first.editor);
    installed.create(second.editor);

    for (const { editor } of [first, second]) {
      editor.getContribution<FakeColorPicker>(STANDALONE_COLOR_PICKER_CONTRIBUTION)?.showOrFocus();
      editor.getContribution<FakeFind>(FIND_CONTRIBUTION)?.highlightFindOptions();
      editor
        .getContribution<FakeInlayHints>(INLAY_HINTS_CONTRIBUTION)
        ?._installContextMenu()
        .dispose();
    }

    expect(monacoWidgets()).toBe(0);
  });

  it('editingAReadOnlyEditor_tellsStudio_neverShowingMonacosOverlayMessage', () => {
    const classes: Classes = freshClasses();
    const installed: Installed = install([]);
    const first: FakeEditor = fakeEditor(false, classes, null, true);
    const second: FakeEditor = fakeEditor(false, classes, null, true);
    installed.create(first.editor);
    installed.create(second.editor);

    for (const { editor } of [first, second]) {
      editor
        .getContribution<FakeReadOnlyMessage>(READ_ONLY_MESSAGE_CONTRIBUTION)
        ?._onDidAttemptReadOnlyEdit();
    }

    expect(installed.readOnlyEdits).toEqual([first.editor, second.editor]);
    expect(monacoWidgets()).toBe(0);
  });

  it('unusualLineTerminators_areAskedAboutInStudiosDialog_neverTheBrowsersConfirm_andRemoved', async () => {
    const installed: Installed = install([], true);
    const document: FakeDocument = fakeDocument(true, '/ws/notes.txt');
    const editor: FakeEditor = fakeEditor(false, freshClasses(), document);

    installed.create(editor.editor);
    await settled();

    // Made with the option off, so Monaco's own check asked nothing; put back, so Studio's asks.
    expect(FakeLineTerminators.confirms).toBe(0);
    expect(editor.options.slice(1)).toEqual([
      { unusualLineTerminators: 'off' },
      { unusualLineTerminators: 'prompt' },
    ]);
    expect(installed.questions).toEqual(['“notes.txt”']);
    expect(document.removed).toBe(1);
  });

  it('unusualLineTerminators_leftAsTheyAre_areNotAskedAboutAgain', async () => {
    const classes: Classes = freshClasses();
    const installed: Installed = install([], false);
    const document: FakeDocument = fakeDocument(true);
    const editor: FakeEditor = fakeEditor(false, classes, document);
    installed.create(editor.editor);
    await settled();

    await editor.editor
      .getContribution<FakeLineTerminators>(UNUSUAL_LINE_TERMINATORS_CONTRIBUTION)
      ?._checkForUnusualLineTerminators();

    expect(installed.questions).toEqual(['This document']);
    expect(document.removed).toBe(0);
  });

  it('unusualLineTerminators_areNeverAskedAbout_offInAReadOnlyEditorOrWithNone_andRemovedOnAuto', async () => {
    const classes: Classes = freshClasses();
    const installed: Installed = install([]);
    installed.create(fakeEditor(false, classes, fakeDocument(false)).editor);
    const readOnly: FakeEditor = fakeEditor(false, classes, fakeDocument(true), true);
    installed.create(readOnly.editor);
    const off: FakeEditor = fakeEditor(false, classes, fakeDocument(true));
    installed.create(off.editor);
    const automatic: FakeDocument = fakeDocument(true);
    const auto: FakeEditor = fakeEditor(false, classes, automatic);
    installed.create(auto.editor);

    readOnly.editor.getContribution(UNUSUAL_LINE_TERMINATORS_CONTRIBUTION);
    off.editor.updateOptions({ unusualLineTerminators: 'off' });
    off.editor.getContribution(UNUSUAL_LINE_TERMINATORS_CONTRIBUTION);
    auto.editor.updateOptions({ unusualLineTerminators: 'auto' });
    auto.editor.getContribution(UNUSUAL_LINE_TERMINATORS_CONTRIBUTION);
    await settled();

    expect(installed.questions).toEqual([]);
    expect(automatic.removed).toBe(1);
    expect(FakeLineTerminators.confirms).toBe(0);
  });

  it('anEditorWithoutTheContributions_isLeft_andTheNextOneTakenOver', () => {
    const classes: Classes = freshClasses();
    const installed: Installed = install([]);
    installed.create(fakeEditor(false, null).editor);
    const later: FakeEditor = fakeEditor(false, classes);
    installed.create(later.editor);

    later.editor.getContribution<FakeFind>(FIND_CONTRIBUTION)?.highlightFindOptions();
    later.editor
      .getContribution<FakeColorPicker>(STANDALONE_COLOR_PICKER_CONTRIBUTION)
      ?.showOrFocus();
    later.editor
      .getContribution<FakeReadOnlyMessage>(READ_ONLY_MESSAGE_CONTRIBUTION)
      ?._onDidAttemptReadOnlyEdit();

    expect(monacoWidgets()).toBe(0);
  });

  it('aContributionMissingItsHook_isNotTakenOver', () => {
    // A find contribution without `highlightFindOptions` — a Monaco that renamed it — is left alone,
    // and the contract spec fails the build instead.
    class Renamed extends FakeContribution {
      /**
       * Flashes the options under a new name.
       */
      public flashFindOptions(): void {
        buildMonacoWidget('monaco-widget find-widget');
      }
    }
    const classes: Classes = {
      ...freshClasses(),
      find: Renamed as unknown as Classes['find'],
    };
    const installed: Installed = install([]);
    const editor: FakeEditor = fakeEditor(false, classes);
    installed.create(editor.editor);

    editor.editor.getContribution<Renamed>(FIND_CONTRIBUTION)?.flashFindOptions();

    expect(monacoWidgets()).toBe(1);
  });
});
