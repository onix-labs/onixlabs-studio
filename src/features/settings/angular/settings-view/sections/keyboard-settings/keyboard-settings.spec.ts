import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { KeyboardSettingsSection } from './keyboard-settings';

describe('KeyboardSettingsSection', () => {
  let fixture: ComponentFixture<KeyboardSettingsSection>;
  let keybindings: Keybindings;
  let windows: FakeModalWindows;

  /**
   * Reads the keys a row's chord shows.
   * @param id The catalogued command identifier.
   * @returns Returns each key cap's text, or none when the command has no shortcut.
   */
  function keysOf(id: string): readonly string[] {
    const chord: Element | null = (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="chord-${id}"]`,
    );
    return [...(chord?.querySelectorAll('kbd') ?? [])].map(
      (key: Element): string => key.textContent ?? '',
    );
  }

  /**
   * Presses a row's Set Chord button.
   * @param id The catalogued command identifier.
   */
  async function setChord(id: string): Promise<void> {
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>(`[data-testid="set-chord-${id}"] button`)
      ?.click();
    await fixture.whenStable();
  }

  /**
   * Finds an element in the open Set Chord dialog.
   * @param testId The element's test id.
   * @returns Returns the element, or null when the dialog is closed or lacks it.
   */
  function inDialog(testId: string): HTMLElement | null {
    return windows.contentHost?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null;
  }

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [KeyboardSettingsSection],
      providers: [
        { provide: ModalWindows, useValue: windows },
        provideKeybindingCatalogue({
          view: 'Code Editor',
          bindings: [
            { id: 'code.save', description: 'Save the active document', chord: 'Mod+S' },
            { id: 'code.run', description: 'Run the active document', chord: 'Mod+R' },
          ],
        }),
        provideKeybindingCatalogue({
          view: 'Application',
          global: true,
          bindings: [{ id: 'app.closeTab', description: 'Close the active tab', chord: 'Mod+W' }],
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
    fixture.componentRef.setInput('view', 'Code Editor');
    await fixture.whenStable();
  });

  afterEach((): void => {
    window.localStorage.removeItem('settings');
  });

  it('listsOnlyTheCommandsOfItsCapability_withEachChordAsKeyCaps', (): void => {
    // Shortcuts live with their capability (Code › Keyboard), not in one list of every view.
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.keyboard__row').length).toBe(2);
    expect(element.textContent).not.toContain('Clear the terminal');
    expect(keysOf('code.save')).toEqual(['Ctrl', 'S']);
    expect(element.querySelector('[data-testid="set-chord-code.save"]')?.textContent).toContain(
      'Set Chord',
    );
  });

  it('appWidePage_listsTheApplicationCommandsAndSaysWhereTheRestAre', async (): Promise<void> => {
    fixture.componentRef.setInput('view', null);
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.keyboard__row').length).toBe(1);
    expect(element.textContent).toContain('Close the active tab');
    expect(element.textContent).not.toContain('Save the active document');
    expect(element.textContent).toContain('for example Code › Keyboard');
  });

  it('conflict_whenAViewShortcutTakesAnApplicationChord_warnsOnBothPages', async (): Promise<void> => {
    keybindings.setOverride('code.run', 'Mod+W');
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('over an Application shortcut, this one wins');

    fixture.componentRef.setInput('view', null);
    await fixture.whenStable();
    expect(element.textContent).toContain("A tab's own shortcut uses this key combination too");
  });

  it('setChord_opensTheDialogAndAcceptingAppliesTheChordAndShowsReset', async (): Promise<void> => {
    await setChord('code.save');
    expect(inDialog('chord-reading')).not.toBeNull();

    inDialog('chord-reading')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, altKey: true, cancelable: true }),
    );
    await fixture.whenStable();
    inDialog('chord-accept')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(keysOf('code.save')).toEqual(['Ctrl', 'Alt', 'P']);
    expect(windows.openWindows).toBe(0);
    expect((fixture.nativeElement as HTMLElement).querySelector('.keyboard__reset')).not.toBeNull();
  });

  it('clearedShortcut_showsNone', async (): Promise<void> => {
    keybindings.clearChord('code.save');
    await fixture.whenStable();

    expect(keysOf('code.save')).toEqual([]);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="chord-code.save"]')
        ?.textContent,
    ).toContain('None');
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

    expect(keysOf('code.save')).toEqual(['Ctrl', 'S']);
  });
});
