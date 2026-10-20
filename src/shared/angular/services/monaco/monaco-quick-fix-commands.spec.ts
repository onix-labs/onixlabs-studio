import type * as MonacoApi from 'monaco-editor';
import { FIND_PASSTHROUGH_CONTEXT_KEY } from './monaco-find-commands';
import {
  CODE_ACTION_CONTRIBUTION,
  installQuickFixCommands,
  MONACO_CODE_ACTION_COMMANDS,
  QUICK_FIX_EDITOR_OPTIONS,
  STUDIO_QUICK_FIX_COMMAND,
} from './monaco-quick-fix-commands';

/**
 * Monaco's `KeyMod.CtrlCmd`, as the fake instance numbers it.
 */
const CTRL_CMD: number = 2048;

/**
 * Monaco's `KeyCode.Period`, as the fake instance numbers it.
 */
const PERIOD: number = 89;

/**
 * What a fake Monaco instance was asked to do.
 */
interface Installed {
  readonly rules: MonacoApi.editor.IKeybindingRule[];
  readonly commands: Map<string, () => void>;
  readonly fixed: MonacoApi.editor.ICodeEditor[];
  create(editor: MonacoApi.editor.ICodeEditor): void;
}

/**
 * Stands in for Monaco's code-action contribution class: each of its ways into Monaco's widget
 * records that the widget would have opened.
 */
class FakeCodeActionController {
  /**
   * Records each time Monaco's own widget would have opened, or its own trigger run.
   */
  public static opened: string[] = [];

  /**
   * Initializes a new instance of the {@link FakeCodeActionController} class.
   * @param _editor The editor it belongs to.
   */
  public constructor(public readonly _editor: MonacoApi.editor.ICodeEditor) {}

  /**
   * Asks for code actions at the caret.
   * @param _message The message shown when there are none.
   * @param _source What asked.
   * @param filter The kinds asked for, if any.
   * @param autoApply When to apply one straight away, if ever.
   */
  public manualTriggerAtCurrentPosition(
    _message: string,
    _source: unknown,
    filter?: { include?: unknown },
    autoApply?: string,
  ): void {
    FakeCodeActionController.opened.push(`trigger ${String(filter?.include)} ${String(autoApply)}`);
  }

  /**
   * Opens Monaco's widget with a set of actions.
   * @returns Returns a promise that resolves at once.
   */
  public showCodeActions(): Promise<void> {
    FakeCodeActionController.opened.push('showCodeActions');
    return Promise.resolve();
  }

  /**
   * Opens Monaco's widget from the lightbulb.
   * @param actions The actions to show.
   * @returns Returns a promise that resolves at once.
   */
  public showCodeActionsFromLightbulb(actions: unknown): Promise<void> {
    FakeCodeActionController.opened.push(`lightbulb ${typeof actions}`);
    return Promise.resolve();
  }

  /**
   * Opens Monaco's widget.
   * @returns Returns a promise that resolves at once.
   */
  public showCodeActionList(): Promise<void> {
    FakeCodeActionController.opened.push('list');
    return Promise.resolve();
  }

  /**
   * Releases nothing.
   */
  public dispose(): void {
    // Nothing to release.
  }
}

/**
 * Installs the quick-fix commands into a fake Monaco instance holding the given editors.
 * @param editors The editors the instance holds, the first of them focused.
 * @returns Returns what the instance was asked to do.
 */
function install(editors: readonly MonacoApi.editor.ICodeEditor[]): Installed {
  let onCreate: ((editor: MonacoApi.editor.ICodeEditor) => void) | null = null;
  const installed: Installed = {
    rules: [],
    commands: new Map(),
    fixed: [],
    create: (editor: MonacoApi.editor.ICodeEditor): void => onCreate?.(editor),
  };
  const fake: typeof MonacoApi = {
    KeyMod: { CtrlCmd: CTRL_CMD },
    KeyCode: { Period: PERIOD },
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
  installQuickFixCommands(
    fake,
    (editor: MonacoApi.editor.ICodeEditor): void => void installed.fixed.push(editor),
  );
  return installed;
}

/**
 * A stand-in editor and what was done to it.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly options: MonacoApi.editor.IEditorOptions[];
  readonly positions: MonacoApi.IPosition[];
  readonly widgets: MonacoApi.editor.IContentWidget[];
}

/**
 * Builds a fake editor whose code-action contribution is an instance of the given class.
 * @param focused Whether its text holds the keyboard.
 * @param controller The contribution's class, or null for an editor without one.
 * @returns Returns the editor and its recorders.
 */
function fakeEditor(
  focused: boolean,
  controller: typeof FakeCodeActionController | null = FakeCodeActionController,
): FakeEditor {
  let contribution: FakeCodeActionController | null = null;
  const options: MonacoApi.editor.IEditorOptions[] = [];
  const positions: MonacoApi.IPosition[] = [];
  const widgets: MonacoApi.editor.IContentWidget[] = [];
  const editor: MonacoApi.editor.ICodeEditor = {
    hasTextFocus: (): boolean => focused,
    hasWidgetFocus: (): boolean => focused,
    updateOptions: (value: MonacoApi.editor.IEditorOptions): void => void options.push(value),
    setPosition: (position: MonacoApi.IPosition): void => void positions.push(position),
    addContentWidget: (widget: MonacoApi.editor.IContentWidget): void => void widgets.push(widget),
    getContribution: (id: string): unknown => {
      if (id !== CODE_ACTION_CONTRIBUTION || controller === null) {
        return null;
      }
      contribution ??= new controller(editor);
      return contribution;
    },
  } as unknown as MonacoApi.editor.ICodeEditor;
  return { editor, options, positions, widgets };
}

/**
 * Reads an editor's code-action contribution, as the fake class.
 * @param editor The editor.
 * @returns Returns the contribution.
 */
function controllerOf(editor: MonacoApi.editor.ICodeEditor): FakeCodeActionController {
  return editor.getContribution<FakeCodeActionController>(CODE_ACTION_CONTRIBUTION)!;
}

describe('installQuickFixCommands (#1016)', () => {
  beforeEach(() => {
    FakeCodeActionController.opened = [];
  });

  it('removesEveryCodeActionChord_andBindsStudiosQuickFixToCmdPeriod_outsideACodeFence', () => {
    const installed: Installed = install([]);

    expect(installed.rules).toEqual([
      { keybinding: 0, command: '-editor.action.quickFix' },
      { keybinding: 0, command: '-editor.action.codeAction' },
      { keybinding: 0, command: '-editor.action.refactor' },
      { keybinding: 0, command: '-editor.action.sourceAction' },
      { keybinding: 0, command: '-editor.action.organizeImports' },
      { keybinding: 0, command: '-editor.action.autoFix' },
      { keybinding: 0, command: '-editor.action.fixAll' },
      {
        keybinding: CTRL_CMD | PERIOD,
        command: STUDIO_QUICK_FIX_COMMAND,
        when: `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`,
      },
    ]);
    expect(MONACO_CODE_ACTION_COMMANDS).toHaveLength(7);
  });

  it('studiosCommand_opensQuickFixesInTheFocusedEditor', () => {
    const focused: FakeEditor = fakeEditor(true);
    const installed: Installed = install([fakeEditor(false).editor, focused.editor]);

    installed.commands.get(STUDIO_QUICK_FIX_COMMAND)?.();

    expect(installed.fixed).toEqual([focused.editor]);
  });

  it('everyEditor_hasMonacosLightbulbOff', () => {
    const installed: Installed = install([]);
    const editor: FakeEditor = fakeEditor(false, class extends FakeCodeActionController {});

    installed.create(editor.editor);

    expect(editor.options).toEqual([QUICK_FIX_EDITOR_OPTIONS]);
    expect(QUICK_FIX_EDITOR_OPTIONS.lightbulb).toEqual({ enabled: 'off' });
  });

  it('everyRouteIntoMonacosWidget_opensStudiosMenuInstead_inEveryEditor_andDrawsNothingOfMonacos', async () => {
    // A class of its own, so replacing its methods leaves the other specs' class alone.
    class Controller extends FakeCodeActionController {}
    const installed: Installed = install([]);
    const first: FakeEditor = fakeEditor(false, Controller);
    const second: FakeEditor = fakeEditor(false, Controller);
    installed.create(first.editor);
    installed.create(second.editor);

    controllerOf(first.editor).manualTriggerAtCurrentPosition('none', 'quickfix');
    await controllerOf(second.editor).showCodeActionList();
    await controllerOf(first.editor).showCodeActionsFromLightbulb({});

    expect(installed.fixed).toEqual([first.editor, second.editor, first.editor]);
    expect(FakeCodeActionController.opened).toEqual([]);
    // Taking the contribution over builds nothing of Monaco's into either editor.
    expect(first.widgets).toEqual([]);
    expect(second.widgets).toEqual([]);
  });

  it('theHoversQuickFixLink_movesTheCaretToTheProblem_thenOpensStudiosMenu', async () => {
    class Controller extends FakeCodeActionController {}
    const installed: Installed = install([]);
    const editor: FakeEditor = fakeEditor(false, Controller);
    installed.create(editor.editor);
    let released: number = 0;

    await (
      controllerOf(editor.editor) as unknown as {
        showCodeActions(trigger: unknown, actions: unknown): Promise<void>;
      }
    ).showCodeActions(
      {},
      {
        validActions: [
          { action: {} },
          {
            action: {
              diagnostics: [
                { startLineNumber: 4, startColumn: 9, endLineNumber: 4, endColumn: 12 },
              ],
            },
          },
        ],
        dispose: (): void => void (released += 1),
      },
    );

    expect(editor.positions).toEqual([{ lineNumber: 4, column: 9 }]);
    expect(installed.fixed).toEqual([editor.editor]);
    expect(released).toBe(1);
  });

  it('aKindToApplyStraightAway_isLeftToMonacosCommand_asCodeCleanupOrganisesImports', () => {
    class Controller extends FakeCodeActionController {}
    const installed: Installed = install([]);
    const editor: FakeEditor = fakeEditor(false, Controller);
    installed.create(editor.editor);

    controllerOf(editor.editor).manualTriggerAtCurrentPosition(
      'none',
      'default',
      { include: 'source.organizeImports' },
      'ifSingle',
    );

    expect(FakeCodeActionController.opened).toEqual(['trigger source.organizeImports ifSingle']);
    expect(installed.fixed).toEqual([]);
  });

  it('aKindToApplyStraightAway_asksMonacosModelWithoutAContext_soNoOverlayMessageCanShow', () => {
    const triggers: unknown[] = [];
    class Controller extends FakeCodeActionController {
      /**
       * Records what Monaco's code-action model is asked for.
       * @param trigger The request.
       */
      public _trigger(trigger: unknown): void {
        triggers.push(trigger);
      }
    }
    const installed: Installed = install([]);
    const editor: FakeEditor = fakeEditor(false, Controller);
    installed.create(editor.editor);

    controllerOf(editor.editor).manualTriggerAtCurrentPosition(
      'No organize imports action available',
      'default',
      { include: 'source.organizeImports' },
      'ifSingle',
    );

    expect(triggers).toEqual([
      {
        type: 1,
        triggerAction: 'default',
        filter: { include: 'source.organizeImports' },
        autoApply: 'ifSingle',
      },
    ]);
    expect(FakeCodeActionController.opened).toEqual([]);
    expect(installed.fixed).toEqual([]);
  });

  it('everyEditor_getsAStandInForMonacosLightbulb_soNoneIsEverBuilt', () => {
    let built: number = 0;
    class Controller extends FakeCodeActionController {
      /**
       * Stands in for Monaco's lazy lightbulb: reading its value builds it.
       */
      public _lightBulbWidget: { readonly value: unknown; readonly rawValue: unknown } = {
        get value(): unknown {
          built += 1;
          return {};
        },
        rawValue: undefined,
      };
    }
    const installed: Installed = install([]);
    const first: FakeEditor = fakeEditor(false, Controller);
    const second: FakeEditor = fakeEditor(false, Controller);
    installed.create(first.editor);
    installed.create(second.editor);

    for (const editor of [first.editor, second.editor]) {
      const lightbulb: { readonly value: unknown; readonly rawValue: unknown } = (
        controllerOf(editor) as Controller
      )._lightBulbWidget;
      expect(lightbulb.value).toBeUndefined();
      expect(lightbulb.rawValue).toBeUndefined();
    }
    expect(built).toBe(0);
  });

  it('anEditorWithoutTheContribution_isLeft_andTheNextOneTakenOver', async () => {
    class Controller extends FakeCodeActionController {}
    const installed: Installed = install([]);
    installed.create(fakeEditor(false, null).editor);
    const later: FakeEditor = fakeEditor(false, Controller);
    installed.create(later.editor);

    await controllerOf(later.editor).showCodeActionList();

    expect(installed.fixed).toEqual([later.editor]);
  });
});
