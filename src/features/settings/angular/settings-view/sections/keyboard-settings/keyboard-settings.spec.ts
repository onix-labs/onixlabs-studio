import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { KeyboardSettingsSection } from './keyboard-settings';

describe('KeyboardSettingsSection', () => {
  let fixture: ComponentFixture<KeyboardSettingsSection>;
  let keybindings: Keybindings;

  /**
   * Finds the chord-capture button for the row at the given index.
   * @param index The row index across all groups, in document order.
   * @returns Returns the chord button element.
   */
  function chordButton(index: number): HTMLButtonElement {
    const buttons: NodeListOf<HTMLButtonElement> = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('.keyboard__chord');
    return buttons[index];
  }

  beforeEach(async (): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [KeyboardSettingsSection],
      providers: [
        provideKeybindingCatalogue({
          view: 'Code Editor',
          bindings: [
            { id: 'code.save', description: 'Save the active document', chord: 'Mod+S' },
            { id: 'code.run', description: 'Run the active document', chord: 'Mod+R' },
          ],
        }),
        provideKeybindingCatalogue({
          view: 'Terminal',
          modShiftOnly: true,
          bindings: [
            { id: 'terminal.clear', description: 'Clear the terminal', chord: 'Mod+Shift+K' },
          ],
        }),
      ],
    }).compileComponents();

    keybindings = TestBed.inject(Keybindings);
    fixture = TestBed.createComponent(KeyboardSettingsSection);
    await fixture.whenStable();
  });

  afterEach((): void => {
    window.localStorage.removeItem('settings');
  });

  it('listsEveryCataloguedCommandGroupedByView', (): void => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const views: string[] = Array.from(element.querySelectorAll('.keyboard__view')).map(
      (heading: Element): string => heading.textContent?.trim() ?? '',
    );
    expect(views).toEqual(['Code Editor', 'Terminal']);
    expect(element.querySelectorAll('.keyboard__row').length).toBe(3);
    expect(chordButton(0).textContent).toContain('Ctrl+S');
  });

  it('capture_persistsTheChordAndShowsReset', async (): Promise<void> => {
    chordButton(0).click();
    await fixture.whenStable();
    expect(chordButton(0).textContent).toContain('Press a key combination');

    chordButton(0).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, altKey: true, cancelable: true }),
    );
    await fixture.whenStable();

    expect(chordButton(0).textContent).toContain('Ctrl+Alt+P');
    expect((fixture.nativeElement as HTMLElement).querySelector('.keyboard__reset')).not.toBeNull();
  });

  it('capture_escapeCancelsWithoutChanging', async (): Promise<void> => {
    chordButton(0).click();
    await fixture.whenStable();

    chordButton(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();

    expect(chordButton(0).textContent).toContain('Ctrl+S');
    expect((fixture.nativeElement as HTMLElement).querySelector('.keyboard__reset')).toBeNull();
  });

  it('capture_backspaceRestoresTheDefault', async (): Promise<void> => {
    keybindings.setOverride('code.save', 'Mod+Alt+P');
    await fixture.whenStable();

    chordButton(0).click();
    await fixture.whenStable();
    chordButton(0).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }),
    );
    await fixture.whenStable();

    expect(chordButton(0).textContent).toContain('Ctrl+S');
  });

  it('capture_whenTerminalOverrideDropsShift_showsTheRejection', async (): Promise<void> => {
    chordButton(2).click();
    await fixture.whenStable();
    chordButton(2).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }),
    );
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.keyboard__message--error')?.textContent).toContain(
      'Ctrl and Shift',
    );
    expect(chordButton(2).textContent).toContain('Ctrl+Shift+K');
  });

  it('conflictingChords_surfaceAWarning', async (): Promise<void> => {
    keybindings.setOverride('code.run', 'Mod+S');
    await fixture.whenStable();

    const warning: string =
      (fixture.nativeElement as HTMLElement).querySelector('.keyboard__message--warning')
        ?.textContent ?? '';
    expect(warning).toContain('uses this key combination');
  });

  it('reset_restoresTheDefaultChord', async (): Promise<void> => {
    keybindings.setOverride('code.save', 'Mod+Alt+P');
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.keyboard__reset')
      ?.click();
    await fixture.whenStable();

    expect(chordButton(0).textContent).toContain('Ctrl+S');
  });
});
