import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Studio } from '@shared/angular/services/studio/studio';
import {
  EditingSurface,
  focusedEditingSurface,
  focusedTextInput,
  selectAllWithin,
} from './text-input-focus';

/**
 * How a menu editing chord should be served, given where focus is.
 */
export type EditingRoleRoute =
  /**
   * The platform's own behaviour for the role (the native menu role, or `webContents.<role>()`).
   */
  | 'native'
  /**
   * The chord was served here, directly against the focused editor.
   */
  | 'handled'
  /**
   * Focus is not in an editing surface; the tab's own command may run.
   */
  | 'unclaimed';

/**
 * The Monaco action each editing role maps to when an editor has focus and the role is one Monaco
 * must serve from its own model (the platform's undo has no idea about an editor's edit history).
 */
const MONACO_ACTIONS: Readonly<Record<string, string>> = {
  undo: 'undo',
  redo: 'redo',
};

/**
 * Serves the editing chords the application menu cannot.
 *
 * On macOS the menu is what binds the editing chords into the window at all, which is why the core
 * menu carries Cut, Copy and Paste as native roles. Select All cannot join them: a menu entry always
 * owns its accelerator, and a native Select All role would take ⌘A from Monaco, Milkdown and the
 * terminal, each of which selects against its own model rather than the DOM. Unlike the clipboard,
 * though, selecting text is something the renderer can do for itself — so this handles ⌘A directly
 * for a plain text box and leaves every other surface alone.
 *
 * Called from each window's key listener in bubble phase, after the embedded engines have had the
 * keys they own: an editor that handles ⌘A itself either stops the event propagating or marks it
 * handled, and both are honoured here.
 */
@Service()
export class EditingChords {
  /**
   * Holds the host-platform accessor, used to resolve the select-all chord to ⌘ on macOS and Ctrl
   * elsewhere.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the Monaco service, used to reach the focused code editor when a chord must be served from
   * its own model.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Gets a value indicating whether the select-all chord uses the ⌘ (meta) key, which it does on
   * macOS; on every other platform it uses Ctrl.
   */
  private readonly isMac: boolean = this.studio.platform === 'darwin';

  /**
   * Decides how a menu entry's editing chord is served, from where focus is. A tab that binds Undo,
   * Cut, Copy or Paste to something of its own (files in the explorer, the shell in a terminal) asks
   * this before running its command:
   *
   * - In a **code editor**: undo and redo run against the editor's own model (the platform's undo
   *   cannot see it); the clipboard roles go native, which Monaco serves through the platform's
   *   clipboard events.
   * - In the **terminal**: the clipboard roles go native — xterm serves the platform's copy and paste
   *   events from its own selection — and undo/redo, which mean nothing there, are swallowed rather
   *   than handed to the tab as an explorer operation.
   * - In a **text box** (a composer, a settings field, an editable region): every role goes native.
   * - Anywhere else: the chord is unclaimed and the tab's command runs.
   *
   * Before this, only a text box deferred; with the code editor or the terminal focused on a
   * workspace tab, ⌘C copied the *selected file* and ⌘V pasted it — the chord never reached what the
   * user was typing into.
   * @param role The native role the entry stands for (`undo`, `redo`, `cut`, `copy`, `paste`).
   * @param document The document to read focus from.
   * @returns Returns how the chord was, or should be, served.
   */
  public routeEditingRole(role: string, document: Document): EditingRoleRoute {
    const surface: EditingSurface | null = focusedEditingSurface(document);
    switch (surface) {
      case 'monaco': {
        const action: string | undefined = MONACO_ACTIONS[role];
        if (action === undefined) {
          return 'native';
        }
        this.focusedEditor()?.trigger('menu', action, undefined);
        return 'handled';
      }
      case 'terminal':
        return MONACO_ACTIONS[role] === undefined ? 'native' : 'handled';
      case 'text-box':
        return 'native';
      default:
        return 'unclaimed';
    }
  }

  /**
   * Finds the code editor that has text focus, or null when none has (or Monaco is not loaded).
   * @returns Returns the focused editor, or null.
   */
  private focusedEditor(): MonacoApi.editor.ICodeEditor | null {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return null;
    }
    return (
      monaco.editor
        .getEditors()
        .find((editor: MonacoApi.editor.ICodeEditor): boolean => editor.hasTextFocus()) ?? null
    );
  }

  /**
   * Selects the focused text box's contents when the key press is the select-all chord and nothing
   * else has claimed it.
   * @param event The keyboard event to consider.
   * @returns Returns true when the selection was made, so the caller can suppress the event's
   * default; false when the event was not the chord, was already handled, or focus was not in a text
   * box.
   */
  public handleSelectAll(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.altKey || event.shiftKey) {
      return false;
    }
    if (!(this.isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) {
      return false;
    }
    if (event.key.toLowerCase() !== 'a') {
      return false;
    }
    const target: HTMLElement | null = focusedTextInput(
      (event.target as Node | null)?.ownerDocument ?? document,
    );
    if (target === null) {
      return false;
    }
    selectAllWithin(target);
    return true;
  }
}
