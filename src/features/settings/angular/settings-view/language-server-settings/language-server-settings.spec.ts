import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LspServerSummary, LspSettings as LspSettingsData } from '@shared/api/lsp-channels';
import { signal, Signal } from '@angular/core';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { LanguageServerSettings } from './language-server-settings';

/**
 * Builds a server summary for the tests.
 * @param id The server identifier.
 * @param languages The languages it serves.
 * @returns Returns the summary.
 */
function server(id: string, languages: readonly string[]): LspServerSummary {
  return { id, displayName: id, languages, priority: 100 };
}

/**
 * Builds the settings payload the fake service reports.
 * @returns Returns the settings.
 */
function settingsData(): LspSettingsData {
  return {
    disabledServers: [],
    javaPath: null,
    dotnetPath: null,
    clangdPath: '/usr/bin/clangd',
    typescriptServerPath: null,
    serverArgs: {},
    languageServers: {},
  };
}

describe('LanguageServerSettings', () => {
  let installed: Record<string, readonly LspServerSummary[]>;
  let selection: Record<string, string>;
  let disabled: Set<string>;
  let calls: string[];

  /**
   * Renders the page for a language with a fake settings service.
   * @param language The language identifier.
   * @param languageName The display name.
   * @returns Returns the rendered element.
   */
  async function render(language: string, languageName: string): Promise<HTMLElement> {
    const data: Signal<LspSettingsData> = signal<LspSettingsData>(settingsData()).asReadonly();
    TestBed.configureTestingModule({
      imports: [LanguageServerSettings],
      providers: [
        {
          provide: LspSettings,
          useValue: {
            settings: data,
            serversForLanguage: (id: string): readonly LspServerSummary[] => installed[id] ?? [],
            serverForLanguage: (id: string): string | null => selection[id] ?? null,
            isDisabled: (id: string): boolean => disabled.has(id),
            serverArgsText: (): string => '--log 4',
            setServerForLanguage: (id: string, serverId: string | null): Promise<void> => {
              calls.push(`choose:${id}:${serverId}`);
              return Promise.resolve();
            },
            setServerEnabled: (id: string, value: boolean): Promise<void> => {
              calls.push(`enabled:${id}:${value}`);
              return Promise.resolve();
            },
            setServerArgs: (id: string, value: string): Promise<void> => {
              calls.push(`args:${id}:${value}`);
              return Promise.resolve();
            },
            setClangdPath: (value: string): Promise<void> => {
              calls.push(`clangdPath:${value}`);
              return Promise.resolve();
            },
          },
        },
      ],
    });
    const fixture: ComponentFixture<LanguageServerSettings> =
      TestBed.createComponent(LanguageServerSettings);
    fixture.componentRef.setInput('language', language);
    fixture.componentRef.setInput('languageName', languageName);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    installed = {};
    selection = {};
    disabled = new Set<string>();
    calls = [];
  });

  it('oneServer_offersNoChoice', async () => {
    installed = { python: [server('pyright', ['python'])] };
    selection = { python: 'pyright' };
    const element: HTMLElement = await render('python', 'Python');

    expect(element.querySelector('app-dropdown')).toBeNull();
    expect(element.textContent).toContain('Served by pyright');
  });

  it('twoServers_offersTheChoice', async () => {
    installed = { python: [server('pyright', ['python']), server('ty', ['python'])] };
    selection = { python: 'pyright' };
    const element: HTMLElement = await render('python', 'Python');

    expect(element.querySelector('app-dropdown')).not.toBeNull();
    expect(element.querySelector('select')?.value).toBe('pyright');
  });

  it('choosingAServer_writesTheSelection', async () => {
    installed = { python: [server('pyright', ['python']), server('ty', ['python'])] };
    selection = { python: 'pyright' };
    const element: HTMLElement = await render('python', 'Python');
    const select: HTMLSelectElement = element.querySelector('select')!;
    select.value = 'ty';
    select.dispatchEvent(new Event('change'));

    expect(calls).toContain('choose:python:ty');
  });

  it('enabledToggle_reflectsAndWritesTheActiveServer', async () => {
    installed = { rust: [server('rust', ['rust'])] };
    selection = { rust: 'rust' };
    disabled = new Set<string>(['rust']);
    const element: HTMLElement = await render('rust', 'Rust');
    const toggle: HTMLInputElement = element.querySelector('app-toggle input')!;

    expect(toggle.checked).toBe(false);
    toggle.click();
    expect(calls).toContain('enabled:rust:true');
  });

  it('languageWithAToolPath_showsIt', async () => {
    installed = { cpp: [server('clangd', ['cpp', 'c'])] };
    selection = { cpp: 'clangd' };
    const element: HTMLElement = await render('cpp', 'C++');

    expect(element.textContent).toContain('Custom clangd path');
    const fields: NodeListOf<HTMLInputElement> = element.querySelectorAll('app-text-field input');
    expect([...fields].some((f: HTMLInputElement): boolean => f.value === '/usr/bin/clangd')).toBe(
      true,
    );
  });

  it('languageWithNoToolPath_showsNone', async () => {
    installed = { rust: [server('rust', ['rust'])] };
    selection = { rust: 'rust' };
    const element: HTMLElement = await render('rust', 'Rust');

    expect(element.textContent).not.toContain('path');
  });

  it('argumentsField_writesToTheActiveServer', async () => {
    installed = { rust: [server('rust', ['rust'])] };
    selection = { rust: 'rust' };
    const element: HTMLElement = await render('rust', 'Rust');
    const field: HTMLInputElement = element.querySelector('app-text-field input')!;
    field.value = '--verbose';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new Event('change'));

    expect(calls.some((c: string): boolean => c.startsWith('args:rust:'))).toBe(true);
  });
});
