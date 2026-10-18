import type * as MonacoApi from 'monaco-editor';
import type { FindMode } from '@shared/angular/components/find-panel/find-request';

/**
 * Lists every Monaco command bound to a chord that opens, drives or edits through its find widget
 * (#1007). Each has all of its default chords removed, on every platform, so the widget can never
 * open: the openers (find, find with selection, replace), the match navigation (F3 / ⌘G and the
 * selection-match variants, which reveal the widget when it is closed), and the in-widget toggles and
 * replace actions, which act on the hidden widget's state.
 */
export const MONACO_FIND_COMMANDS: readonly string[] = [
  'actions.find',
  'actions.findWithSelection',
  'editor.actions.findWithArgs',
  'editor.action.startFindReplaceAction',
  'editor.action.nextMatchFindAction',
  'editor.action.previousMatchFindAction',
  'editor.action.nextSelectionMatchFindAction',
  'editor.action.previousSelectionMatchFindAction',
  'editor.action.goToMatchFindAction',
  'editor.action.replaceOne',
  'editor.action.replaceAll',
  'editor.action.selectAllMatches',
  'closeFindWidget',
  'toggleFindCaseSensitive',
  'toggleFindWholeWord',
  'toggleFindRegex',
  'toggleFindInSelection',
  'togglePreserveCase',
  // The command palette (F1) lists Find and Replace and runs them past every rule above, so its chord
  // goes too. Its other route, Monaco's right-click menu, goes when Studio draws that menu (#946).
  'editor.action.quickCommand',
];

/**
 * Names Studio's find command, bound to ⌘F (Ctrl+F) in every editor.
 */
export const STUDIO_FIND_COMMAND: string = 'studio.find';

/**
 * Names Studio's find-and-replace command, bound to ⌘⌥F on macOS and Ctrl+H elsewhere — the chords
 * Monaco gave its own replace.
 */
export const STUDIO_FIND_REPLACE_COMMAND: string = 'studio.findReplace';

/**
 * Names the editor context key that passes ⌘F / ⌘⌥F through to the editor's host instead of running
 * Studio's find commands. A markdown code fence sets it, so ⌘F inside a fence does what it does in the
 * prose around it: the markdown document's own find.
 */
export const FIND_PASSTHROUGH_CONTEXT_KEY: string = 'studioFindPassthrough';

/**
 * Removes Monaco's find-widget chords from a Monaco instance and binds Studio's find commands in their
 * place. Each instance (the main window's, and each child window's) has its own keybinding service, so
 * each is prepared once, as it loads.
 * @param monaco The Monaco instance.
 * @param isMac Whether the host is macOS, which decides the replace chord.
 * @param onFind Receives the focused editor and the mode when one of Studio's commands runs.
 */
export function installFindCommands(
  monaco: typeof MonacoApi,
  isMac: boolean,
  onFind: (editor: MonacoApi.editor.ICodeEditor, mode: FindMode) => void,
): void {
  const run: (mode: FindMode) => () => void =
    (mode: FindMode): (() => void) =>
    (): void => {
      // A keybinding fires from the editor that holds the keyboard, so exactly one has focus.
      const editors: readonly MonacoApi.editor.ICodeEditor[] = monaco.editor.getEditors();
      const focused: MonacoApi.editor.ICodeEditor | undefined =
        editors.find((editor: MonacoApi.editor.ICodeEditor): boolean => editor.hasTextFocus()) ??
        editors.find((editor: MonacoApi.editor.ICodeEditor): boolean => editor.hasWidgetFocus());
      if (focused !== undefined) {
        onFind(focused, mode);
      }
    };
  monaco.editor.registerCommand(STUDIO_FIND_COMMAND, run('find'));
  monaco.editor.registerCommand(STUDIO_FIND_REPLACE_COMMAND, run('replace'));
  const when: string = `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`;
  monaco.editor.addKeybindingRules([
    // A removal with no chord ("-command" over keybinding 0) drops every chord the command has, on
    // whichever platform Monaco is running — so no per-platform chord list has to be kept in step.
    ...MONACO_FIND_COMMANDS.map((command: string): MonacoApi.editor.IKeybindingRule => ({
      keybinding: 0,
      command: `-${command}`,
    })),
    {
      keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
      command: STUDIO_FIND_COMMAND,
      when,
    },
    {
      keybinding: isMac
        ? monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF
        : monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH,
      command: STUDIO_FIND_REPLACE_COMMAND,
      when,
    },
  ]);
}
