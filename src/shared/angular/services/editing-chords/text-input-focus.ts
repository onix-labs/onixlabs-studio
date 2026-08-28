/**
 * The input types that hold selectable text. The rest — checkboxes, ranges, colours, and the numeric
 * spinners whose selection API throws — are not text boxes, so a chord aimed at "whatever the user is
 * typing into" must not treat them as one.
 */
const TEXT_INPUT_TYPES: readonly string[] = ['text', 'search', 'url', 'tel', 'password', 'email'];

/**
 * Matches the terminal, whose focused element is a text area that is not a text box.
 */
const TERMINAL_SELECTOR: string = '.xterm';

/**
 * Matches an editable region's host, so focus anywhere inside one resolves to the region as a whole.
 * Read from the markup rather than through `isContentEditable`, which is derived state a DOM
 * implementation may not provide.
 */
const EDITABLE_SELECTOR: string = '[contenteditable]:not([contenteditable="false"])';

/**
 * Resolves the text box the user is typing into, or null when focus is anywhere else.
 *
 * This is what lets the editing chords follow focus. A tab that binds Cut, Copy or Paste to something
 * of its own — files in the explorer, the shell in a terminal — asks this first, so the chord still
 * reaches a composer or a settings field docked beside it rather than being claimed by the tab.
 *
 * "Anywhere else" deliberately includes the terminal: xterm keeps a hidden text area focused to
 * receive key input, but its selection lives in its own model rather than in the DOM, so treating it
 * as a text box would hand it clipboard behaviour that cannot see what is selected. Monaco and
 * Milkdown are not excluded — their editing surfaces do handle the platform's own clipboard events,
 * so serving them the native behaviour is right. Focus inside an editable region resolves to the
 * region's host rather than the node the caret sits in, so a caller acts on the whole thing.
 *
 * @param document The document to read focus from. Passed rather than assumed, because a pop-out
 * window has its own; element types are resolved through that document's view so the checks hold
 * across realms.
 * @returns Returns the focused text box, or null when focus is not in one.
 */
export function focusedTextInput(document: Document): HTMLElement | null {
  const view: (Window & typeof globalThis) | null = document.defaultView;
  const active: Element | null = document.activeElement;
  if (view === null || active === null || !(active instanceof view.HTMLElement)) {
    return null;
  }
  if (active.closest(TERMINAL_SELECTOR) !== null) {
    return null;
  }
  if (active instanceof view.HTMLTextAreaElement) {
    return active;
  }
  if (active instanceof view.HTMLInputElement) {
    return TEXT_INPUT_TYPES.includes(active.type) ? active : null;
  }
  return active.closest<HTMLElement>(EDITABLE_SELECTOR);
}

/**
 * Matches a Monaco editor's host, so focus anywhere inside one — its hidden text area, or the
 * EditContext element newer builds focus instead, which is neither a text box nor editable markup —
 * resolves to the editor.
 */
const MONACO_SELECTOR: string = '.monaco-editor';

/**
 * The kinds of surface an editing chord can land in.
 */
export type EditingSurface = 'text-box' | 'monaco' | 'terminal';

/**
 * Resolves the editing surface that has focus, or null when focus is anywhere else.
 *
 * Broader than {@link focusedTextInput}, and asked by a different question: not "is there a text box
 * to act on" but "is the user editing *something*?" A tab that binds Cut, Copy or Paste to something
 * of its own (files in the explorer) must never run that command while the user is in an editor of
 * any kind — and the code editor and the terminal are not text boxes. Monaco focuses an EditContext
 * element on current Chromium, which is neither a text area nor editable markup; xterm focuses a
 * hidden text area the text-box check deliberately excludes. Both are places the user is typing.
 *
 * @param document The document to read focus from.
 * @returns Returns the kind of surface focused, or null when focus is not in one.
 */
export function focusedEditingSurface(document: Document): EditingSurface | null {
  const view: (Window & typeof globalThis) | null = document.defaultView;
  const active: Element | null = document.activeElement;
  if (view === null || active === null || !(active instanceof view.HTMLElement)) {
    return null;
  }
  if (active.closest(MONACO_SELECTOR) !== null) {
    return 'monaco';
  }
  if (active.closest(TERMINAL_SELECTOR) !== null) {
    return 'terminal';
  }
  return focusedTextInput(document) === null ? null : 'text-box';
}

/**
 * Selects a text box's whole contents.
 *
 * Done in the renderer rather than through the platform's Select All role, because a role would need
 * a menu entry to carry its chord and that entry would take ⌘A from the editors that bind it to their
 * own selection model. Selecting text is one thing the renderer can do for itself, so it does.
 *
 * @param element The text box to select the contents of.
 */
export function selectAllWithin(element: HTMLElement): void {
  const document: Document = element.ownerDocument;
  const view: (Window & typeof globalThis) | null = document.defaultView;
  if (
    view !== null &&
    (element instanceof view.HTMLInputElement || element instanceof view.HTMLTextAreaElement)
  ) {
    element.setSelectionRange(0, element.value.length);
    return;
  }
  const range: Range = document.createRange();
  range.selectNodeContents(element);
  const selection: Selection | null = view?.getSelection() ?? null;
  selection?.removeAllRanges();
  selection?.addRange(range);
}
