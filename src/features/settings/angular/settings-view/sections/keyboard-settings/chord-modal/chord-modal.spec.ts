import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Keybindings, ResolvedBinding } from '@shared/angular/services/keybindings/keybindings';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { ChordModal } from './chord-modal';

describe('ChordModal', () => {
  let fixture: ComponentFixture<ChordModal>;
  let keybindings: Keybindings;
  let windows: FakeModalWindows;
  let closed: number;

  /**
   * Finds an element in the dialog.
   * @param testId The element's test id.
   * @returns Returns the element, or null when the dialog is closed or lacks it.
   */
  function inDialog(testId: string): HTMLElement | null {
    return windows.contentHost?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null;
  }

  /**
   * Reads the keys the dialog shows.
   * @returns Returns each key cap's text.
   */
  function reading(): readonly string[] {
    return [...(inDialog('chord-reading')?.querySelectorAll('kbd') ?? [])].map(
      (key: Element): string => key.textContent ?? '',
    );
  }

  /**
   * Presses a key in the dialog's reading.
   * @param init The key event's properties.
   * @returns Returns the dispatched event, so a spec can see whether it was consumed.
   */
  async function press(init: KeyboardEventInit): Promise<KeyboardEvent> {
    const event: KeyboardEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    inDialog('chord-reading')?.dispatchEvent(event);
    await fixture.whenStable();
    return event;
  }

  /**
   * Presses one of the dialog's buttons.
   * @param testId The button's test id.
   */
  async function choose(testId: string): Promise<void> {
    inDialog(testId)?.querySelector('button')?.click();
    await fixture.whenStable();
  }

  /**
   * Opens the dialog for a command.
   * @param id The catalogued command identifier.
   */
  async function open(id: string): Promise<void> {
    const binding: ResolvedBinding | undefined = keybindings
      .resolvedCatalogue()
      .find((candidate: ResolvedBinding): boolean => candidate.id === id);
    fixture.componentRef.setInput('binding', binding);
    await fixture.whenStable();
  }

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    closed = 0;
    await TestBed.configureTestingModule({
      imports: [ChordModal],
      providers: [
        { provide: ModalWindows, useValue: windows },
        provideKeybindingCatalogue({
          view: 'Code Editor',
          bindings: [{ id: 'code.save', description: 'Save the active document', chord: 'Mod+S' }],
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
    fixture = TestBed.createComponent(ChordModal);
    fixture.componentInstance.closed.subscribe((): void => void (closed += 1));
    fixture.componentRef.setInput('binding', undefined);
    await fixture.whenStable();
  });

  afterEach((): void => {
    window.localStorage.removeItem('settings');
  });

  it('opensShowingTheCurrentChordAndTheCommand', async (): Promise<void> => {
    await open('code.save');

    expect(reading()).toEqual(['Ctrl', 'S']);
    expect(windows.contentHost?.textContent).toContain('Set Chord');
    expect(windows.contentHost?.textContent).toContain('Save the active document · Code Editor');
  });

  it('readsTheNextChordPressed_withoutApplyingItUntilAccept', async (): Promise<void> => {
    await open('code.save');

    const event: KeyboardEvent = await press({ key: 't', ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(reading()).toEqual(['Ctrl', 'Shift', 'T']);
    expect(keybindings.chordFor('code.save')).toBe('Mod+S');

    await choose('chord-accept');

    expect(keybindings.chordFor('code.save')).toBe('Mod+Shift+T');
    expect(closed).toBe(1);
  });

  it('enter_acceptsRatherThanBeingRead', async (): Promise<void> => {
    await open('code.save');
    await press({ key: 'p', ctrlKey: true, altKey: true });

    await press({ key: 'Enter' });

    expect(keybindings.chordFor('code.save')).toBe('Mod+Alt+P');
    expect(closed).toBe(1);
  });

  it('cancel_leavesTheShortcutAsItWas', async (): Promise<void> => {
    await open('code.save');
    await press({ key: 'p', ctrlKey: true, altKey: true });

    await choose('chord-cancel');

    expect(keybindings.chordFor('code.save')).toBe('Mod+S');
    expect(closed).toBe(1);
  });

  it('escape_isLeftToTheDialogToCancel', async (): Promise<void> => {
    await open('code.save');

    const event: KeyboardEvent = await press({ key: 'Escape' });

    expect(event.defaultPrevented).toBe(false);
    expect(reading()).toEqual(['Ctrl', 'S']);
  });

  it('clearThenAccept_leavesTheCommandWithNoShortcut', async (): Promise<void> => {
    await open('code.save');

    await choose('chord-clear');
    expect(reading()).toEqual([]);
    expect(inDialog('chord-reading')?.textContent).toContain('No shortcut');

    await choose('chord-accept');

    expect(keybindings.chordFor('code.save')).toBe('');
    expect(keybindings.resolvedCatalogue()[0].overridden).toBe(true);
  });

  it('acceptingTheDefault_restoresItRatherThanOverriding', async (): Promise<void> => {
    keybindings.setOverride('code.save', 'Mod+Alt+P');
    await open('code.save');

    await press({ key: 's', ctrlKey: true });
    await choose('chord-accept');

    expect(keybindings.resolvedCatalogue()[0].overridden).toBe(false);
  });

  it('anInvalidChord_explainsWhyAndCannotBeAccepted', async (): Promise<void> => {
    await open('terminal.clear');

    await press({ key: 'k', ctrlKey: true });

    expect(windows.contentHost?.textContent).toContain('Ctrl and Shift');
    expect(inDialog('chord-accept')?.querySelector('button')?.disabled).toBe(true);
    await press({ key: 'Enter' });
    expect(keybindings.chordFor('terminal.clear')).toBe('Mod+Shift+K');
    expect(closed).toBe(0);
  });

  it('standsTheMenusShortcutsDownWhileOpen', async (): Promise<void> => {
    const menu: AppMenu = TestBed.inject(AppMenu);
    menu.contribute(
      'core',
      [
        {
          id: 'file',
          label: 'File',
          items: [{ id: 'save', label: 'Save', binding: 'code.save', run: (): void => undefined }],
        },
      ],
      0,
    );
    TestBed.tick();
    const saveChord: KeyboardEvent = new KeyboardEvent('keydown', { key: 's', ctrlKey: true });
    expect(menu.dispatchChord(saveChord)).toBe(true);

    await open('code.save');
    expect(menu.dispatchChord(saveChord)).toBe(false);

    fixture.componentRef.setInput('binding', undefined);
    await fixture.whenStable();
    expect(menu.dispatchChord(saveChord)).toBe(true);
  });
});
