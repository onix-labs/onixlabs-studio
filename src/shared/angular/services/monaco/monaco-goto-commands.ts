import type * as MonacoApi from 'monaco-editor';
import type { GoToMode } from '@shared/angular/services/go-to/go-to-model';
import { FIND_PASSTHROUGH_CONTEXT_KEY, focusedEditor } from './monaco-find-commands';
import type { EditorKeybinding } from './monaco-keybindings';

/**
 * Lists every Monaco command that opens its own quick-input box to go somewhere in the document
 * (#1009): the quick outline (Go to Symbol, ⌘⇧O), go to line (⌃G / Ctrl+G) and go to offset. Each has
 * all of its default chords removed, on every platform, so Monaco's quick-input widget can never open
 * from the keyboard; Studio's own Go to Symbol and Go to Line take the chords instead.
 */
export const MONACO_GOTO_COMMANDS: readonly string[] = [
  'editor.action.quickOutline',
  'editor.action.gotoLine',
  'editor.action.gotoOffset',
];

/**
 * Names Studio's Go to Symbol command, bound to ⌘⇧O (Ctrl+Shift+O) in every editor.
 */
export const STUDIO_GO_TO_SYMBOL_COMMAND: string = 'studio.goToSymbol';

/**
 * Names Studio's Go to Line command, bound to ⌃G on macOS and Ctrl+G elsewhere — the chords Monaco
 * gave its own go to line.
 */
export const STUDIO_GO_TO_LINE_COMMAND: string = 'studio.goToLine';

/**
 * Removes Monaco's go-to chords from a Monaco instance and binds Studio's Go to Symbol and Go to Line
 * in their place. Each instance (the main window's, and each child window's) has its own keybinding
 * service, so each is prepared once, as it loads.
 *
 * A markdown code fence sets the find passthrough context key, and the chords pass through it too: a
 * fence is a few lines inside a markdown document, which has no symbols or lines of its own to go to.
 * @param monaco The Monaco instance.
 * @param onGoTo Receives the focused editor and the mode when one of Studio's commands runs.
 * @returns Returns the commands to bind, their chords from the keybinding registry (#1036): Go to
 * Symbol (⌘⇧O) and Go to Line (⌃G on macOS, Ctrl+G elsewhere) by default.
 */
export function installGoToCommands(
  monaco: typeof MonacoApi,
  onGoTo: (editor: MonacoApi.editor.ICodeEditor, mode: GoToMode) => void,
): readonly EditorKeybinding[] {
  const run: (mode: GoToMode) => () => void =
    (mode: GoToMode): (() => void) =>
    (): void => {
      const focused: MonacoApi.editor.ICodeEditor | undefined = focusedEditor(monaco);
      if (focused !== undefined) {
        onGoTo(focused, mode);
      }
    };
  monaco.editor.registerCommand(STUDIO_GO_TO_SYMBOL_COMMAND, run('symbol'));
  monaco.editor.registerCommand(STUDIO_GO_TO_LINE_COMMAND, run('line'));
  const when: string = `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`;
  // A removal with no chord drops every chord the command has, whichever platform Monaco runs on.
  monaco.editor.addKeybindingRules(
    MONACO_GOTO_COMMANDS.map((command: string): MonacoApi.editor.IKeybindingRule => ({
      keybinding: 0,
      command: `-${command}`,
    })),
  );
  return [
    { id: 'editor.goToSymbol', command: STUDIO_GO_TO_SYMBOL_COMMAND, when },
    { id: 'editor.goToLine', command: STUDIO_GO_TO_LINE_COMMAND, when },
  ];
}
