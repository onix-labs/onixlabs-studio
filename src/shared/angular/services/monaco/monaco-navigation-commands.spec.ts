import type * as MonacoApi from 'monaco-editor';
import { FIND_PASSTHROUGH_CONTEXT_KEY } from './monaco-find-commands';
import {
  DEFINITION_LINK_CONTRIBUTION,
  installNavigationCommands,
  MONACO_NAVIGATION_COMMANDS,
  NAVIGATION_EDITOR_OPTIONS,
  NavigationMode,
  STUDIO_FIND_REFERENCES_COMMAND,
  STUDIO_GO_TO_DEFINITION_COMMAND,
  STUDIO_GO_TO_IMPLEMENTATION_COMMAND,
  STUDIO_GO_TO_TYPE_DEFINITION_COMMAND,
  STUDIO_CALL_HIERARCHY_COMMAND,
  STUDIO_TYPE_HIERARCHY_COMMAND,
  STUDIO_REFERENCES_LENS_COMMAND,
} from './monaco-navigation-commands';

/**
 * The key codes the fake instance names, as Monaco numbers them.
 */
const KEYS: { CtrlCmd: number; Shift: number; Alt: number; WinCtrl: number } = {
  CtrlCmd: 2048,
  Shift: 1024,
  Alt: 512,
  WinCtrl: 256,
};

/**
 * Monaco's `KeyCode.F12`, as the fake instance numbers it.
 */
const F12: number = 70;

/**
 * Monaco's `KeyCode.KeyH`, as the fake instance numbers it.
 */
const KEY_H: number = 38;

/**
 * Monaco's mouse-target types the specs click on.
 */
const TARGET: Readonly<Record<'text' | 'gutter', number>> = { text: 6, gutter: 3 };

/**
 * What a fake Monaco instance was asked to do.
 */
interface Installed {
  readonly rules: MonacoApi.editor.IKeybindingRule[];
  readonly commands: Map<string, () => void>;
  readonly navigated: { editor: MonacoApi.editor.ICodeEditor; mode: NavigationMode }[];
  create(editor: MonacoApi.editor.ICodeEditor): void;
}

/**
 * Describes a mouse event a spec sends a fake editor.
 */
interface Click {
  readonly meta?: boolean;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly left?: boolean;
  readonly target?: number;
  readonly at?: MonacoApi.IPosition;
}

/**
 * A stand-in editor: its focus, the contribution behind ⌘-click, and the mouse listeners attached.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly calls: string[];
  readonly contribution: { gotoDefinition?: unknown; disposed: boolean } | null;
  press(click: Click): void;
  release(click: Click): void;
}

/**
 * Installs the navigation commands into a fake Monaco instance holding the given editors.
 * @param isMac Whether to install as macOS.
 * @param editors The editors the instance holds.
 * @returns Returns what the instance was asked to do.
 */
function install(isMac: boolean, editors: readonly MonacoApi.editor.ICodeEditor[]): Installed {
  let onCreate: ((editor: MonacoApi.editor.ICodeEditor) => void) | null = null;
  const installed: Installed = {
    rules: [],
    commands: new Map(),
    navigated: [],
    create: (editor: MonacoApi.editor.ICodeEditor): void => onCreate?.(editor),
  };
  const fake: typeof MonacoApi = {
    KeyMod: KEYS,
    KeyCode: { F12, KeyH: KEY_H },
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
  installNavigationCommands(
    fake,
    isMac,
    (editor: MonacoApi.editor.ICodeEditor, mode: NavigationMode): void =>
      void installed.navigated.push({ editor, mode }),
  );
  return installed;
}

/**
 * Builds a fake editor.
 * @param textFocus Whether its text holds the keyboard.
 * @param contribution The ⌘-click contribution it has: Monaco's, one without the navigation Studio
 * replaces, or none.
 * @returns Returns the editor and its recorders.
 */
function fakeEditor(
  textFocus: boolean = false,
  contribution: 'monaco' | 'unknown' | 'none' = 'monaco',
): FakeEditor {
  const calls: string[] = [];
  let down: ((event: MonacoApi.editor.IEditorMouseEvent) => void) | null = null;
  let up: ((event: MonacoApi.editor.IEditorMouseEvent) => void) | null = null;
  const link: { gotoDefinition?: unknown; disposed: boolean; dispose(): void } | null =
    contribution === 'none'
      ? null
      : {
          ...(contribution === 'monaco'
            ? {
                gotoDefinition: (): Promise<void> => {
                  calls.push("monaco's go to definition");
                  return Promise.resolve();
                },
              }
            : {}),
          disposed: false,
          dispose(): void {
            this.disposed = true;
          },
        };
  const eventOf: (click: Click) => MonacoApi.editor.IEditorMouseEvent = (
    click: Click,
  ): MonacoApi.editor.IEditorMouseEvent =>
    ({
      event: {
        leftButton: click.left ?? true,
        metaKey: click.meta === true,
        ctrlKey: click.ctrl === true,
        altKey: click.alt === true,
      },
      target: {
        type: click.target ?? TARGET.text,
        position: click.at ?? { lineNumber: 4, column: 9 },
      },
    }) as unknown as MonacoApi.editor.IEditorMouseEvent;
  const editor: unknown = {
    hasTextFocus: (): boolean => textFocus,
    hasWidgetFocus: (): boolean => textFocus,
    updateOptions: (options: MonacoApi.editor.IEditorOptions): void =>
      void calls.push(`options ${JSON.stringify(options)}`),
    getContribution: (id: string): unknown => (id === DEFINITION_LINK_CONTRIBUTION ? link : null),
    setPosition: (position: MonacoApi.IPosition): void =>
      void calls.push(`position ${position.lineNumber}:${position.column}`),
    onMouseDown: (listener: (event: MonacoApi.editor.IEditorMouseEvent) => void): void => {
      down = listener;
    },
    onMouseUp: (listener: (event: MonacoApi.editor.IEditorMouseEvent) => void): void => {
      up = listener;
    },
  };
  return {
    editor: editor as MonacoApi.editor.ICodeEditor,
    calls,
    contribution: link,
    press: (click: Click): void => down?.(eventOf(click)),
    release: (click: Click): void => up?.(eventOf(click)),
  };
}

describe('installNavigationCommands (#1014)', () => {
  const when: string = `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`;

  it('removesEveryChordOfMonacosDefinitionAndReferencesNavigation_onEveryPlatform', () => {
    for (const isMac of [true, false]) {
      const installed: Installed = install(isMac, []);

      const removals: string[] = installed.rules
        .filter(
          (rule: MonacoApi.editor.IKeybindingRule): boolean =>
            rule.command?.startsWith('-') === true,
        )
        .map((rule: MonacoApi.editor.IKeybindingRule): string => {
          expect(rule.keybinding).toBe(0);
          return rule.command ?? '';
        });
      expect(removals).toEqual(
        MONACO_NAVIGATION_COMMANDS.map((command: string): string => `-${command}`),
      );
      for (const command of [
        'editor.action.revealDefinition',
        'editor.action.peekDefinition',
        'editor.action.goToReferences',
        'editor.action.referenceSearch.trigger',
        'editor.action.peekImplementation',
        'editor.action.goToImplementation',
        'editor.action.peekTypeDefinition',
        'editor.action.goToTypeDefinition',
      ]) {
        expect(removals).toContain(`-${command}`);
      }
    }
  });

  it('bindsGoToDefinitionToF12_andFindReferencesToShiftF12_onEveryPlatform', () => {
    for (const isMac of [true, false]) {
      const installed: Installed = install(isMac, []);

      expect(installed.rules).toContainEqual({
        keybinding: F12,
        command: STUDIO_GO_TO_DEFINITION_COMMAND,
        when,
      });
      expect(installed.rules).toContainEqual({
        keybinding: KEYS.Shift | F12,
        command: STUDIO_FIND_REFERENCES_COMMAND,
        when,
      });
    }
  });

  it('bindsGoToImplementationToCmdF12_andLeavesTypeDefinitionUnbound_onEveryPlatform (#1142)', () => {
    for (const isMac of [true, false]) {
      const installed: Installed = install(isMac, []);

      expect(installed.rules).toContainEqual({
        keybinding: KEYS.CtrlCmd | F12,
        command: STUDIO_GO_TO_IMPLEMENTATION_COMMAND,
        when,
      });
      expect(
        installed.rules.some(
          (rule: MonacoApi.editor.IKeybindingRule): boolean =>
            rule.command === STUDIO_GO_TO_TYPE_DEFINITION_COMMAND,
        ),
      ).toBe(false);
    }
  });

  it('bindsTheHierarchiesToTheControlKey_withAltOrShiftH_onEveryPlatform (#1153)', () => {
    // ⌃ on a Mac is Monaco's WinCtrl; elsewhere Ctrl is its CtrlCmd.
    for (const [isMac, control] of [
      [true, KEYS.WinCtrl],
      [false, KEYS.CtrlCmd],
    ] as const) {
      const installed: Installed = install(isMac, []);

      expect(installed.rules).toContainEqual({
        keybinding: control | KEYS.Alt | KEY_H,
        command: STUDIO_CALL_HIERARCHY_COMMAND,
        when,
      });
      expect(installed.rules).toContainEqual({
        keybinding: control | KEYS.Shift | KEY_H,
        command: STUDIO_TYPE_HIERARCHY_COMMAND,
        when,
      });
    }
  });

  it('theCommands_handTheFocusedEditorOn_withTheirMode_andNothingWithoutFocus', () => {
    const idle: FakeEditor = fakeEditor(false);
    const focused: FakeEditor = fakeEditor(true);
    const installed: Installed = install(true, [idle.editor, focused.editor]);

    installed.commands.get(STUDIO_GO_TO_DEFINITION_COMMAND)?.();
    installed.commands.get(STUDIO_FIND_REFERENCES_COMMAND)?.();
    installed.commands.get(STUDIO_GO_TO_IMPLEMENTATION_COMMAND)?.();
    installed.commands.get(STUDIO_GO_TO_TYPE_DEFINITION_COMMAND)?.();
    installed.commands.get(STUDIO_CALL_HIERARCHY_COMMAND)?.();
    installed.commands.get(STUDIO_TYPE_HIERARCHY_COMMAND)?.();

    expect(installed.navigated).toEqual([
      { editor: focused.editor, mode: 'definition' },
      { editor: focused.editor, mode: 'references' },
      { editor: focused.editor, mode: 'implementation' },
      { editor: focused.editor, mode: 'typeDefinition' },
      { editor: focused.editor, mode: 'callHierarchy' },
      { editor: focused.editor, mode: 'typeHierarchy' },
    ]);
    const unfocused: Installed = install(false, [idle.editor]);
    unfocused.commands.get(STUDIO_GO_TO_DEFINITION_COMMAND)?.();
    expect(unfocused.navigated).toEqual([]);
  });

  it('aReferencesLens_placesItsDocumentsEditorAtTheSymbol_andListsItsReferences (#1149)', () => {
    const placed: unknown[] = [];
    const lensEditor: MonacoApi.editor.ICodeEditor = {
      getModel: (): unknown => ({ uri: { toString: (): string => 'inmemory://model/3' } }),
      setPosition: (position: unknown): void => void placed.push(position),
    } as unknown as MonacoApi.editor.ICodeEditor;
    const other: MonacoApi.editor.ICodeEditor = {
      getModel: (): unknown => ({ uri: { toString: (): string => 'inmemory://model/1' } }),
    } as unknown as MonacoApi.editor.ICodeEditor;
    const installed: Installed = install(true, [other, lensEditor]);
    const run: (...args: unknown[]) => void = installed.commands.get(
      STUDIO_REFERENCES_LENS_COMMAND,
    ) as unknown as (...args: unknown[]) => void;

    run(undefined, 'inmemory://model/3', { line: 8, character: 11 });
    run(undefined, 'inmemory://model/404', { line: 8, character: 11 });
    run(undefined, 'inmemory://model/3', 'not a position');

    expect(placed).toEqual([{ lineNumber: 9, column: 12 }]);
    expect(installed.navigated).toEqual([{ editor: lensEditor, mode: 'references' }]);
  });

  it('everyEditorCreated_neverPeeks_soSeveralAnswersGoToTheFirst', () => {
    const installed: Installed = install(true, []);
    const fake: FakeEditor = fakeEditor();

    installed.create(fake.editor);

    expect(fake.calls).toEqual([`options ${JSON.stringify(NAVIGATION_EDITOR_OPTIONS)}`]);
    expect(NAVIGATION_EDITOR_OPTIONS.definitionLinkOpensInPeek).toBe(false);
    expect(NAVIGATION_EDITOR_OPTIONS.gotoLocation).toEqual({
      multiple: 'goto',
      multipleDefinitions: 'goto',
      multipleTypeDefinitions: 'goto',
      multipleDeclarations: 'goto',
      multipleImplementations: 'goto',
      multipleReferences: 'goto',
    });
  });

  it('cmdClick_onMac_runsStudiosGoToDefinition_andMonacosOwnNavigationOpensNothing', async () => {
    const installed: Installed = install(true, []);
    const fake: FakeEditor = fakeEditor();
    installed.create(fake.editor);
    fake.calls.length = 0;

    fake.press({ meta: true, at: { lineNumber: 4, column: 9 } });
    fake.release({ meta: true, at: { lineNumber: 4, column: 9 } });
    // Monaco's own gesture still fires its navigation, which now goes nowhere.
    await (fake.contribution?.gotoDefinition as () => Promise<void>)();

    expect(installed.navigated).toEqual([{ editor: fake.editor, mode: 'definition' }]);
    expect(fake.calls).toEqual(['position 4:9']);
    // Ctrl is not the link modifier on macOS: Monaco keeps it for nothing, and Studio ignores it.
    fake.press({ ctrl: true });
    fake.release({ ctrl: true });
    expect(installed.navigated.length).toBe(1);
  });

  it('ctrlClick_onWindowsAndLinux_runsStudiosGoToDefinition', () => {
    const installed: Installed = install(false, []);
    const fake: FakeEditor = fakeEditor();
    installed.create(fake.editor);

    fake.press({ ctrl: true });
    fake.release({ ctrl: true });
    fake.press({ meta: true });
    fake.release({ meta: true });

    expect(installed.navigated).toEqual([{ editor: fake.editor, mode: 'definition' }]);
  });

  it('aDraggedPress_aPlainClick_altOrTheGutter_goNowhere', () => {
    const installed: Installed = install(true, []);
    const fake: FakeEditor = fakeEditor();
    installed.create(fake.editor);

    fake.press({ meta: true, at: { lineNumber: 4, column: 9 } });
    fake.release({ meta: true, at: { lineNumber: 6, column: 2 } });
    fake.press({});
    fake.release({});
    fake.press({ meta: true, alt: true });
    fake.release({ meta: true, alt: true });
    fake.press({ meta: true, target: TARGET.gutter });
    fake.release({ meta: true, target: TARGET.gutter });
    fake.press({ meta: true, left: false });
    fake.release({ meta: true, left: false });

    expect(installed.navigated).toEqual([]);
  });

  it('aContributionWithoutTheNavigation_isDisposed_soItsClickCanOpenNothing', () => {
    const installed: Installed = install(true, []);
    const unknown: FakeEditor = fakeEditor(false, 'unknown');
    const none: FakeEditor = fakeEditor(false, 'none');

    installed.create(unknown.editor);
    installed.create(none.editor);

    expect(unknown.contribution?.disposed).toBe(true);
    // Studio's own ⌘-click still works either way.
    none.press({ meta: true });
    none.release({ meta: true });
    expect(installed.navigated).toEqual([{ editor: none.editor, mode: 'definition' }]);
  });
});
