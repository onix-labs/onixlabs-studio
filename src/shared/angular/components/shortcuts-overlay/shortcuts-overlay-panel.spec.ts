import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { ShortcutsOverlay } from '@shared/angular/services/shortcuts-overlay/shortcuts-overlay';
import { ShortcutsOverlayPanel } from './shortcuts-overlay-panel';

describe('ShortcutsOverlayPanel', () => {
  let fixture: ComponentFixture<ShortcutsOverlayPanel>;
  let overlay: ShortcutsOverlay;
  let keybindings: Keybindings;

  beforeEach(async (): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [ShortcutsOverlayPanel],
      providers: [
        provideKeybindingCatalogue({
          view: 'Code Editor',
          bindings: [{ id: 'code.save', description: 'Save the active document', chord: 'Mod+S' }],
        }),
        provideKeybindingCatalogue({
          view: 'Application',
          bindings: [
            { id: 'app.shortcuts', description: 'Show keyboard shortcuts', chord: 'Mod+/' },
          ],
        }),
      ],
    }).compileComponents();

    overlay = TestBed.inject(ShortcutsOverlay);
    keybindings = TestBed.inject(Keybindings);
    fixture = TestBed.createComponent(ShortcutsOverlayPanel);
    await fixture.whenStable();
  });

  afterEach((): void => {
    window.localStorage.removeItem('settings');
  });

  it('whenClosed_rendersNoVisibleDialog', (): void => {
    expect((fixture.nativeElement as HTMLElement).querySelector('.modal--visible')).toBeNull();
  });

  it('whenOpen_listsTheActiveScopeAndGlobalBindingsGroupedByView', async (): Promise<void> => {
    keybindings.register('tab-1', [{ id: 'code.save', command: (): void => void 0 }]);
    keybindings.registerGlobal([{ id: 'app.shortcuts', command: (): void => void 0 }]);
    overlay.toggle();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const views: string[] = Array.from(element.querySelectorAll('.shortcuts__view')).map(
      (heading: Element): string => heading.textContent?.trim() ?? '',
    );
    expect(views).toEqual(['Code Editor', 'Application']);
    expect(element.textContent).toContain('Save the active document');
    expect(element.querySelector('.shortcuts__chord')?.textContent).toContain('Ctrl+S');
  });

  it('whenOverrideExists_showsTheEffectiveChord', async (): Promise<void> => {
    keybindings.register('tab-1', [{ id: 'code.save', command: (): void => void 0 }]);
    keybindings.setOverride('code.save', 'Mod+Alt+P');
    overlay.toggle();
    await fixture.whenStable();

    const chord: string =
      (fixture.nativeElement as HTMLElement).querySelector('.shortcuts__chord')?.textContent ?? '';
    expect(chord).toContain('Ctrl+Alt+P');
  });
});
