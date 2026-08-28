import { TestBed } from '@angular/core/testing';

import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Studio } from '@shared/angular/services/studio/studio';
import { EditingChords } from './editing-chords';

/**
 * The slice of a Monaco editor the chords touch.
 */
interface FakeEditor {
  hasTextFocus(): boolean;
  trigger(source: string, action: string): void;
}

/**
 * The editors the fake Monaco reports.
 */
const monacoStub: { editors: readonly FakeEditor[] } = { editors: [] };

describe('EditingChords', () => {
  let chords: EditingChords;
  let box: HTMLTextAreaElement;

  /**
   * Builds the service against a host platform.
   * @param platform The platform to report.
   * @returns Returns the service.
   */
  function build(platform: string): EditingChords {
    const studioStub: Pick<Studio, 'platform'> = { platform };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Studio, useValue: studioStub },
        {
          provide: Monaco,
          useValue: {
            getMonaco: (): unknown => ({
              editor: { getEditors: (): readonly FakeEditor[] => monacoStub.editors },
            }),
          },
        },
      ],
    });
    return TestBed.inject(EditingChords);
  }

  /**
   * Builds a select-all key press against the focused text box.
   * @param overrides The event properties to vary from the macOS select-all chord.
   * @returns Returns the event.
   */
  function chord(overrides: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: true,
      cancelable: true,
      ...overrides,
    });
  }

  beforeEach(() => {
    monacoStub.editors = [];
    chords = build('darwin');
    box = document.createElement('textarea');
    document.body.appendChild(box);
    box.value = 'the whole draft';
    box.focus();
  });

  afterEach(() => {
    box.remove();
  });

  it('handleSelectAll_whenTheChordFiresInATextBox_selectsItAll', () => {
    expect(chords.handleSelectAll(chord())).toBe(true);
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe('the whole draft'.length);
  });

  it('handleSelectAll_whenAnEditorAlreadyHandledTheChord_leavesItAlone', () => {
    // Monaco, Milkdown and the terminal select against their own model and mark the event handled;
    // this listener runs after them, so a handled chord must pass straight through.
    const event: KeyboardEvent = chord();
    event.preventDefault();
    box.setSelectionRange(4, 4);

    expect(chords.handleSelectAll(event)).toBe(false);
    expect(box.selectionStart).toBe(4);
    expect(box.selectionEnd).toBe(4);
  });

  it('handleSelectAll_whenFocusIsNotInATextBox_doesNothing', () => {
    box.blur();
    document.body.focus();

    expect(chords.handleSelectAll(chord())).toBe(false);
  });

  /**
   * Focuses an element inside a host carrying a class, standing in for an embedded editor.
   * @param hostClass The host's class (`monaco-editor`, `xterm`).
   * @returns Returns the host, for removal.
   */
  function focusInside(hostClass: string): HTMLElement {
    box.blur();
    const host: HTMLDivElement = document.createElement('div');
    host.className = hostClass;
    const input: HTMLDivElement = document.createElement('div');
    input.tabIndex = 0;
    host.appendChild(input);
    document.body.appendChild(host);
    input.focus();
    return host;
  }

  it('routeEditingRole_inATextBox_goesNative', () => {
    expect(chords.routeEditingRole('copy', document)).toBe('native');
    expect(chords.routeEditingRole('undo', document)).toBe('native');
  });

  it('routeEditingRole_inTheCodeEditor_clipboardGoesNative_undoRedoAreServedByTheEditor', () => {
    // ⌘C with the caret in the editor used to copy the explorer's selected file; the editor is where
    // the user is typing, so the chord serves it. Monaco handles the platform's clipboard events, but
    // the platform's undo cannot see its model, so undo/redo run as Monaco actions.
    const triggered: string[] = [];
    monacoStub.editors = [
      {
        hasTextFocus: (): boolean => true,
        trigger: (_source: string, action: string): void => void triggered.push(action),
      },
    ];
    const host: HTMLElement = focusInside('monaco-editor');

    expect(chords.routeEditingRole('copy', document)).toBe('native');
    expect(chords.routeEditingRole('paste', document)).toBe('native');
    expect(chords.routeEditingRole('undo', document)).toBe('handled');
    expect(chords.routeEditingRole('redo', document)).toBe('handled');
    expect(triggered).toEqual(['undo', 'redo']);
    host.remove();
  });

  it('routeEditingRole_inTheTerminal_clipboardGoesNative_undoRedoAreSwallowed', () => {
    // xterm serves copy and paste from its own selection through the platform's events; undo means
    // nothing there and must not fall through to the tab as an explorer undo.
    const host: HTMLElement = focusInside('xterm');

    expect(chords.routeEditingRole('copy', document)).toBe('native');
    expect(chords.routeEditingRole('paste', document)).toBe('native');
    expect(chords.routeEditingRole('undo', document)).toBe('handled');
    host.remove();
  });

  it('routeEditingRole_whenFocusIsNotInAnEditingSurface_isUnclaimed', () => {
    box.blur();
    const button: HTMLButtonElement = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    expect(chords.routeEditingRole('copy', document)).toBe('unclaimed');
    button.remove();
  });

  it('handleSelectAll_whenTheChordCarriesAnotherModifier_doesNothing', () => {
    expect(chords.handleSelectAll(chord({ shiftKey: true }))).toBe(false);
    expect(chords.handleSelectAll(chord({ altKey: true }))).toBe(false);
  });

  it('handleSelectAll_whenAnotherKeyIsPressed_doesNothing', () => {
    expect(chords.handleSelectAll(chord({ key: 'b' }))).toBe(false);
  });

  it('handleSelectAll_whenTheCtrlChordIsPressedOnMacOs_doesNothing', () => {
    // Ctrl+A moves to the start of the line on macOS; only ⌘A selects.
    expect(chords.handleSelectAll(chord({ metaKey: false, ctrlKey: true }))).toBe(false);
  });

  it('handleSelectAll_whenTheCtrlChordIsPressedElsewhere_selectsItAll', () => {
    chords = build('win32');
    box.focus();

    expect(chords.handleSelectAll(chord({ metaKey: false, ctrlKey: true }))).toBe(true);
    expect(box.selectionEnd).toBe('the whole draft'.length);
  });
});
