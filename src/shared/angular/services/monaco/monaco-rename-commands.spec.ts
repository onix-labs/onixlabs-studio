import type * as MonacoApi from 'monaco-editor';
import { FIND_PASSTHROUGH_CONTEXT_KEY } from './monaco-find-commands';
import {
  installRenameCommands,
  MONACO_RENAME_COMMAND,
  MONACO_RENAME_WIDGET_ID,
  RENAME_CONTRIBUTION,
  STUDIO_RENAME_SYMBOL_COMMAND,
} from './monaco-rename-commands';

/**
 * Monaco's `KeyCode.F2`, as the fake instance numbers it.
 */
const F2: number = 60;

/**
 * What a fake Monaco instance was asked to do.
 */
interface Installed {
  readonly rules: MonacoApi.editor.IKeybindingRule[];
  readonly commands: Map<string, () => void>;
  readonly renamed: MonacoApi.editor.ICodeEditor[];
  create(editor: MonacoApi.editor.ICodeEditor): void;
}

/**
 * Stands in for Monaco's rename contribution class: its `run` opens Monaco's rename box.
 */
class FakeRenameController {
  /**
   * Records each time Monaco's own rename box would have opened.
   */
  public static opened: number = 0;

  /**
   * Initializes a new instance of the {@link FakeRenameController} class.
   * @param editor The editor it belongs to.
   */
  public constructor(public readonly editor: MonacoApi.editor.ICodeEditor) {}

  /**
   * Opens Monaco's rename box.
   * @returns Returns a promise that resolves at once.
   */
  public run(): Promise<void> {
    FakeRenameController.opened += 1;
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
 * Installs the rename commands into a fake Monaco instance holding the given editors.
 * @param editors The editors the instance holds, the first of them focused.
 * @returns Returns what the instance was asked to do.
 */
function install(editors: readonly MonacoApi.editor.ICodeEditor[]): Installed {
  let onCreate: ((editor: MonacoApi.editor.ICodeEditor) => void) | null = null;
  const installed: Installed = {
    rules: [],
    commands: new Map(),
    renamed: [],
    create: (editor: MonacoApi.editor.ICodeEditor): void => onCreate?.(editor),
  };
  const fake: typeof MonacoApi = {
    KeyCode: { F2 },
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
  installRenameCommands(
    fake,
    (editor: MonacoApi.editor.ICodeEditor): void => void installed.renamed.push(editor),
  );
  return installed;
}

/**
 * Builds a fake editor whose rename contribution is an instance of the given class.
 * @param focused Whether its text holds the keyboard.
 * @param controller The contribution's class, or null for an editor without one.
 * @returns Returns the editor.
 */
function fakeEditor(
  focused: boolean,
  controller: typeof FakeRenameController | null = FakeRenameController,
): MonacoApi.editor.ICodeEditor {
  let contribution: FakeRenameController | null = null;
  const removed: string[] = [];
  const editor: MonacoApi.editor.ICodeEditor = {
    removedWidgets: removed,
    getContainerDomNode: (): HTMLElement => document.createElement('div'),
    removeContentWidget: (widget: MonacoApi.editor.IContentWidget): void =>
      void removed.push(widget.getId()),
    hasTextFocus: (): boolean => focused,
    hasWidgetFocus: (): boolean => focused,
    getContribution: (id: string): unknown => {
      if (id !== RENAME_CONTRIBUTION || controller === null) {
        return null;
      }
      contribution ??= new controller(editor);
      return contribution;
    },
  } as unknown as MonacoApi.editor.ICodeEditor;
  return editor;
}

describe('installRenameCommands (#1015)', () => {
  beforeEach(() => {
    FakeRenameController.opened = 0;
  });

  it('removesMonacosRenameChord_andBindsStudiosRenameToF2_outsideACodeFence', () => {
    const installed: Installed = install([]);

    expect(installed.rules).toEqual([
      { keybinding: 0, command: `-${MONACO_RENAME_COMMAND}` },
      {
        keybinding: F2,
        command: STUDIO_RENAME_SYMBOL_COMMAND,
        when: `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`,
      },
    ]);
  });

  it('studiosCommand_renamesInTheFocusedEditor', () => {
    const focused: MonacoApi.editor.ICodeEditor = fakeEditor(true);
    const installed: Installed = install([fakeEditor(false), focused]);

    installed.commands.get(STUDIO_RENAME_SYMBOL_COMMAND)?.();

    expect(installed.renamed).toEqual([focused]);
  });

  it('everyOtherRouteIntoMonacosRename_goesToStudiosInstead_inEveryEditor', async () => {
    // A class of its own, so replacing its run leaves the other specs' class alone.
    class Controller extends FakeRenameController {}
    const installed: Installed = install([]);
    const first: MonacoApi.editor.ICodeEditor = fakeEditor(false, Controller);
    const second: MonacoApi.editor.ICodeEditor = fakeEditor(false, Controller);
    installed.create(first);
    installed.create(second);

    await first.getContribution<Controller>(RENAME_CONTRIBUTION)?.run();
    await second.getContribution<Controller>(RENAME_CONTRIBUTION)?.run();

    expect(installed.renamed).toEqual([first, second]);
    expect(FakeRenameController.opened).toBe(0);
  });

  it('takesMonacosRenameBoxOutOfThePage_whenReachingTheControllerBuiltIt', () => {
    // Reaching the controller builds it, and it attaches its rename box to the editor, hidden. Left
    // in, it was Monaco UI in the document, and it broke an E2E locator for the code editor.
    class Controller extends FakeRenameController {}
    const installed: Installed = install([]);
    const editor: MonacoApi.editor.ICodeEditor = fakeEditor(false, Controller);

    installed.create(editor);

    expect((editor as unknown as { removedWidgets: string[] }).removedWidgets).toEqual([
      MONACO_RENAME_WIDGET_ID,
    ]);
  });

  it('anEditorWithoutTheContribution_isLeft_andTheNextOneTakenOver', async () => {
    class Controller extends FakeRenameController {}
    const installed: Installed = install([]);
    installed.create(fakeEditor(false, null));
    const later: MonacoApi.editor.ICodeEditor = fakeEditor(false, Controller);
    installed.create(later);

    await later.getContribution<Controller>(RENAME_CONTRIBUTION)?.run();

    expect(installed.renamed).toEqual([later]);
  });
});
