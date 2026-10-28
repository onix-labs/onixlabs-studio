import type * as MonacoApi from 'monaco-editor';

/**
 * The id of Monaco's snippet contribution, through which a snippet's tab stops work.
 */
const SNIPPET_CONTROLLER: string = 'snippetController2';

/**
 * The part of Monaco's snippet contribution the auto-insert uses.
 */
interface SnippetController {
  insert(
    template: string,
    options?: { undoStopBefore?: boolean; undoStopAfter?: boolean; adjustWhitespace?: boolean },
  ): void;
}

/**
 * Receives a character the user has just typed in an editor, for whoever may insert text in answer
 * (#1148): a language server's doc-comment skeleton after `///`, say.
 */
export type AutoInsertHandler = (editor: MonacoApi.editor.ICodeEditor, ch: string) => void;

/**
 * Reads the character a content change typed, when it is one keystroke the user made: a single
 * character inserted, or Enter — a newline and the indentation Monaco gives it. Anything else — a
 * paste, an undo, a replacement, an edit made by code — types nothing.
 * @param event The content change.
 * @returns Returns the character typed (`\n` for Enter), or null.
 */
export function typedCharacter(event: MonacoApi.editor.IModelContentChangedEvent): string | null {
  if (event.isUndoing || event.isRedoing || event.isFlush || event.changes.length !== 1) {
    return null;
  }
  const change: MonacoApi.editor.IModelContentChange = event.changes[0];
  if (change.rangeLength !== 0) {
    return null;
  }
  if (/^\r?\n[ \t]*$/.test(change.text)) {
    return '\n';
  }
  return [...change.text].length === 1 ? change.text : null;
}

/**
 * Listens in every editor of a Monaco instance — those made before and after — for characters the
 * user types, and hands each to a handler, which asks whatever may answer it (#1148). Only an editor
 * the user is typing into is listened to: an edit applied by code is not typing.
 * @param monaco The Monaco instance.
 * @param handler Receives the editor and the character typed.
 */
export function installAutoInsert(monaco: typeof MonacoApi, handler: AutoInsertHandler): void {
  const listen: (editor: MonacoApi.editor.ICodeEditor) => void = (
    editor: MonacoApi.editor.ICodeEditor,
  ): void => {
    editor.onDidChangeModelContent((event: MonacoApi.editor.IModelContentChangedEvent): void => {
      const ch: string | null = typedCharacter(event);
      if (ch !== null && editor.hasTextFocus()) {
        handler(editor, ch);
      }
    });
  };
  for (const editor of monaco.editor.getEditors()) {
    listen(editor);
  }
  monaco.editor.onDidCreateEditor(listen);
}

/**
 * Applies what a server inserts in answer to a typed character: a snippet through Monaco's snippet
 * contribution, so its tab stops and final caret (`$0`) work, or plain text as an edit. The span it
 * replaces is selected first, the snippet taking the selection's place.
 * @param editor The editor typed in.
 * @param range The span the text replaces (empty to insert).
 * @param text The text, or the snippet's template.
 * @param snippet Whether the text is a snippet.
 * @returns Returns true when the text was applied.
 */
export function applyAutoInsert(
  editor: MonacoApi.editor.ICodeEditor,
  range: MonacoApi.IRange,
  text: string,
  snippet: boolean,
): boolean {
  if (!snippet) {
    return editor.executeEdits('studio.autoInsert', [{ range, text, forceMoveMarkers: true }]);
  }
  const controller: SnippetController | null = editor.getContribution<
    MonacoApi.editor.IEditorContribution & SnippetController
  >(SNIPPET_CONTROLLER);
  if (controller === null) {
    return false;
  }
  editor.setSelection(range);
  // The server's text is indented already (Roslyn's skeleton carries each line's `///` at the
  // member's indentation): Monaco's own adjustment would indent every line after the first twice.
  controller.insert(text, { undoStopBefore: true, undoStopAfter: true, adjustWhitespace: false });
  return true;
}
