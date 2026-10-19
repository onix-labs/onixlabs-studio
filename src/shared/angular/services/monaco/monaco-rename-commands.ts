import type * as MonacoApi from 'monaco-editor';
import { FIND_PASSTHROUGH_CONTEXT_KEY, focusedEditor } from './monaco-find-commands';

/**
 * Names Monaco's Rename Symbol action (#1015), which opens Monaco's own rename box under the symbol.
 * Its F2 chord is removed, on every platform; Studio's Rename Symbol takes F2 instead.
 */
export const MONACO_RENAME_COMMAND: string = 'editor.action.rename';

/**
 * Names Studio's Rename Symbol command, bound to F2 in every editor, on every platform.
 */
export const STUDIO_RENAME_SYMBOL_COMMAND: string = 'studio.renameSymbol';

/**
 * Names the editor contribution behind Monaco's rename: whatever runs Monaco's Rename Symbol — its
 * chord, a command palette, a code action — runs this contribution's `run`, which opens Monaco's
 * rename box.
 */
export const RENAME_CONTRIBUTION: string = 'editor.contrib.renameController';

/**
 * The part of the rename contribution Studio replaces: the run that opens Monaco's rename box, and
 * the editor it belongs to.
 */
interface RenameContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Gets the editor the contribution belongs to.
   */
  readonly editor?: MonacoApi.editor.ICodeEditor;

  /**
   * Opens Monaco's rename box for the symbol at the caret.
   */
  run?: () => Promise<void>;
}

/**
 * Removes Monaco's Rename Symbol chord (F2) from a Monaco instance and binds Studio's Rename Symbol to
 * F2 in its place (#1015), then makes sure Monaco's rename box can never open in any editor the
 * instance creates: the rename contribution's `run` — what every route to Monaco's rename ends in — is
 * replaced, once for the instance, with Studio's. Each instance (the main window's, and each child
 * window's) has its own keybinding service and its own classes, so each is prepared once, as it loads.
 *
 * A markdown code fence sets the find passthrough context key, and F2 passes through it as the find,
 * go-to and navigation chords do: a fence is a few lines inside a document, with no symbols to rename.
 * @param monaco The Monaco instance.
 * @param onRename Receives the editor when F2 or any route to Monaco's rename runs.
 */
export function installRenameCommands(
  monaco: typeof MonacoApi,
  onRename: (editor: MonacoApi.editor.ICodeEditor) => void,
): void {
  monaco.editor.registerCommand(STUDIO_RENAME_SYMBOL_COMMAND, (): void => {
    const focused: MonacoApi.editor.ICodeEditor | undefined = focusedEditor(monaco);
    if (focused !== undefined) {
      onRename(focused);
    }
  });
  monaco.editor.addKeybindingRules([
    // A removal with no chord drops every chord the command has, whichever platform Monaco runs on.
    { keybinding: 0, command: `-${MONACO_RENAME_COMMAND}` },
    {
      keybinding: monaco.KeyCode.F2,
      command: STUDIO_RENAME_SYMBOL_COMMAND,
      when: `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`,
    },
  ]);
  let replaced: boolean = false;
  monaco.editor.onDidCreateEditor((editor: MonacoApi.editor.ICodeEditor): void => {
    if (!replaced) {
      replaced = takeOverRename(editor, onRename);
    }
  });
}

/**
 * Replaces the rename contribution's `run` with Studio's on its class, so every editor of the instance
 * — those made before and after — sends its rename to Studio. Done through the prototype once, rather
 * than per editor: the contribution is created lazily, and creating one in every editor just to
 * replace it would build Monaco's rename box in each.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @param onRename Receives the editor a rename runs in.
 * @returns Returns true when the class was reached and its `run` replaced.
 */
export function takeOverRename(
  editor: MonacoApi.editor.ICodeEditor,
  onRename: (editor: MonacoApi.editor.ICodeEditor) => void,
): boolean {
  const contribution: RenameContribution | null =
    editor.getContribution<RenameContribution>(RENAME_CONTRIBUTION);
  const prototype: RenameContribution | null =
    contribution === null ? null : (Object.getPrototypeOf(contribution) as RenameContribution);
  if (prototype === null || typeof prototype.run !== 'function') {
    return false;
  }
  prototype.run = function (this: RenameContribution): Promise<void> {
    onRename(this.editor ?? editor);
    return Promise.resolve();
  };
  return true;
}
