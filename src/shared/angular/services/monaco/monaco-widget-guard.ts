import type * as MonacoApi from 'monaco-editor';
import {
  FIND_PASSTHROUGH_CONTEXT_KEY,
  focusedEditor,
  MONACO_FIND_COMMANDS,
} from './monaco-find-commands';
import { MONACO_GOTO_COMMANDS } from './monaco-goto-commands';
import { MONACO_NAVIGATION_COMMANDS } from './monaco-navigation-commands';
import { MONACO_RENAME_COMMAND } from './monaco-rename-commands';
import { MONACO_CODE_ACTION_COMMANDS } from './monaco-quick-fix-commands';
import { MONACO_MARKER_COMMANDS, MONACO_SHOW_HOVER_COMMAND } from './monaco-hover-commands';
import {
  MONACO_TRIGGER_PARAMETER_HINTS_COMMAND,
  MONACO_TRIGGER_SUGGEST_COMMAND,
} from './monaco-suggest-commands';

/**
 * Names Monaco's Show Editor Context Menu action, which opens Monaco's right-click menu at the caret
 * (⇧F10). Its chord is removed, on every platform; Studio's right-click menu takes it instead.
 */
export const MONACO_SHOW_CONTEXT_MENU_COMMAND: string = 'editor.action.showContextMenu';

/**
 * Lists the Monaco commands whose every route opens Monaco-drawn UI and which no earlier phase of
 * #946 took over (#1024). Each has all of its default chords removed, on every platform — those Monaco
 * 0.57 binds by default, and those it binds none for, so a Monaco upgrade that gives one a chord finds
 * it already gone. Only Show Editor Context Menu has a Studio equivalent, which takes its chord.
 */
export const MONACO_WIDGET_GUARD_COMMANDS: readonly string[] = [
  // ⇧F10: Monaco's right-click menu.
  MONACO_SHOW_CONTEXT_MENU_COMMAND,
  // ⌘K ⌘I (Ctrl+K Ctrl+I) where Studio's Show Hover does not answer — a markdown code fence: Monaco's
  // hover for whatever element holds the keyboard.
  'workbench.action.showHover',
  // F7 / ⇧F7 in a diff: Monaco's accessible diff viewer, drawn over the diff.
  'editor.action.accessibleDiffViewer.next',
  'editor.action.accessibleDiffViewer.prev',
  // ⌥] / ⌥[ and the trigger: inline suggestions, with Monaco's toolbar over them.
  'editor.action.inlineSuggest.trigger',
  'editor.action.inlineSuggest.showNext',
  'editor.action.inlineSuggest.showPrevious',
  // ⌘. (Ctrl+.) just after a paste or a drop: Monaco's "paste as" and "drop as" menus.
  'editor.changePasteType',
  'editor.changeDropType',
  // Bound to nothing in Monaco 0.57; reachable only by name, as the command palette did.
  'editor.action.showOrFocusStandaloneColorPicker',
  'editor.action.showDefinitionPreviewHover',
  'editor.action.inspectTokens',
  'editor.action.showReferences',
  'editor.action.peekLocations',
  // Not in Monaco 0.57's build at all (⌥F1 is bound to nothing), but bound by default in the builds
  // that have them: the accessibility help and the accessible view.
  'editor.action.showAccessibilityHelp',
  'editor.action.accessibilityHelp',
  'editor.action.accessibleView',
];

/**
 * Lists every Monaco command whose chord opens Monaco-drawn UI — a widget, a peek, a quick-input box,
 * a menu or an overlay — across every phase of #946: find (#1007), go-to (#1009), navigation (#1014),
 * rename (#1015), code actions (#1016), hover and problems (#1020), suggest and parameter hints
 * (#1021), and the rest (#1024). Every one has all of its chords removed by Studio's installers; a spec
 * reads Monaco's build and fails when one of these is bound by default and no installer removes it, or
 * when Monaco binds a command by default that is neither listed here nor known to open nothing.
 */
export const MONACO_WIDGET_COMMANDS: readonly string[] = [
  ...MONACO_FIND_COMMANDS,
  ...MONACO_GOTO_COMMANDS,
  ...MONACO_NAVIGATION_COMMANDS,
  MONACO_RENAME_COMMAND,
  ...MONACO_CODE_ACTION_COMMANDS,
  MONACO_SHOW_HOVER_COMMAND,
  ...MONACO_MARKER_COMMANDS,
  MONACO_TRIGGER_SUGGEST_COMMAND,
  MONACO_TRIGGER_PARAMETER_HINTS_COMMAND,
  ...MONACO_WIDGET_GUARD_COMMANDS,
];

/**
 * Names Studio's Show Context Menu command, bound to ⇧F10 (Shift+F10) in every editor: Studio's
 * right-click menu, at the caret.
 */
export const STUDIO_SHOW_CONTEXT_MENU_COMMAND: string = 'studio.showContextMenu';

/**
 * Names the editor contribution behind Monaco's standalone colour picker, which builds the picker when
 * its show command runs.
 */
export const STANDALONE_COLOR_PICKER_CONTRIBUTION: string =
  'editor.contrib.standaloneColorPickerController';

/**
 * Lists the members of Monaco's standalone colour picker contribution the guard replaces.
 */
export const STANDALONE_COLOR_PICKER_HOOKS: readonly string[] = ['showOrFocus'];

/**
 * Names the editor contribution behind Monaco's click route into its colour picker: a click on a
 * colour swatch opens Monaco's hover with the picker in it, but only while the editor's
 * `colorDecoratorsActivatedOn` option is `click` or `clickAndHover` — never under the guard's `hover`.
 */
export const COLOR_CLICK_CONTRIBUTION: string = 'editor.contrib.colorContribution';

/**
 * Names the class Monaco gives a colour swatch: the box its colour decorator draws, as text injected
 * before a colour value, for every language with a document-colour provider. Studio's colour picker
 * (#1025) answers a click on it.
 */
export const COLOUR_SWATCH_CLASS: string = 'colorpicker-color-decoration';

/**
 * Names the editor contribution behind Monaco's find widget. Studio's find panel replaced the widget
 * (#1007), but the multi-cursor chords — ⌘D (Ctrl+D) and the rest — still ask it to flash its options,
 * which builds the find widget and its options strip into the editor.
 */
export const FIND_CONTRIBUTION: string = 'editor.contrib.findController';

/**
 * Lists the members of Monaco's find contribution the guard replaces.
 */
export const FIND_HOOKS: readonly string[] = ['highlightFindOptions'];

/**
 * Names the editor contribution behind inlay hints, whose right-click on a hint that points somewhere
 * opens Monaco's own menu of places to go.
 */
export const INLAY_HINTS_CONTRIBUTION: string = 'editor.contrib.InlayHints';

/**
 * Lists the members of Monaco's inlay hints contribution the guard replaces.
 */
export const INLAY_HINTS_HOOKS: readonly string[] = ['_installContextMenu'];

/**
 * Names the editor contribution that answers an attempt to type into a read-only editor with Monaco's
 * overlay message ("Cannot edit in read-only editor").
 */
export const READ_ONLY_MESSAGE_CONTRIBUTION: string = 'editor.contrib.readOnlyMessageController';

/**
 * Lists the members of Monaco's read-only message contribution the guard replaces.
 */
export const READ_ONLY_MESSAGE_HOOKS: readonly string[] = ['_onDidAttemptReadOnlyEdit'];

/**
 * Names the editor contribution that finds unusual line terminators — Line Separator (U+2028) and
 * Paragraph Separator (U+2029) — in a document and asks, in the browser's own confirm box, whether to
 * remove them.
 */
export const UNUSUAL_LINE_TERMINATORS_CONTRIBUTION: string =
  'editor.contrib.unusualLineTerminatorsDetector';

/**
 * Lists the members of Monaco's unusual line terminators contribution the guard replaces.
 */
export const UNUSUAL_LINE_TERMINATORS_HOOKS: readonly string[] = [
  '_checkForUnusualLineTerminators',
];

/**
 * Holds the editor options that keep Monaco's diff editor from drawing its own controls in the gutter
 * between the two sides (#1024): the toolbar over each change and the arrows that revert one. The
 * folded runs of unchanged lines ("N hidden lines") stay as Monaco draws them.
 */
export const DIFF_GUARD_EDITOR_OPTIONS: MonacoApi.editor.IDiffEditorOptions = {
  renderGutterMenu: false,
  renderMarginRevertIcon: false,
};

/**
 * Holds the editor options that keep Monaco's remaining widgets from opening on their own, without a
 * chord (#1024), in every editor:
 *
 * - a click on a colour swatch opens nothing of Monaco's (the swatch stays a decoration; Studio's
 *   own colour picker takes the click, #1025);
 * - inline suggestions are off — Studio offers none, and Monaco would draw its toolbar over them;
 * - a paste or a drop never offers Monaco's "paste as" or "drop as" menu afterwards: the paste or the
 *   drop itself is unchanged.
 *
 * Applied to every editor as it is created, and to the options every editor is created with.
 */
export const WIDGET_GUARD_EDITOR_OPTIONS: MonacoApi.editor.IEditorOptions = {
  colorDecoratorsActivatedOn: 'hover',
  inlineSuggest: { enabled: false },
  pasteAs: { showPasteSelector: 'never' },
  dropIntoEditor: { showDropSelector: 'never' },
};

/**
 * The part of Monaco's standalone colour picker contribution the guard replaces.
 */
interface StandaloneColorPickerContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Builds Monaco's standalone colour picker under the caret, or focuses it when it shows.
   */
  showOrFocus?: () => void;
}

/**
 * The part of Monaco's find contribution the guard replaces.
 */
interface FindContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Flashes the find options — building Monaco's find widget and its options strip the first time —
   * what the multi-cursor chords run as they add a match.
   */
  highlightFindOptions?: (ignoreWhenVisible?: boolean) => void;
}

/**
 * The part of Monaco's inlay hints contribution the guard replaces.
 */
interface InlayHintsContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Listens for a right-click on a hint, to open Monaco's menu of the places it points to.
   */
  _installContextMenu?: () => MonacoApi.IDisposable;
}

/**
 * The part of Monaco's read-only message contribution the guard replaces.
 */
interface ReadOnlyMessageContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Gets the editor the contribution belongs to.
   */
  readonly editor?: MonacoApi.editor.ICodeEditor;

  /**
   * Shows Monaco's overlay message at the caret, after an attempt to edit a read-only editor.
   */
  _onDidAttemptReadOnlyEdit?: () => void;
}

/**
 * The part of Monaco's unusual line terminators contribution the guard replaces.
 */
interface UnusualLineTerminatorsContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Gets the editor the contribution belongs to.
   */
  readonly _editor?: MonacoApi.editor.ICodeEditor;

  /**
   * Gets the editor's `unusualLineTerminators` option as the contribution last read it: `prompt`,
   * `auto` or `off`.
   */
  readonly _config?: string;

  /**
   * Holds whether the contribution is asking already, so a document is asked about once at a time.
   */
  _isPresentingDialog?: boolean;

  /**
   * Looks for unusual line terminators in the document and asks whether to remove them — what a
   * change of document, of its text or of the option runs.
   */
  _checkForUnusualLineTerminators?: () => Promise<void>;
}

/**
 * The part of Monaco's text model the line terminators check reads: not in Monaco's public types, but
 * on every model.
 */
interface LineTerminatorsModel extends MonacoApi.editor.ITextModel {
  /**
   * Determines whether the text may hold an unusual line terminator: a flag the model keeps as its
   * text changes, so asking is cheap.
   */
  mightContainUnusualLineTerminators?(): boolean;

  /**
   * Removes every unusual line terminator from the text, as one edit, keeping the selections.
   */
  removeUnusualLineTerminators?(selections: MonacoApi.Selection[] | null): void;
}

/**
 * Holds the documents whose unusual line terminators the user chose to leave, so they are not asked
 * about again while the document is open.
 */
const LEFT_AS_THEY_ARE: WeakSet<MonacoApi.editor.ITextModel> =
  new WeakSet<MonacoApi.editor.ITextModel>();

/**
 * What the guard hands to Studio.
 */
export interface WidgetGuardHandlers {
  /**
   * Opens Studio's right-click menu at an editor's caret: what ⇧F10 runs.
   * @param editor The editor.
   */
  showContextMenu(editor: MonacoApi.editor.ICodeEditor): void;

  /**
   * Tells the user an editor is read-only, after an attempt to edit it — in place of Monaco's overlay
   * message.
   * @param editor The editor.
   */
  readOnlyEdit(editor: MonacoApi.editor.ICodeEditor): void;

  /**
   * Asks whether to remove the unusual line terminators found in an editor's document — in place of
   * Monaco's confirm box.
   * @param editor The editor.
   * @param document The document's name, as the question shows it.
   * @returns Returns a promise resolving to true to remove them, false to leave them.
   */
  confirmUnusualLineTerminators(
    editor: MonacoApi.editor.ICodeEditor,
    document: string,
  ): Promise<boolean>;
}

/**
 * Removes the chords of every Monaco command in {@link MONACO_WIDGET_GUARD_COMMANDS} from a Monaco
 * instance (#1024), binds Studio's right-click menu to ⇧F10 in place of Monaco's, and closes the routes
 * into Monaco's UI that no chord takes: a click on a colour swatch, inline suggestions, the menus after
 * a paste or a drop, the find options the multi-cursor chords flash, the menu a right-click on an
 * inlay hint opens, the standalone colour picker, the overlay message after an attempt to edit a
 * read-only editor (Studio's notice instead) and the confirm box about unusual line terminators
 * (Studio's dialog instead) — each contribution's way in replaced, once for the instance, on its
 * class. Each instance (the main window's, and each child window's) has its own
 * keybinding service and its own classes, so each is prepared once, as it loads.
 *
 * A markdown code fence sets the find passthrough context key, and ⇧F10 passes through it as the find,
 * go-to and navigation chords do: a fence keeps its own right-click.
 * @param monaco The Monaco instance.
 * @param handlers Receive the editor when ⇧F10 runs, when a read-only editor is edited, and when a
 * document holds unusual line terminators.
 */
export function installWidgetGuard(monaco: typeof MonacoApi, handlers: WidgetGuardHandlers): void {
  monaco.editor.registerCommand(STUDIO_SHOW_CONTEXT_MENU_COMMAND, (): void => {
    const focused: MonacoApi.editor.ICodeEditor | undefined = focusedEditor(monaco);
    if (focused !== undefined) {
      handlers.showContextMenu(focused);
    }
  });
  monaco.editor.addKeybindingRules([
    // A removal with no chord drops every chord the command has, whichever platform Monaco runs on.
    ...MONACO_WIDGET_GUARD_COMMANDS.map((command: string): MonacoApi.editor.IKeybindingRule => ({
      keybinding: 0,
      command: `-${command}`,
    })),
    {
      keybinding: monaco.KeyMod.Shift | monaco.KeyCode.F10,
      command: STUDIO_SHOW_CONTEXT_MENU_COMMAND,
      when: `editorTextFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`,
    },
  ]);
  let picker: boolean = false;
  let find: boolean = false;
  let hints: boolean = false;
  let readOnly: boolean = false;
  let terminators: boolean = false;
  monaco.editor.onDidCreateEditor((editor: MonacoApi.editor.ICodeEditor): void => {
    editor.updateOptions(WIDGET_GUARD_EDITOR_OPTIONS);
    picker ||= takeOverStandaloneColorPicker(editor);
    find ||= takeOverFindOptions(editor);
    hints ||= takeOverInlayHintMenu(editor);
    readOnly ||= takeOverReadOnlyMessage(editor, handlers);
    terminators ||= takeOverUnusualLineTerminators(monaco, editor, handlers);
  });
}

/**
 * Replaces the way Monaco's read-only message contribution answers an attempt to edit a read-only
 * editor, on its class, so no editor of the instance shows Monaco's overlay message: Studio's notice
 * shows instead.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @param handlers Receive the editor that was edited.
 * @returns Returns true when the class was reached and its way in replaced.
 */
export function takeOverReadOnlyMessage(
  editor: MonacoApi.editor.ICodeEditor,
  handlers: Pick<WidgetGuardHandlers, 'readOnlyEdit'>,
): boolean {
  const prototype: ReadOnlyMessageContribution | null =
    contributionClass<ReadOnlyMessageContribution>(
      editor,
      READ_ONLY_MESSAGE_CONTRIBUTION,
      READ_ONLY_MESSAGE_HOOKS,
    );
  if (prototype === null) {
    return false;
  }
  prototype._onDidAttemptReadOnlyEdit = function (this: ReadOnlyMessageContribution): void {
    handlers.readOnlyEdit(this.editor ?? editor);
  };
  return true;
}

/**
 * Replaces the way Monaco's unusual line terminators contribution asks about a document, on its
 * class, so no editor of the instance opens the browser's confirm box: Studio's dialog asks instead,
 * on the same occasions — a document opened, its text changed (not by an undo), the option changed.
 * The option keeps its meaning: `off` never asks, `auto` removes them without asking, `prompt` asks;
 * a read-only editor is never asked about, and a document whose terminators the user left is not asked
 * about again.
 *
 * The contribution asks as it is made, so it is made with the option off — asking nothing — and the
 * option is put back once its way in is replaced, which asks again through Studio's dialog.
 * @param monaco The Monaco instance, whose option numbers the check reads.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @param handlers Receive the editor and the document to ask about.
 * @returns Returns true when the class was reached and its way in replaced.
 */
export function takeOverUnusualLineTerminators(
  monaco: typeof MonacoApi,
  editor: MonacoApi.editor.ICodeEditor,
  handlers: Pick<WidgetGuardHandlers, 'confirmUnusualLineTerminators'>,
): boolean {
  const option: MonacoApi.editor.IEditorOptions['unusualLineTerminators'] =
    editor.getRawOptions().unusualLineTerminators;
  editor.updateOptions({ unusualLineTerminators: 'off' });
  const prototype: UnusualLineTerminatorsContribution | null =
    contributionClass<UnusualLineTerminatorsContribution>(
      editor,
      UNUSUAL_LINE_TERMINATORS_CONTRIBUTION,
      UNUSUAL_LINE_TERMINATORS_HOOKS,
    );
  if (prototype !== null) {
    prototype._checkForUnusualLineTerminators = async function (
      this: UnusualLineTerminatorsContribution,
    ): Promise<void> {
      const target: MonacoApi.editor.ICodeEditor = this._editor ?? editor;
      const model: LineTerminatorsModel | null = target.getModel();
      if (
        this._config === 'off' ||
        model === null ||
        model.mightContainUnusualLineTerminators?.() !== true ||
        LEFT_AS_THEY_ARE.has(model) ||
        target.getOption(monaco.editor.EditorOption.readOnly)
      ) {
        return;
      }
      if (this._config === 'auto') {
        model.removeUnusualLineTerminators?.(target.getSelections());
        return;
      }
      if (this._isPresentingDialog === true) {
        return;
      }
      let remove: boolean;
      try {
        this._isPresentingDialog = true;
        remove = await handlers.confirmUnusualLineTerminators(target, documentName(model.uri));
      } finally {
        this._isPresentingDialog = false;
      }
      if (remove) {
        model.removeUnusualLineTerminators?.(target.getSelections());
      } else {
        LEFT_AS_THEY_ARE.add(model);
      }
    };
  }
  // Put back as it was, which asks about the document through the replaced way in.
  editor.updateOptions({ unusualLineTerminators: option ?? 'prompt' });
  return prototype !== null;
}

/**
 * Names a document for a question about it: its file name, or "This document" for one never saved.
 * @param uri The document's URI.
 * @returns Returns the name.
 */
function documentName(uri: MonacoApi.Uri): string {
  const name: string = uri.path.slice(uri.path.lastIndexOf('/') + 1);
  return uri.scheme === 'file' && name.length > 0 ? `“${name}”` : 'This document';
}

/**
 * Reaches the class of an editor's contribution, when the contribution has every member named.
 * Reaching the contribution makes it if it was not yet made; none the guard reaches builds DOM as it is
 * made.
 * @param editor An editor of the instance.
 * @param id The contribution's identifier.
 * @param hooks The members the class must have.
 * @returns Returns the class's prototype, or null when the editor has no such contribution or a member
 * is missing.
 */
function contributionClass<T extends MonacoApi.editor.IEditorContribution>(
  editor: MonacoApi.editor.ICodeEditor,
  id: string,
  hooks: readonly string[],
): T | null {
  const contribution: T | null = editor.getContribution<T>(id);
  const prototype: T | null =
    contribution === null ? null : (Object.getPrototypeOf(contribution) as T);
  return prototype === null ||
    hooks.some(
      (hook: string): boolean =>
        typeof (prototype as unknown as Record<string, unknown>)[hook] !== 'function',
    )
    ? null
    : prototype;
}

/**
 * Replaces the way Monaco's find contribution flashes its options, on its class, so no editor of the
 * instance builds Monaco's find widget or its options strip when a multi-cursor chord — ⌘D (Ctrl+D),
 * ⌘K ⌘D, ⌘⇧L (Ctrl+Shift+L), ⌘F2 (Ctrl+F2) — adds a match. The chords themselves keep working.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @returns Returns true when the class was reached and its way in replaced.
 */
export function takeOverFindOptions(editor: MonacoApi.editor.ICodeEditor): boolean {
  const prototype: FindContribution | null = contributionClass<FindContribution>(
    editor,
    FIND_CONTRIBUTION,
    FIND_HOOKS,
  );
  if (prototype === null) {
    return false;
  }
  prototype.highlightFindOptions = (): void => undefined;
  return true;
}

/**
 * Replaces the way Monaco's inlay hints contribution listens for a right-click on a hint, on its
 * class, so no editor of the instance opens Monaco's menu over a hint: the right-click opens Studio's
 * menu, as it does anywhere over the text.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @returns Returns true when the class was reached and its way in replaced.
 */
export function takeOverInlayHintMenu(editor: MonacoApi.editor.ICodeEditor): boolean {
  const prototype: InlayHintsContribution | null = contributionClass<InlayHintsContribution>(
    editor,
    INLAY_HINTS_CONTRIBUTION,
    INLAY_HINTS_HOOKS,
  );
  if (prototype === null) {
    return false;
  }
  prototype._installContextMenu = (): MonacoApi.IDisposable => ({
    dispose: (): void => undefined,
  });
  return true;
}

/**
 * Replaces the builder of Monaco's standalone colour picker, on its class, so no editor of the
 * instance ever builds it: the command that shows it — reachable only by name, since no chord or menu
 * offers it — does nothing.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @returns Returns true when the class was reached and its builder replaced.
 */
export function takeOverStandaloneColorPicker(editor: MonacoApi.editor.ICodeEditor): boolean {
  const prototype: StandaloneColorPickerContribution | null =
    contributionClass<StandaloneColorPickerContribution>(
      editor,
      STANDALONE_COLOR_PICKER_CONTRIBUTION,
      STANDALONE_COLOR_PICKER_HOOKS,
    );
  if (prototype === null) {
    return false;
  }
  prototype.showOrFocus = (): void => undefined;
  return true;
}
