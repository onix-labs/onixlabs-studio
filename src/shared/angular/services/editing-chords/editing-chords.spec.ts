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
