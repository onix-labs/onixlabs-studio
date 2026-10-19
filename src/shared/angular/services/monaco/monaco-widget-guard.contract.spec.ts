import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type * as MonacoApi from 'monaco-editor';
import { installFindCommands } from './monaco-find-commands';
import { installGoToCommands } from './monaco-goto-commands';
import { installNavigationCommands } from './monaco-navigation-commands';
import { installRenameCommands } from './monaco-rename-commands';
import { CODE_ACTION_CONTRIBUTION, installQuickFixCommands } from './monaco-quick-fix-commands';
import { installHoverCommands } from './monaco-hover-commands';
import {
  IDLE_PARAMETER_HINTS_PRESENTER,
  IDLE_SUGGEST_PRESENTER,
  installSuggestCommands,
} from './monaco-suggest-commands';
import {
  FIND_CONTRIBUTION,
  INLAY_HINTS_CONTRIBUTION,
  INLAY_HINTS_HOOKS,
  installWidgetGuard,
  MONACO_WIDGET_COMMANDS,
  READ_ONLY_MESSAGE_CONTRIBUTION,
  READ_ONLY_MESSAGE_HOOKS,
  UNUSUAL_LINE_TERMINATORS_CONTRIBUTION,
  UNUSUAL_LINE_TERMINATORS_HOOKS,
  STANDALONE_COLOR_PICKER_CONTRIBUTION,
  STANDALONE_COLOR_PICKER_HOOKS,
} from './monaco-widget-guard';

/**
 * The Monaco build the application loads at run time: `angular.json` copies it to `vs/`.
 */
const MONACO_BUILD: string = join(process.cwd(), 'node_modules/monaco-editor/min/vs');

/**
 * The same Monaco release's unminified modules, which the default keybindings are read from: the
 * build the application loads is minified, where a command's identifier is often a renamed variable.
 */
const MONACO_SOURCES: string = join(process.cwd(), 'node_modules/monaco-editor/esm/vs');

/**
 * Lists the commands Monaco binds a chord to by default that open no Monaco UI (#1024): each edits,
 * moves the caret or selection, scrolls or folds, or acts only inside a Monaco widget that nothing can
 * open any more, so it does nothing. A command Monaco binds by default that is neither here nor in
 * {@link MONACO_WIDGET_COMMANDS} fails the spec until someone decides which it is.
 */
const COMMANDS_THAT_OPEN_NOTHING: readonly (string | RegExp)[] = [
  // Editing, the caret, the selection, scrolling and folding.
  /^cursor[A-Z]/,
  /^delete(All|Word|WordPart)?(Left|Right)$/,
  /^scroll(Line|Page)(Up|Down)$/,
  /^editor\.(un)?fold/,
  /^editor\.toggleFold/,
  'editor.createFoldingRangeFromSelection',
  'editor.removeManualFoldingRanges',
  'tab',
  'outdent',
  'lineBreakInsert',
  'cancelSelection',
  'removeSecondaryCursors',
  'expandLineSelection',
  'undo',
  'redo',
  'editor.action.selectAll',
  'editor.action.clipboardCopyAction',
  'editor.action.clipboardCutAction',
  'editor.action.clipboardPasteAction',
  'editor.action.commentLine',
  'editor.action.addCommentLine',
  'editor.action.removeCommentLine',
  'editor.action.blockComment',
  'editor.action.copyLinesDownAction',
  'editor.action.copyLinesUpAction',
  'editor.action.moveLinesDownAction',
  'editor.action.moveLinesUpAction',
  'editor.action.deleteLines',
  'editor.action.indentLines',
  'editor.action.outdentLines',
  'editor.action.insertLineAfter',
  'editor.action.insertLineBefore',
  'editor.action.joinLines',
  'editor.action.transposeLetters',
  'editor.action.trimTrailingWhitespace',
  'editor.action.insertCursorAbove',
  'editor.action.insertCursorBelow',
  'editor.action.insertCursorAtEndOfEachLineSelected',
  'editor.action.jumpToBracket',
  'editor.action.removeBrackets',
  'editor.action.smartSelect.expand',
  'editor.action.smartSelect.shrink',
  'editor.action.setSelectionAnchor',
  'editor.action.selectFromAnchorToCursor',
  'editor.action.cancelSelectionAnchor',
  'editor.action.inPlaceReplace.up',
  'editor.action.inPlaceReplace.down',
  'editor.action.wordHighlight.next',
  'editor.action.wordHighlight.prev',
  'editor.action.formatDocument',
  'editor.action.formatSelection',
  'editor.action.linkedEditing',
  'cancelLinkedEditingInput',
  'cursorUndo',
  'editor.cancelOperation',
  'jumpToNextSnippetPlaceholder',
  'jumpToPrevSnippetPlaceholder',
  'leaveSnippet',
  // Tab completion inserts the best suggestion without a list.
  'insertBestCompletion',
  'insertNextSuggestion',
  'insertPrevSuggestion',
  // Tab moves focus, announced to a screen reader only: nothing is drawn.
  'editor.action.toggleTabFocusMode',
  // Multi-cursor: they flash the find options, which the guard takes over (see FIND_HOOKS).
  'editor.action.addSelectionToNextFindMatch',
  'editor.action.moveSelectionToNextFindMatch',
  'editor.action.selectHighlights',
  'editor.action.changeAll',
  // Inside the suggest list and the signature card, which Studio draws (#1021).
  'acceptSelectedSuggestion',
  'acceptAlternativeSelectedSuggestion',
  'hideSuggestWidget',
  'selectNextSuggestion',
  'selectPrevSuggestion',
  'selectNextPageSuggestion',
  'selectPrevPageSuggestion',
  'focusSuggestion',
  'toggleSuggestionDetails',
  'toggleExplainMode',
  'toggleSuggestionFocus',
  'suggestWidgetCopy',
  'closeParameterHints',
  'showNextParameterHint',
  'showPrevParameterHint',
  // Inside Monaco's rename box, code-action list, hover, peeks and quick input — none ever opens.
  'acceptRenameInput',
  'acceptRenameInputWithPreview',
  'cancelRenameInput',
  'focusNextRenameSuggestion',
  'focusPreviousRenameSuggestion',
  'acceptSelectedCodeAction',
  'previewSelectedCodeAction',
  'hideCodeActionWidget',
  'clearFilterCodeActionWidget',
  'selectNextCodeAction',
  'selectPrevCodeAction',
  'collapseSectionCodeAction',
  'expandSectionCodeAction',
  'toggleSectionCodeAction',
  /^editor\.action\.(scroll(Up|Down|Left|Right)|page(Up|Down)|goTo(Top|Bottom))Hover$/,
  'closeReferenceSearch',
  'goToNextReference',
  'goToPreviousReference',
  'openReferenceToSide',
  'revealReference',
  'togglePeekWidgetFocus',
  'closeMarkersNavigation',
  'history.showNext',
  'history.showPrevious',
  /^quickInput\./,
  // Inside the colour picker, inline suggestions, the paste and drop menus and the overlay message,
  // which the guard keeps from opening.
  'editor.action.hideColorPicker',
  'editor.action.insertColorWithStandaloneColorPicker',
  /^editor\.action\.inlineSuggest\.(commit|commitAlternativeAction|acceptNextWord|jump|hide)$/,
  'editor.hidePasteWidget',
  'editor.hideDropWidget',
  'leaveEditorMessage',
  // While the sticky scroll lines hold the keyboard: they move between those lines, drawing nothing.
  'editor.action.selectNextStickyScrollLine',
  'editor.action.selectPreviousStickyScrollLine',
  'editor.action.goToFocusedStickyScrollLine',
  'editor.action.selectEditor',
  // After Monaco's own navigation found several places, which Studio's navigation never runs.
  'editor.gotoNextSymbolFromResult',
  'editor.gotoNextSymbolFromResult.cancel',
  // Leaves a diff's compare-moved-code mode.
  'diffEditor.exitCompareMove',
];

/**
 * Lists the registrations whose identifier the scan cannot read, by file and expression: the column
 * selection chords (registered through a helper that takes the identifier — each is read where its
 * command is declared) and the fold-to-level chords (⌘K ⌘1 to ⌘K ⌘7), whose identifiers are built.
 */
const UNREADABLE_REGISTRATIONS: readonly string[] = [
  'editor/browser/coreCommands.js id',
  'editor/contrib/folding/browser/folding.js FoldLevelAction.ID(i)',
];

/**
 * What the scan of Monaco's modules found.
 */
interface DefaultChords {
  /**
   * Gets the commands bound to a chord by default, each with the module that binds it.
   */
  readonly bound: ReadonlyMap<string, string>;

  /**
   * Gets the registrations whose identifier could not be read, as `module expression`.
   */
  readonly unreadable: readonly string[];
}

/**
 * Lists every JavaScript file under a folder.
 * @param folder The folder.
 * @returns Returns the files' paths.
 */
function scripts(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(
    (entry: { name: string; isDirectory(): boolean }): string[] =>
      entry.isDirectory()
        ? scripts(join(folder, entry.name))
        : entry.name.endsWith('.js')
          ? [join(folder, entry.name)]
          : [],
  );
}

/**
 * Blanks out a source's comments and the insides of its string literals, keeping every offset, so
 * braces and keys can be matched without a label or a comment getting in the way.
 * @param source The source.
 * @returns Returns the masked source.
 */
function mask(source: string): string {
  let masked: string = '';
  let at: number = 0;
  while (at < source.length) {
    const char: string = source[at];
    const next: string | undefined = source[at + 1];
    if (char === '/' && (next === '*' || next === '/')) {
      const close: number =
        next === '*' ? source.indexOf('*/', at + 2) + 2 : source.indexOf('\n', at);
      const end: number = close < at ? source.length : close;
      masked += ' '.repeat(end - at);
      at = end;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      let end: number = at + 1;
      while (end < source.length && source[end] !== char) {
        end += source[end] === '\\' ? 2 : 1;
      }
      masked += char + '_'.repeat(Math.max(0, end - at - 1)) + char;
      at = end + 1;
      continue;
    }
    masked += char;
    at += 1;
  }
  return masked;
}

/**
 * The names a module gives its command identifiers.
 */
interface Names {
  /**
   * Gets the string constants, by name: `const NAME = '…'`, `Owner.ID = '…'`, and `.key` for an
   * object's `key: '…'`.
   */
  readonly strings: Map<string, string>;

  /**
   * Gets the expressions classes assign their static `ID` (or `id`), by `Class.ID`.
   */
  readonly statics: Map<string, string>;
}

/**
 * Reads the names a module gives string constants and its classes' identifiers.
 * @param source The module's source.
 * @returns Returns the names.
 */
function namesIn(source: string): Names {
  const strings: Map<string, string> = new Map<string, string>();
  const statics: Map<string, string> = new Map<string, string>();
  const keep: (name: string, value: string) => void = (name: string, value: string): void => {
    if (!strings.has(name)) {
      strings.set(name, value);
    }
  };
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*'([^']*)'/g)) {
    keep(match[1], match[2]);
  }
  for (const match of source.matchAll(/\b([\w$]+\.[\w$]+)\s*=\s*'([^']*)'/g)) {
    keep(match[1], match[2]);
  }
  for (const match of source.matchAll(/\b([\w$]+)\s*:\s*'([^']*)'/g)) {
    keep(`.${match[1]}`, match[2]);
  }
  for (const match of source.matchAll(/class\s+([\w$]+)/g)) {
    const body: string = source.slice(match.index, match.index + 3000);
    const assigned: RegExpMatchArray | null =
      /static\s*\{\s*this\.(ID|id)\s*=\s*([^;}]+?)\s*;?\s*\}/.exec(body);
    if (assigned !== null) {
      statics.set(`${match[1]}.${assigned[1]}`, assigned[2].trim());
    }
  }
  return { strings, statics };
}

/**
 * Reads the command identifier an expression names: a literal, a constant, a class's static `ID`, or
 * a key of a table of identifiers — in the module first, then in any module.
 * @param expression The expression.
 * @param local The module's names.
 * @param global Every module's names.
 * @param depth How many names have been followed to get here.
 * @returns Returns the identifier, or null when it cannot be read.
 */
function readIdentifier(
  expression: string,
  local: Names,
  global: Names,
  depth: number = 0,
): string | null {
  const literal: RegExpMatchArray | null = /^'([^']*)'$/.exec(expression);
  if (literal !== null) {
    return literal[1];
  }
  if (depth > 4) {
    return null;
  }
  for (const names of [local, global]) {
    const value: string | undefined = names.strings.get(expression);
    if (value !== undefined) {
      return value;
    }
  }
  for (const names of [local, global]) {
    const assigned: string | undefined = names.statics.get(expression);
    if (assigned !== undefined) {
      return readIdentifier(assigned, local, global, depth + 1);
    }
  }
  const key: RegExpMatchArray | null = /^[\w$]+\.([\w$]+)$/.exec(expression);
  if (key !== null) {
    for (const names of [local, global]) {
      const value: string | undefined = names.strings.get(`.${key[1]}`);
      if (value !== undefined) {
        return value;
      }
    }
  }
  return null;
}

/**
 * Finds the object literal an offset lies directly in.
 * @param masked The masked source.
 * @param at The offset.
 * @returns Returns the object's source, or an empty string when the offset is in none.
 */
function objectAround(masked: string, at: number): string {
  let depth: number = 0;
  let start: number = -1;
  for (let index: number = at; index >= 0; index -= 1) {
    if (masked[index] === '}') {
      depth += 1;
    } else if (masked[index] === '{') {
      if (depth === 0) {
        start = index;
        break;
      }
      depth -= 1;
    }
  }
  if (start < 0) {
    return '';
  }
  depth = 0;
  for (let index: number = start; index < masked.length; index += 1) {
    if (masked[index] === '{') {
      depth += 1;
    } else if (masked[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return masked.slice(start, index + 1);
      }
    }
  }
  return masked.slice(start);
}

/**
 * Reads every command Monaco binds a chord to by default: every registration — an editor action's
 * `kbOpts`, an action's `keybinding`, a keybinding rule — whose object holds a chord that is not zero.
 * @returns Returns the commands, and the registrations whose identifier could not be read.
 */
function readDefaultChords(): DefaultChords {
  const files: string[] = scripts(MONACO_SOURCES).filter(
    // The TypeScript compiler Monaco ships is a library, not the editor: it binds nothing.
    (file: string): boolean => !file.endsWith('typescriptServices.js'),
  );
  const sources: Map<string, string> = new Map<string, string>(
    files.map((file: string): [string, string] => [file, readFileSync(file, 'utf8')]),
  );
  const names: Map<string, Names> = new Map<string, Names>();
  const global: Names = { strings: new Map<string, string>(), statics: new Map<string, string>() };
  for (const [file, source] of sources) {
    const local: Names = namesIn(source);
    names.set(file, local);
    for (const [name, value] of local.strings) {
      if (!global.strings.has(name)) {
        global.strings.set(name, value);
      }
    }
    for (const [name, value] of local.statics) {
      if (!global.statics.has(name)) {
        global.statics.set(name, value);
      }
    }
  }
  const bound: Map<string, string> = new Map<string, string>();
  const unreadable: string[] = [];
  for (const [file, source] of sources) {
    if (!/\bprimary\s*:/.test(source)) {
      continue;
    }
    const masked: string = mask(source);
    const module: string = relative(MONACO_SOURCES, file).split('\\').join('/');
    for (const match of masked.matchAll(/[{,]\s*id\s*:\s*/g)) {
      // A chord of zero is no chord: `(?=\S)` keeps `\s*` from backing off to read ` 0` as a chord.
      if (
        !/\b(primary|secondary)\s*:\s*(?=\S)(?!0\b|undefined\b|\[\s*\])/.test(
          objectAround(masked, match.index),
        )
      ) {
        continue;
      }
      const expression: string = (
        /^([^,\n}]+)/.exec(source.slice(match.index + match[0].length))?.[1] ?? ''
      ).trim();
      const id: string | null = readIdentifier(expression, names.get(file)!, global);
      if (id === null) {
        unreadable.push(`${module} ${expression}`);
      } else {
        bound.set(id, module);
      }
    }
  }
  return { bound, unreadable };
}

/**
 * Collects the commands Studio's installers remove every chord of, on one platform: each installer
 * runs against a stand-in Monaco instance that records the keybinding rules it is given.
 * @param isMac Whether the host is macOS.
 * @returns Returns the commands.
 */
function removedByStudio(isMac: boolean): Set<string> {
  const rules: MonacoApi.editor.IKeybindingRule[] = [];
  // Any key modifier or code reads as a number; only the removals are read.
  const keys: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target: object, key: string | symbol): unknown =>
        key === 'chord' ? (first: number, second: number): number => first | (second << 16) : 1,
    },
  );
  const monaco: typeof MonacoApi = {
    KeyMod: keys,
    KeyCode: keys,
    editor: {
      getEditors: (): readonly MonacoApi.editor.ICodeEditor[] => [],
      registerCommand: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      addKeybindingRules: (added: MonacoApi.editor.IKeybindingRule[]): void =>
        void rules.push(...added),
      onDidCreateEditor: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
    },
  } as unknown as typeof MonacoApi;
  const ignore: () => void = (): void => undefined;
  installFindCommands(monaco, isMac, ignore);
  installGoToCommands(monaco, isMac, ignore);
  installNavigationCommands(monaco, isMac, ignore);
  installRenameCommands(monaco, ignore);
  installQuickFixCommands(monaco, ignore);
  installHoverCommands(monaco, { showHover: ignore, goToProblem: ignore, showProblem: ignore });
  installSuggestCommands(
    monaco,
    isMac,
    () => IDLE_SUGGEST_PRESENTER,
    () => IDLE_PARAMETER_HINTS_PRESENTER,
  );
  installWidgetGuard(monaco, {
    showContextMenu: ignore,
    readOnlyEdit: ignore,
    confirmUnusualLineTerminators: (): Promise<boolean> => Promise.resolve(false),
  });
  return new Set<string>(
    rules
      // Only a removal with no chord drops every chord the command has, on every platform.
      .filter(
        (rule: MonacoApi.editor.IKeybindingRule): boolean =>
          rule.keybinding === 0 && rule.command?.startsWith('-') === true,
      )
      .map((rule: MonacoApi.editor.IKeybindingRule): string => rule.command!.slice(1)),
  );
}

/**
 * Determines whether a command is known to open no Monaco UI.
 * @param command The command.
 * @returns Returns true when {@link COMMANDS_THAT_OPEN_NOTHING} lists it.
 */
function opensNothing(command: string): boolean {
  return COMMANDS_THAT_OPEN_NOTHING.some((entry: string | RegExp): boolean =>
    typeof entry === 'string' ? entry === command : entry.test(command),
  );
}

/**
 * Finds the file of Monaco's build that defines a contribution, and returns its source.
 * @param id The contribution's identifier.
 * @returns Returns the source, or an empty string when no file defines it.
 */
function buildDefining(id: string): string {
  for (const name of readdirSync(MONACO_BUILD)) {
    if (!name.endsWith('.js')) {
      continue;
    }
    const source: string = readFileSync(join(MONACO_BUILD, name), 'utf8');
    if (source.includes(`"${id}"`)) {
      return source;
    }
  }
  return '';
}

/**
 * Takes the class a contribution identifier is declared on out of a minified source: from the class
 * declaration nearest before the identifier to the identifier itself.
 * @param source The minified source.
 * @param id The contribution's identifier.
 * @returns Returns the class's source.
 */
function classBefore(source: string, id: string): string {
  const at: number = source.indexOf(`"${id}"`);
  const start: number = source.lastIndexOf('=class', at);
  return start < 0 || at < 0 ? '' : source.slice(start, at);
}

/**
 * Determines whether a minified class body has a method.
 * @param body The class's source.
 * @param method The method's name.
 * @returns Returns true when it does.
 */
function hasMethod(body: string, method: string): boolean {
  return new RegExp(`[;}]\\s*(?:async\\s+)?${method}\\(`).test(body);
}

/**
 * Guards that no chord of Monaco's opens Monaco-drawn UI (#1024). Monaco's default keybindings are read
 * from the release the application ships — not a stand-in — and Studio's installers are run to see
 * which chords they remove. The spec fails when a command that opens Monaco's UI is bound by default
 * and no installer removes its chords (a removal rule deleted), and when Monaco binds a command by
 * default that nobody has decided about (a Monaco upgrade, or a command dropped from the audited
 * list). It also guards the private members of Monaco's contributions the takeovers replace.
 */
describe('Monaco widget guard (#1024)', () => {
  const chords: DefaultChords = readDefaultChords();

  it('theScan_readsMonacosDefaultChords', () => {
    // A scan that read nothing would pass everything below.
    expect(chords.bound.size).toBeGreaterThan(200);
    for (const command of [
      'editor.action.showContextMenu',
      'editor.action.rename',
      'actions.find',
      'workbench.action.showHover',
      'editor.action.accessibleDiffViewer.next',
      'cursorDown',
    ]) {
      expect(chords.bound.has(command), command).toBe(true);
    }
    // Registered with no chord, or a chord of zero: not bound.
    for (const command of [
      'editor.action.inspectTokens',
      'editor.action.goToTypeDefinition',
      'editor.action.showOrFocusStandaloneColorPicker',
    ]) {
      expect(chords.bound.has(command), command).toBe(false);
    }
    expect(chords.unreadable).toEqual(UNREADABLE_REGISTRATIONS);
  });

  it('theBuildTheApplicationLoads_definesEveryCommandTheScanFound', () => {
    const build: string = readdirSync(MONACO_BUILD)
      .filter((name: string): boolean => name.endsWith('.js'))
      .map((name: string): string => readFileSync(join(MONACO_BUILD, name), 'utf8'))
      .join('\n');

    for (const command of chords.bound.keys()) {
      expect(build.includes(`"${command}"`), command).toBe(true);
    }
  });

  it.each([true, false])(
    'everyAuditedCommand_hasEveryChordRemovedByStudio_onMac=%s',
    (isMac: boolean) => {
      const removed: Set<string> = removedByStudio(isMac);

      for (const command of MONACO_WIDGET_COMMANDS) {
        expect(removed.has(command), command).toBe(true);
      }
    },
  );

  it('everyCommandMonacoBindsByDefault_opensMonacosUIAndIsRemoved_orOpensNothing', () => {
    const removed: Set<string> = removedByStudio(true);
    const widgets: ReadonlySet<string> = new Set<string>(MONACO_WIDGET_COMMANDS);

    const undecided: string[] = [...chords.bound.keys()].filter(
      (command: string): boolean => !widgets.has(command) && !opensNothing(command),
    );
    const stillBound: string[] = [...chords.bound.keys()].filter(
      (command: string): boolean => widgets.has(command) && !removed.has(command),
    );

    expect(undecided).toEqual([]);
    expect(stillBound).toEqual([]);
    for (const command of MONACO_WIDGET_COMMANDS) {
      expect(opensNothing(command), command).toBe(false);
    }
  });

  it('theCodeActionContribution_stillHasTheTriggerAndTheLightbulbTheTakeoverReplaces', () => {
    const body: string = classBefore(
      buildDefining(CODE_ACTION_CONTRIBUTION),
      CODE_ACTION_CONTRIBUTION,
    );

    expect(hasMethod(body, '_trigger')).toBe(true);
    expect(body.includes('this._lightBulbWidget=new ')).toBe(true);
  });

  it.each([
    [STANDALONE_COLOR_PICKER_CONTRIBUTION, STANDALONE_COLOR_PICKER_HOOKS],
    [INLAY_HINTS_CONTRIBUTION, INLAY_HINTS_HOOKS],
    [READ_ONLY_MESSAGE_CONTRIBUTION, READ_ONLY_MESSAGE_HOOKS],
    [UNUSUAL_LINE_TERMINATORS_CONTRIBUTION, UNUSUAL_LINE_TERMINATORS_HOOKS],
  ])('%s_stillHasEveryMethodTheGuardReplaces', (id: string, hooks: readonly string[]) => {
    const body: string = classBefore(buildDefining(id), id);

    expect(body.length).toBeGreaterThan(0);
    for (const hook of hooks) {
      expect(hasMethod(body, hook), hook).toBe(true);
    }
  });

  it('theFindContribution_stillBuildsItsWidgetToFlashItsOptions_whereTheGuardReplacesIt', () => {
    // The method is overridden on the find contribution's subclass, which the build declares apart
    // from the identifier: the override is found by what it does.
    expect(
      /highlightFindOptions\([^)]*\)\{this\._widget\|\|this\._createFindWidget\(\)/.test(
        buildDefining(FIND_CONTRIBUTION),
      ),
    ).toBe(true);
  });

  it('theContributionsTheGuardReplaces_stillReadWhatItsReplacementsRead', () => {
    const readOnly: string = classBefore(
      buildDefining(READ_ONLY_MESSAGE_CONTRIBUTION),
      READ_ONLY_MESSAGE_CONTRIBUTION,
    );
    const terminators: string = classBefore(
      buildDefining(UNUSUAL_LINE_TERMINATORS_CONTRIBUTION),
      UNUSUAL_LINE_TERMINATORS_CONTRIBUTION,
    );
    // The text model lives in another file of the build than the contribution.
    const build: string = readdirSync(MONACO_BUILD)
      .filter((name: string): boolean => name.endsWith('.js'))
      .map((name: string): string => readFileSync(join(MONACO_BUILD, name), 'utf8'))
      .join('\n');

    // The read-only message's editor, and the line terminators check's editor, option and flag.
    expect(readOnly.includes('this.editor=')).toBe(true);
    for (const field of ['this._editor=', 'this._config=', 'this._isPresentingDialog=']) {
      expect(terminators.includes(field), field).toBe(true);
    }
    // The model's own check and removal, which the replacement calls.
    expect(/[;}]\s*mightContainUnusualLineTerminators\(\)\{/.test(build)).toBe(true);
    expect(/[;}]\s*removeUnusualLineTerminators\([^)]*\)\{/.test(build)).toBe(true);
  });

  it('theEndToEndSuitesCopyOfTheAuditedCommands_isInStep', () => {
    // The end-to-end suite compiles on its own, so it keeps a copy of the list rather than importing it.
    const copy: string = readFileSync(join(process.cwd(), 'e2e/editor-widgets.e2e.ts'), 'utf8');
    const listed: string[] = [
      ...(
        /MONACO_WIDGET_COMMANDS: readonly string\[\] = \[([^\]]*)\]/.exec(copy)?.[1] ?? ''
      ).matchAll(/'([^']+)'/g),
    ].map((match: RegExpMatchArray): string => match[1]);

    expect([...listed].sort()).toEqual([...MONACO_WIDGET_COMMANDS].sort());
  });
});
