import type * as MonacoApi from 'monaco-editor';

/**
 * Pastes the clipboard's text over an editor's selection, as one edit — Monaco has no paste action to
 * trigger. Shared by the editor strip's Paste button and the editor's right-click Paste (#1012), so
 * the two behave alike.
 *
 * The clipboard is read through the editor's own window: a popped-out or modal editor is in a window
 * of its own, and the main window's clipboard refuses to be read while it does not have focus.
 * @param editor The editor to paste into.
 * @param source The source label Monaco records the edit under.
 */
export function pasteIntoEditor(editor: MonacoApi.editor.ICodeEditor, source: string): void {
  editor.focus();
  const view: Window = editor.getContainerDomNode().ownerDocument.defaultView ?? window;
  void view.navigator.clipboard
    .readText()
    .then((text: string): void => {
      const selection: MonacoApi.Selection | null = editor.getSelection();
      if (selection !== null) {
        editor.executeEdits(source, [{ range: selection, text, forceMoveMarkers: true }]);
      }
    })
    .catch((): void => undefined);
}
