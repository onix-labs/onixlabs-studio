import { inject, Service } from '@angular/core';
import { Studio } from '@shared/angular/services/studio/studio';
import { focusedTextInput, selectAllWithin } from './text-input-focus';

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
   * Gets a value indicating whether the select-all chord uses the ⌘ (meta) key, which it does on
   * macOS; on every other platform it uses Ctrl.
   */
  private readonly isMac: boolean = this.studio.platform === 'darwin';

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
