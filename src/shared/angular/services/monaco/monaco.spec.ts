import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { FindMode } from '@shared/angular/components/find-panel/find-request';
import type { GoToMode } from '@shared/angular/services/go-to/go-to-model';

import { buildHeuristicSemanticTokens, MonarchToken, Monaco } from './monaco';
import {
  FIND_PASSTHROUGH_CONTEXT_KEY,
  installFindCommands,
  MONACO_FIND_COMMANDS,
  STUDIO_FIND_COMMAND,
  STUDIO_FIND_REPLACE_COMMAND,
} from './monaco-find-commands';
import {
  installGoToCommands,
  MONACO_GOTO_COMMANDS,
  STUDIO_GO_TO_LINE_COMMAND,
  STUDIO_GO_TO_SYMBOL_COMMAND,
} from './monaco-goto-commands';

/**
 * A decoded semantic token, for readable assertions.
 */
interface DecodedToken {
  readonly deltaLine: number;
  readonly deltaChar: number;
  readonly length: number;
  readonly type: number;
}

/**
 * Decodes Monaco's delta-packed semantic-token array into one record per token.
 * @param data The packed token data (groups of five integers).
 * @returns Returns the decoded tokens.
 */
function decodeTokens(data: Uint32Array): readonly DecodedToken[] {
  const tokens: DecodedToken[] = [];
  for (let i: number = 0; i + 4 < data.length; i += 5) {
    tokens.push({
      deltaLine: data[i],
      deltaChar: data[i + 1],
      length: data[i + 2],
      type: data[i + 3],
    });
  }
  return tokens;
}

/**
 * Builds a single Monarch token line that classifies the whole line as one scope, used to mark a
 * line as a string/comment/keyword the heuristic should skip.
 * @param type The Monarch scope name.
 * @returns Returns the one-token line.
 */
function wholeLineAs(type: string): MonarchToken[] {
  return [{ offset: 0, type }];
}

describe('Monaco', () => {
  let monaco: Monaco;

  beforeEach(() => {
    monaco = TestBed.inject(Monaco);
  });

  it('getLanguageForExtension_whenKnownExtension_returnsLanguage', () => {
    expect(monaco.getLanguageForExtension('.ts')).toBe('typescript');
  });

  it('getLanguageForExtension_whenNoLeadingDot_returnsLanguage', () => {
    expect(monaco.getLanguageForExtension('md')).toBe('markdown');
  });

  it('getLanguageForExtension_whenMixedCase_returnsLanguage', () => {
    expect(monaco.getLanguageForExtension('.JSON')).toBe('json');
  });

  it('getLanguageForExtension_whenUnknownExtension_returnsPlaintext', () => {
    expect(monaco.getLanguageForExtension('.unknown')).toBe('plaintext');
  });

  it('getLanguageForFileName_whenTheNameIsTheType_returnsLanguage', () => {
    // `Dockerfile` is the canonical spelling and carries no extension, so an extension-only lookup
    // calls it plaintext — which would mean the editor never asks for a Dockerfile language server.
    expect(monaco.getLanguageForFileName('Dockerfile')).toBe('dockerfile');
    expect(monaco.getLanguageForFileName('dockerfile')).toBe('dockerfile');
    expect(monaco.getLanguageForFileName('Containerfile')).toBe('dockerfile');
  });

  it('getLanguageForFileName_whenGivenAPath_readsTheFileNameFromIt', () => {
    expect(monaco.getLanguageForFileName('/src/docker/Dockerfile')).toBe('dockerfile');
    expect(monaco.getLanguageForFileName('C:\\build\\Dockerfile')).toBe('dockerfile');
  });

  it('getLanguageForFileName_whenNamedByExtension_stillResolves', () => {
    expect(monaco.getLanguageForFileName('main.ts')).toBe('typescript');
    expect(monaco.getLanguageForFileName('web.prod.dockerfile')).toBe('dockerfile');
  });

  it('getLanguageForFileName_whenADotfile_doesNotTreatTheNameAsAnExtension', () => {
    // A leading dot is the whole name, not an extension: `.gitignore` is not a `gitignore` file.
    expect(monaco.getLanguageForFileName('.gitignore')).toBe('plaintext');
  });

  it('getLanguageForFileName_whenUnknown_returnsPlaintext', () => {
    expect(monaco.getLanguageForFileName('LICENSE')).toBe('plaintext');
  });

  it('getSupportedLanguages_whenCalled_returnsSortedNonEmptyList', () => {
    const names: readonly string[] = monaco
      .getSupportedLanguages()
      .map((info): string => info.name);
    expect(names.length).toBeGreaterThan(0);
    expect([...names]).toEqual(
      [...names].sort((a: string, b: string): number => a.localeCompare(b)),
    );
  });

  it('getEditorOptions_turnsMonacosRightClickMenuOff', () => {
    // #1009: Monaco's menu offers its own Go to Symbol and Command Palette, so it is off everywhere
    // until Studio draws its own (#946 phase 3).
    expect(monaco.getEditorOptions('typescript').contextmenu).toBe(false);
  });

  it('getDiffEditorOptions_turnsMonacosRightClickMenuOff', () => {
    expect(monaco.getDiffEditorOptions().contextmenu).toBe(false);
  });

  it('editorAndDiffOptions_neverPeek_soSeveralAnswersGoToTheFirst', () => {
    // #1014: no chord, click or menu ever opens Monaco's peek widget.
    for (const options of [monaco.getEditorOptions('typescript'), monaco.getDiffEditorOptions()]) {
      expect(options.definitionLinkOpensInPeek).toBe(false);
      expect(options.gotoLocation).toMatchObject({
        multiple: 'goto',
        multipleDefinitions: 'goto',
        multipleReferences: 'goto',
        multipleImplementations: 'goto',
        multipleTypeDefinitions: 'goto',
        multipleDeclarations: 'goto',
      });
    }
  });

  it('getThemeName_whenOutline_returnsOutlineThemeForResolvedMode', () => {
    expect(monaco.getThemeName('outline')).toMatch(/^onix-(light|dark)-outline$/);
  });

  it('getThemeName_whenFilled_returnsFilledThemeForResolvedMode', () => {
    expect(monaco.getThemeName('filled')).toMatch(/^onix-(light|dark)-filled$/);
  });

  describe('suppressBuiltInDiagnostics', () => {
    /**
     * Stand-in stylesheet language defaults.
     */
    interface StylesheetDefaults {
      options: Record<string, unknown>;
      setOptions: (options: Record<string, unknown>) => void;
    }

    /**
     * Builds stand-in stylesheet defaults that record the options they are given.
     * @returns Returns the defaults.
     */
    function stylesheetDefaults(): StylesheetDefaults {
      const defaults: StylesheetDefaults = {
        options: { validate: true, lint: { zeroUnits: 'warning' } },
        setOptions: (options: Record<string, unknown>): void => {
          defaults.options = options;
        },
      };
      return defaults;
    }

    let css: Record<string, StylesheetDefaults>;
    let loaded: Window['monaco'];

    beforeEach(() => {
      loaded = window.monaco;
      css = {
        cssDefaults: stylesheetDefaults(),
        scssDefaults: stylesheetDefaults(),
        lessDefaults: stylesheetDefaults(),
      };
      window.monaco = { languages: { css } } as unknown as Window['monaco'];
    });

    afterEach(() => {
      window.monaco = loaded;
    });

    it('suppressBuiltInDiagnostics_whenAStylesheetLanguage_turnsOffOnlyItsValidation', () => {
      monaco.suppressBuiltInDiagnostics('scss');

      expect(css['scssDefaults'].options).toEqual({
        validate: false,
        lint: { zeroUnits: 'warning' },
      });
      expect(css['cssDefaults'].options['validate']).toBe(true);
      expect(css['lessDefaults'].options['validate']).toBe(true);
    });

    it('suppressBuiltInDiagnostics_whenLess_turnsOffLessValidation', () => {
      monaco.suppressBuiltInDiagnostics('less');

      expect(css['lessDefaults'].options['validate']).toBe(false);
    });

    it('suppressBuiltInDiagnostics_whenNoBuiltInWorker_changesNothing', () => {
      expect(() => monaco.suppressBuiltInDiagnostics('python')).not.toThrow();
      expect(css['cssDefaults'].options['validate']).toBe(true);
    });
  });
});

describe('buildHeuristicSemanticTokens', () => {
  // The legend is [type, function], so 0 is a type token and 1 is a function token.
  const TYPE: number = 0;
  const FUNCTION: number = 1;

  it('whenPascalCaseIdentifier_emitsTypeToken', () => {
    const tokens: readonly DecodedToken[] = decodeTokens(
      buildHeuristicSemanticTokens('Customer value', [[]]),
    );
    expect(tokens).toEqual([{ deltaLine: 0, deltaChar: 0, length: 8, type: TYPE }]);
  });

  it('whenIdentifierFollowedByParen_emitsFunctionToken', () => {
    const tokens: readonly DecodedToken[] = decodeTokens(
      buildHeuristicSemanticTokens('compute()', [[]]),
    );
    expect(tokens).toEqual([{ deltaLine: 0, deltaChar: 0, length: 7, type: FUNCTION }]);
  });

  it('whenLowercaseNonCallIdentifier_emitsNothing', () => {
    expect(buildHeuristicSemanticTokens('total value', [[]]).length).toBe(0);
  });

  it('whenSingleUppercaseLetter_emitsNothing', () => {
    expect(buildHeuristicSemanticTokens('T value', [[]]).length).toBe(0);
  });

  it('whenIdentifierInsideCommentOrString_skipsIt', () => {
    expect(buildHeuristicSemanticTokens('Customer thing', [wholeLineAs('comment.cs')]).length).toBe(
      0,
    );
    expect(buildHeuristicSemanticTokens('Customer thing', [wholeLineAs('string.cs')]).length).toBe(
      0,
    );
  });

  it('whenTokensSpanLines_deltaEncodesPositions', () => {
    const tokens: readonly DecodedToken[] = decodeTokens(
      buildHeuristicSemanticTokens('Alpha\nBeta', [[], []]),
    );
    expect(tokens).toEqual([
      { deltaLine: 0, deltaChar: 0, length: 5, type: TYPE },
      { deltaLine: 1, deltaChar: 0, length: 4, type: TYPE },
    ]);
  });
});

describe('installFindCommands', () => {
  /**
   * What a fake Monaco instance was asked to do.
   */
  interface Installed {
    readonly rules: MonacoApi.editor.IKeybindingRule[];
    readonly commands: Map<string, () => void>;
    readonly found: { editor: MonacoApi.editor.ICodeEditor; mode: FindMode }[];
  }

  /**
   * Installs the find commands into a fake Monaco instance holding the given editors.
   * @param isMac Whether to install as macOS.
   * @param editors The editors the instance holds.
   * @returns Returns what the instance was asked to do.
   */
  function install(isMac: boolean, editors: readonly MonacoApi.editor.ICodeEditor[]): Installed {
    const installed: Installed = { rules: [], commands: new Map(), found: [] };
    const fake: typeof MonacoApi = {
      KeyMod: { CtrlCmd: 2048, Alt: 512 },
      KeyCode: { KeyF: 36, KeyH: 38 },
      editor: {
        getEditors: (): readonly MonacoApi.editor.ICodeEditor[] => editors,
        registerCommand: (id: string, handler: () => void): void =>
          void installed.commands.set(id, handler),
        addKeybindingRules: (rules: MonacoApi.editor.IKeybindingRule[]): void =>
          void installed.rules.push(...rules),
      },
    } as unknown as typeof MonacoApi;
    installFindCommands(fake, isMac, (editor: MonacoApi.editor.ICodeEditor, mode: FindMode) =>
      installed.found.push({ editor, mode }),
    );
    return installed;
  }

  /**
   * Builds a fake editor with the given focus.
   * @param textFocus Whether its text holds the keyboard.
   * @returns Returns the editor.
   */
  function editorWith(textFocus: boolean): MonacoApi.editor.ICodeEditor {
    return {
      hasTextFocus: (): boolean => textFocus,
      hasWidgetFocus: (): boolean => textFocus,
    } as unknown as MonacoApi.editor.ICodeEditor;
  }

  it('removesEveryChordOfEveryFindWidgetCommand_onEveryPlatform', () => {
    // #1007: a removal with no chord drops all of a command's chords, so F3, ⌘G, ⌘E, ⌘H and the
    // rest go together with ⌘F and ⌘⌥F, whichever platform Monaco is running on.
    const installed: Installed = install(true, []);

    const removals: MonacoApi.editor.IKeybindingRule[] = installed.rules.filter(
      (rule: MonacoApi.editor.IKeybindingRule): boolean => rule.command?.startsWith('-') === true,
    );
    expect(removals.map((rule: MonacoApi.editor.IKeybindingRule) => rule.command)).toEqual(
      MONACO_FIND_COMMANDS.map((command: string): string => `-${command}`),
    );
    expect(removals.every((rule: MonacoApi.editor.IKeybindingRule) => rule.keybinding === 0)).toBe(
      true,
    );
    for (const opener of [
      'actions.find',
      'actions.findWithSelection',
      'editor.action.startFindReplaceAction',
      'editor.action.nextMatchFindAction',
      'editor.action.previousMatchFindAction',
      'editor.action.nextSelectionMatchFindAction',
      'editor.action.previousSelectionMatchFindAction',
    ]) {
      expect(MONACO_FIND_COMMANDS).toContain(opener);
    }
  });

  it('bindsStudioFindToModF_andReplaceToModAltF_onMac', () => {
    const installed: Installed = install(true, []);

    expect(installed.rules).toContainEqual({
      keybinding: 2048 | 36,
      command: STUDIO_FIND_COMMAND,
      when: `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`,
    });
    expect(installed.rules).toContainEqual({
      keybinding: 2048 | 512 | 36,
      command: STUDIO_FIND_REPLACE_COMMAND,
      when: `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`,
    });
  });

  it('bindsStudioReplaceToCtrlH_onWindowsAndLinux', () => {
    const installed: Installed = install(false, []);

    expect(installed.rules).toContainEqual({
      keybinding: 2048 | 38,
      command: STUDIO_FIND_REPLACE_COMMAND,
      when: `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`,
    });
  });

  it('theCommands_handTheFocusedEditorOn_withTheirMode', () => {
    const idle: MonacoApi.editor.ICodeEditor = editorWith(false);
    const focused: MonacoApi.editor.ICodeEditor = editorWith(true);
    const installed: Installed = install(true, [idle, focused]);

    installed.commands.get(STUDIO_FIND_COMMAND)?.();
    installed.commands.get(STUDIO_FIND_REPLACE_COMMAND)?.();

    expect(installed.found).toEqual([
      { editor: focused, mode: 'find' },
      { editor: focused, mode: 'replace' },
    ]);
  });

  it('theCommands_doNothing_whenNoEditorHasFocus', () => {
    const installed: Installed = install(true, [editorWith(false)]);

    installed.commands.get(STUDIO_FIND_COMMAND)?.();

    expect(installed.found).toEqual([]);
  });
});

describe('installGoToCommands', () => {
  /**
   * What a fake Monaco instance was asked to do.
   */
  interface Installed {
    readonly rules: MonacoApi.editor.IKeybindingRule[];
    readonly commands: Map<string, () => void>;
    readonly opened: { editor: MonacoApi.editor.ICodeEditor; mode: GoToMode }[];
  }

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
   * Installs the go-to commands into a fake Monaco instance holding the given editors.
   * @param isMac Whether to install as macOS.
   * @param editors The editors the instance holds.
   * @returns Returns what the instance was asked to do.
   */
  function install(isMac: boolean, editors: readonly MonacoApi.editor.ICodeEditor[]): Installed {
    const installed: Installed = { rules: [], commands: new Map(), opened: [] };
    const fake: typeof MonacoApi = {
      KeyMod: KEYS,
      KeyCode: { KeyG: 37, KeyO: 45 },
      editor: {
        getEditors: (): readonly MonacoApi.editor.ICodeEditor[] => editors,
        registerCommand: (id: string, handler: () => void): void =>
          void installed.commands.set(id, handler),
        addKeybindingRules: (rules: MonacoApi.editor.IKeybindingRule[]): void =>
          void installed.rules.push(...rules),
      },
    } as unknown as typeof MonacoApi;
    installGoToCommands(fake, isMac, (editor: MonacoApi.editor.ICodeEditor, mode: GoToMode) =>
      installed.opened.push({ editor, mode }),
    );
    return installed;
  }

  /**
   * Builds a fake editor with the given focus.
   * @param textFocus Whether its text holds the keyboard.
   * @returns Returns the editor.
   */
  function editorWith(textFocus: boolean): MonacoApi.editor.ICodeEditor {
    return {
      hasTextFocus: (): boolean => textFocus,
      hasWidgetFocus: (): boolean => textFocus,
    } as unknown as MonacoApi.editor.ICodeEditor;
  }

  const when: string = `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`;

  it('removesEveryChordOfMonacosQuickOutlineGoToLineAndGoToOffset_onEveryPlatform', () => {
    for (const isMac of [true, false]) {
      const installed: Installed = install(isMac, []);

      const removals: MonacoApi.editor.IKeybindingRule[] = installed.rules.filter(
        (rule: MonacoApi.editor.IKeybindingRule): boolean => rule.command?.startsWith('-') === true,
      );
      expect(removals).toEqual([
        { keybinding: 0, command: '-editor.action.quickOutline' },
        { keybinding: 0, command: '-editor.action.gotoLine' },
        { keybinding: 0, command: '-editor.action.gotoOffset' },
      ]);
      expect(MONACO_GOTO_COMMANDS).toHaveLength(3);
    }
  });

  it('bindsGoToSymbolToCmdShiftO_andGoToLineToControlG_onMac', () => {
    const installed: Installed = install(true, []);

    expect(installed.rules).toContainEqual({
      keybinding: KEYS.CtrlCmd | KEYS.Shift | 45,
      command: STUDIO_GO_TO_SYMBOL_COMMAND,
      when,
    });
    // ⌃G is the Control key on macOS, which Monaco names WinCtrl — not ⌘G.
    expect(installed.rules).toContainEqual({
      keybinding: KEYS.WinCtrl | 37,
      command: STUDIO_GO_TO_LINE_COMMAND,
      when,
    });
  });

  it('bindsGoToSymbolToCtrlShiftO_andGoToLineToCtrlG_onWindowsAndLinux', () => {
    const installed: Installed = install(false, []);

    expect(installed.rules).toContainEqual({
      keybinding: KEYS.CtrlCmd | KEYS.Shift | 45,
      command: STUDIO_GO_TO_SYMBOL_COMMAND,
      when,
    });
    expect(installed.rules).toContainEqual({
      keybinding: KEYS.CtrlCmd | 37,
      command: STUDIO_GO_TO_LINE_COMMAND,
      when,
    });
  });

  it('theCommands_handTheFocusedEditorOn_withTheirMode', () => {
    const idle: MonacoApi.editor.ICodeEditor = editorWith(false);
    const focused: MonacoApi.editor.ICodeEditor = editorWith(true);
    const installed: Installed = install(true, [idle, focused]);

    installed.commands.get(STUDIO_GO_TO_SYMBOL_COMMAND)?.();
    installed.commands.get(STUDIO_GO_TO_LINE_COMMAND)?.();

    expect(installed.opened).toEqual([
      { editor: focused, mode: 'symbol' },
      { editor: focused, mode: 'line' },
    ]);
  });

  it('theCommands_doNothing_whenNoEditorHasFocus', () => {
    const installed: Installed = install(false, [editorWith(false)]);

    installed.commands.get(STUDIO_GO_TO_LINE_COMMAND)?.();

    expect(installed.opened).toEqual([]);
  });
});
