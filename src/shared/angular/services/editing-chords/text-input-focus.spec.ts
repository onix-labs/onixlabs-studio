import { focusedTextInput, selectAllWithin } from './text-input-focus';

describe('focusedTextInput', () => {
  /**
   * Holds the elements a test added to the document, removed after it.
   */
  let added: HTMLElement[] = [];

  /**
   * Adds an element to the document and focuses it.
   * @param element The element to focus.
   * @returns Returns the focused element.
   */
  function focus<T extends HTMLElement>(element: T): T {
    document.body.appendChild(element);
    added.push(element);
    element.focus();
    return element;
  }

  beforeEach(() => {
    added = [];
  });

  afterEach(() => {
    added.forEach((element: HTMLElement): void => element.remove());
  });

  it('focusedTextInput_whenATextAreaHasFocus_returnsIt', () => {
    const box: HTMLTextAreaElement = focus(document.createElement('textarea'));

    expect(focusedTextInput(document)).toBe(box);
  });

  it('focusedTextInput_whenATextInputHasFocus_returnsIt', () => {
    const box: HTMLInputElement = document.createElement('input');
    box.type = 'search';
    focus(box);

    expect(focusedTextInput(document)).toBe(box);
  });

  it('focusedTextInput_whenANonTextInputHasFocus_returnsNull', () => {
    const box: HTMLInputElement = document.createElement('input');
    box.type = 'checkbox';
    focus(box);

    expect(focusedTextInput(document)).toBeNull();
  });

  it('focusedTextInput_whenAnEditableRegionHasFocus_returnsItsHost', () => {
    // The caret sits in whichever node the region happens to be showing; a caller wants the region.
    const editable: HTMLDivElement = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const paragraph: HTMLParagraphElement = editable.appendChild(document.createElement('p'));
    focus(editable);

    expect(focusedTextInput(document)).toBe(editable);
    expect(paragraph.closest('[contenteditable]')).toBe(editable);
  });

  it('focusedTextInput_whenTheTerminalHasFocus_returnsNull', () => {
    // xterm keeps a hidden text area focused to receive keys, but its selection lives in its own
    // model — so the terminal's own clipboard commands must serve the chord, not the platform's.
    const terminal: HTMLDivElement = document.createElement('div');
    terminal.className = 'xterm';
    const helper: HTMLTextAreaElement = terminal.appendChild(document.createElement('textarea'));
    document.body.appendChild(terminal);
    added.push(terminal);
    helper.focus();

    expect(focusedTextInput(document)).toBeNull();
  });

  it('focusedTextInput_whenNothingHasFocus_returnsNull', () => {
    document.body.focus();

    expect(focusedTextInput(document)).toBeNull();
  });

  it('selectAllWithin_whenGivenATextArea_selectsItsWholeValue', () => {
    const box: HTMLTextAreaElement = focus(document.createElement('textarea'));
    box.value = 'the whole draft';

    selectAllWithin(box);

    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe('the whole draft'.length);
  });

  it('selectAllWithin_whenGivenAnEditableElement_selectsItsContents', () => {
    const editable: HTMLDivElement = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.textContent = 'the whole draft';
    focus(editable);

    selectAllWithin(editable);

    expect(document.getSelection()?.toString()).toBe('the whole draft');
  });
});
