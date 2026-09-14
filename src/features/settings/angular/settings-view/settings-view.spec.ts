import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ProviderPage } from '@shared/api/ai-types';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';

import { Theme } from '@shared/angular/services/theme/theme';
import { SettingsView } from './settings-view';

describe('SettingsView', () => {
  let component: SettingsView;
  let fixture: ComponentFixture<SettingsView>;
  let theme: Theme;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [SettingsView],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsView);
    component = fixture.componentInstance;
    theme = TestBed.inject(Theme);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenAProviderPageIsSelected_showsItWhateverItsKind', async () => {
    // The provider pages are the open set an installed harness contributes (#653). The template once
    // enumerated seven companies, so a plugin bringing an eighth got an empty page for it.
    const providers: AiProviders = TestBed.inject(AiProviders);
    Object.defineProperty(providers, 'pages', {
      value: signal<readonly ProviderPage[]>([
        {
          id: 'echo',
          label: 'Echo',
          kinds: ['echo'],
          createKind: 'echo',
          methods: [],
          description: 'Echoes prompts back.',
        },
      ]),
    });
    (component as unknown as { section: WritableSignal<string> }).section.set('ai-provider-echo');
    fixture.detectChanges();
    await fixture.whenStable();

    const page: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      'app-ai-settings',
    );
    expect(page).not.toBeNull();
    expect(page?.textContent).toContain('Echoes prompts back.');
  });

  /**
   * Finds the dropdown whose options include the given value, so a specific appearance control (theme
   * or accent) can be targeted without depending on row order.
   * @param element The rendered settings view.
   * @param value The option value the target dropdown offers.
   * @returns Returns the matching select, or null.
   */
  function dropdownWithOption(element: HTMLElement, value: string): HTMLSelectElement | null {
    return (
      Array.from(element.querySelectorAll<HTMLSelectElement>('select')).find(
        (select: HTMLSelectElement): boolean =>
          Array.from(select.options).some(
            (option: HTMLOptionElement): boolean => option.value === value,
          ),
      ) ?? null
    );
  }

  it('selectMode_whenAModeOptionPicked_setsThatModeOnTheTheme', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement | null = dropdownWithOption(element, 'dark');

    select!.value = 'dark';
    select!.dispatchEvent(new Event('change'));

    expect(theme.mode()).toBe('dark');
  });

  it('selectAccent_whenAPresetPicked_setsThatAccentOnTheTheme', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const accent: HTMLSelectElement | null = dropdownWithOption(element, 'green');

    accent!.value = 'green';
    accent!.dispatchEvent(new Event('change'));

    expect(theme.accent()).toEqual({ kind: 'preset', id: 'green' });
  });

  it('render_whenAccentIsSelected_reflectsItInTheAccentDropdown', async () => {
    theme.setAccent({ kind: 'preset', id: 'pink' });
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const accent: HTMLSelectElement | null = dropdownWithOption(element, 'pink');

    expect(accent?.value).toBe('pink');
  });
});
