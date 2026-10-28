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
    serverPaths: { clangd: '/usr/bin/clangd' },
    serverArgs: {},
    languageServers: {},
    serverSettings: {},
  };
}

describe('LanguageServerSettings', () => {
  let installed: Record<string, readonly LspServerSummary[]>;
  let selection: Record<string, string>;
  let disabled: Set<string>;
  let calls: string[];
  let stored: Record<string, boolean | string>;

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
            setServerPath: (id: string, value: string): Promise<void> => {
              calls.push(`serverPath:${id}:${value}`);
              return Promise.resolve();
            },
            serverSetting: (_id: string, section: string): boolean | string | undefined =>
              stored[section],
            setServerSetting: (
              id: string,
              section: string,
              value: boolean | string | null,
            ): Promise<void> => {
              calls.push(`setting:${id}:${section}:${String(value)}`);
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
    stored = {};
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

  describe('settings the server declares (#1143)', () => {
    const ROSLYN: LspServerSummary = {
      ...server('csharp', ['csharp']),
      settings: [
        {
          section: 'projects.dotnet_enable_automatic_restore',
          label: 'Restore packages',
          description: 'Restore or ask first.',
          default: true,
          options: [
            { value: true, label: 'Automatically' },
            { value: false, label: 'Ask first' },
          ],
        },
        {
          section: 'projects.dotnet_enable_file_based_programs',
          label: 'File-based programs',
          description: 'Support for a file of its own.',
          default: true,
        },
      ],
    };

    /**
     * Finds the row a setting is shown in.
     * @param element The page.
     * @param label The setting's label.
     * @returns Returns the row.
     */
    function row(element: HTMLElement, label: string): HTMLElement {
      return [...element.querySelectorAll<HTMLElement>('app-setting-row')].find(
        (candidate: HTMLElement): boolean => candidate.textContent?.includes(label) ?? false,
      )!;
    }

    it('areShown_withTheServersDefaults_whileTheUserHasSetNothing', async () => {
      installed = { csharp: [ROSLYN] };
      selection = { csharp: 'csharp' };
      const element: HTMLElement = await render('csharp', 'C#');

      expect(row(element, 'Restore packages').querySelector('select')?.value).toBe('true');
      expect(
        row(element, 'File-based programs').querySelector<HTMLInputElement>('app-toggle input')
          ?.checked,
      ).toBe(true);
    });

    it('showTheUsersValue_andStoreAChange_clearingItWhenItIsTheDefaultAgain', async () => {
      installed = { csharp: [ROSLYN] };
      selection = { csharp: 'csharp' };
      stored = { 'projects.dotnet_enable_automatic_restore': false };
      const element: HTMLElement = await render('csharp', 'C#');
      const select: HTMLSelectElement = row(element, 'Restore packages').querySelector('select')!;
      expect(select.value).toBe('false');

      select.value = 'true';
      select.dispatchEvent(new Event('change'));
      row(element, 'File-based programs')
        .querySelector<HTMLInputElement>('app-toggle input')!
        .click();

      expect(calls).toEqual([
        'setting:csharp:projects.dotnet_enable_automatic_restore:null',
        'setting:csharp:projects.dotnet_enable_file_based_programs:false',
      ]);
    });

    it('finerSettings_areFoldedAwayUnderAdvanced (#1145)', async () => {
      installed = {
        csharp: [
          {
            ...ROSLYN,
            settings: [
              ...(ROSLYN.settings ?? []),
              {
                section: 'csharp|inlay_hints.dotnet_enable_inlay_hints_for_other_parameters',
                label: 'Names for other arguments',
                description: 'Every other argument.',
                default: false,
                advanced: true,
              },
            ],
          },
        ],
      };
      selection = { csharp: 'csharp' };
      const element: HTMLElement = await render('csharp', 'C#');
      const accordion: HTMLElement | null = element.querySelector('app-accordion');

      expect(accordion?.textContent).toContain('Advanced');
      expect(row(element, 'Restore packages').closest('app-accordion')).toBeNull();
      expect(element.textContent).not.toContain('Names for other arguments');

      accordion?.querySelector<HTMLElement>('button')?.click();
      await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve));
      TestBed.tick();

      expect(row(element, 'Names for other arguments').closest('app-accordion')).toBe(accordion);
    });

    it('aServerThatDeclaresNone_showsNone', async () => {
      installed = { python: [server('pyright', ['python'])] };
      selection = { python: 'pyright' };
      const element: HTMLElement = await render('python', 'Python');

      expect(element.textContent).not.toContain('Restore packages');
    });
  });
});
