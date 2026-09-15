import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ProviderPage } from '@shared/api/ai-types';
import type { LspServerSummary } from '@shared/api/lsp-channels';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';

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

  it('render_whenServersAreInstalled_nestsALanguageProvidersBranchUnderTextEditor', async () => {
    // A leaf per language an installed server serves, under Text Editor — the same install-driven
    // rule as AI › Providers. Each leaf shows both the server rows and the editor overrides.
    // Drive the service's own catalogue signal rather than stubbing installedLanguages(): the tree is
    // a computed over that signal, and a stubbed method would leave it cached on the empty list.
    const lsp: LspSettings = TestBed.inject(LspSettings);
    (lsp as unknown as { registered: WritableSignal<readonly LspServerSummary[]> }).registered.set([
      { id: 'clangd', displayName: 'clangd', priority: 100, languages: ['cpp', 'c'] },
      { id: 'rust', displayName: 'rust-analyzer', priority: 100, languages: ['rust'] },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const rows: () => string[] = (): string[] =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="treeitem"]')).map(
        (row: Element): string => row.textContent?.trim() ?? '',
      );

    expect(rows()).not.toContain('Language Providers');
    (component as unknown as { toggleNode: (id: string) => void }).toggleNode('text-editor');
    fixture.detectChanges();
    expect(rows()).toContain('Language Providers');

    (component as unknown as { toggleNode: (id: string) => void }).toggleNode('language-providers');
    fixture.detectChanges();
    expect(rows()).toEqual(expect.arrayContaining(['C', 'C++', 'Rust']));

    (component as unknown as { onRowClick: (row: unknown) => void }).onRowClick({
      id: 'language-providers-cpp',
      data: { sectionId: 'language-providers', language: 'cpp', expandable: false },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-language-server-settings')).not.toBeNull();
    expect(element.querySelector('app-language-editor-overrides')?.textContent).toContain(
      'C++ files',
    );
    expect(
      element.querySelector('.settings__section-title')?.textContent?.replace(/\s+/g, ' '),
    ).toContain('Text Editor');
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
