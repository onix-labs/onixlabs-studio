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
 * Determines whether an element is a text area. Read from the tag rather than through `instanceof`,
 * because a pop-out window's elements are created by the opener's document: they carry the opener's
 * classes, so an `instanceof` against the pop-out's own classes fails for every one of them.
 * @param element The element to test.
 * @returns Returns true when the element is a text area.
 */
function isTextArea(element: Element): element is HTMLTextAreaElement {
  return element.tagName === 'TEXTAREA';
}

/**
 * Determines whether an element is an input, read from the tag for the reason {@link isTextArea}
 * gives.
 * @param element The element to test.
 * @returns Returns true when the element is an input.
 */
function isInput(element: Element): element is HTMLInputElement {
  return element.tagName === 'INPUT';
}

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
 * window has its own. Element types are read from their tags, so the checks hold whichever window's
 * document created the element.
 * @returns Returns the focused text box, or null when focus is not in one.
 */
export function focusedTextInput(document: Document): HTMLElement | null {
  const active: Element | null = document.activeElement;
  if (active?.closest(TERMINAL_SELECTOR) !== null) {
    return null;
  }
  if (isTextArea(active)) {
    return active;
  }
  if (isInput(active)) {
    return TEXT_INPUT_TYPES.includes(active.type) ? active : null;
  }
  return active.closest<HTMLElement>(EDITABLE_SELECTOR);
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
  if (isInput(element) || isTextArea(element)) {
    element.setSelectionRange(0, element.value.length);
    return;
  }
  const document: Document = element.ownerDocument;
  const range: Range = document.createRange();
  range.selectNodeContents(element);
  const selection: Selection | null = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
