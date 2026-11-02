import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ProviderPage } from '@shared/api/ai-types';
import type { LspServerSummary } from '@shared/api/lsp-channels';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';

import { Theme } from '@shared/angular/services/theme/theme';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import type { TreeRow } from '@shared/angular/components/tree-view/tree-view';
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

  it('render_artificialIntelligence_carriesNoLinksToTheAiManager', () => {
    // Prompt profiles and skills are managed in the AI Manager (#948); Settings no longer points at them.
    const view: {
      expandedNodes: WritableSignal<ReadonlySet<string>>;
      rows: () => readonly TreeRow[];
    } = component as unknown as {
      expandedNodes: WritableSignal<ReadonlySet<string>>;
      rows: () => readonly TreeRow[];
    };
    view.expandedNodes.set(new Set<string>(['ai']));
    const ids: readonly string[] = view.rows().map((row: TreeRow): string => row.id);

    expect(ids).toContain('ai-general');
    expect(ids).not.toContain('ai-prompts-leaf');
    expect(ids).not.toContain('ai-skills-leaf');
  });

  it('render_whenServersAreInstalled_nestsALanguagesBranchUnderCode', async () => {
    // A leaf per language an installed server serves, under Code — the same install-driven
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

    expect(rows()).not.toContain('Languages');
    (component as unknown as { toggleNode: (id: string) => void }).toggleNode('code');
    fixture.detectChanges();
    expect(rows()).toContain('Languages');

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
    // The trail names the language selected, not the first one in the branch.
    const crumbs: string[] = Array.from(element.querySelectorAll('.settings__crumb')).map(
      (crumb: Element): string => crumb.textContent?.trim() ?? '',
    );
    expect(crumbs).toEqual(['Code', 'Languages', 'C++']);
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

  it('render_headsEachGroupOfRoots_studioDocumentsCapabilitiesTools', () => {
    const ids: readonly string[] = (component as unknown as { rows: () => readonly TreeRow[] })
      .rows()
      .filter((row: TreeRow): boolean => row.heading !== undefined)
      .map((row: TreeRow): string => row.heading ?? '');

    expect(ids).toEqual(['Studio', 'Documents', 'Capabilities', 'Tools']);
  });

  it('moreActions_offersImportAndExport_andRunsThem', () => {
    const view: {
      menuItems: readonly { id: string; label: string }[];
      onMenu(id: string): void;
      transfer: { exportToFile(): Promise<string | null>; readFromFile(): Promise<unknown> };
    } = component as unknown as {
      menuItems: readonly { id: string; label: string }[];
      onMenu(id: string): void;
      transfer: { exportToFile(): Promise<string | null>; readFromFile(): Promise<unknown> };
    };
    const exported: ReturnType<typeof vi.spyOn> = vi
      .spyOn(view.transfer, 'exportToFile')
      .mockResolvedValue(null);
    const imported: ReturnType<typeof vi.spyOn> = vi
      .spyOn(view.transfer, 'readFromFile')
      .mockResolvedValue(null);

    expect(view.menuItems.map((item: { label: string }): string => item.label)).toEqual([
      'Import Settings',
      'Export Settings',
    ]);
    view.onMenu('settings.import');
    view.onMenu('settings.export');

    expect(imported).toHaveBeenCalledTimes(1);
    expect(exported).toHaveBeenCalledTimes(1);
  });

  describe('keyboard pages', () => {
    /**
     * Gets the ids of the tree rows with every branch expanded.
     * @returns Returns the row ids.
     */
    function allRowIds(): readonly string[] {
      const view: {
        expandedNodes: WritableSignal<ReadonlySet<string>>;
        rows: () => readonly { id: string }[];
      } = component as unknown as {
        expandedNodes: WritableSignal<ReadonlySet<string>>;
        rows: () => readonly { id: string }[];
      };
      view.expandedNodes.set(
        new Set<string>(['application', 'code', 'images', 'api-explorer', 'terminal']),
      );
      return view.rows().map((row: { id: string }): string => row.id);
    }

    it('render_eachCapabilityWithShortcuts_getsAKeyboardLeafUnderItsOwnRoot', () => {
      TestBed.inject(Keybindings).contribute({
        view: 'Code Editor',
        bindings: [{ id: 'test.save', description: 'Save the thing', chord: 'Mod+S' }],
      });
      TestBed.inject(Keybindings).contribute({
        view: 'Image Viewer',
        bindings: [{ id: 'test.zoom', description: 'Zoom in', chord: 'Mod+=' }],
      });

      const ids: readonly string[] = allRowIds();

      expect(ids).toContain('code-keyboard');
      expect(ids).toContain('images-keyboard');
      // Application › Keyboard stays, for the shortcuts that belong to no one capability.
      expect(ids).toContain('application-keyboard');
    });

    it('render_aRootWithNothingButAnAbsentKeyboardPage_isDropped', () => {
      // API Explorer carries only its Keyboard leaf; with no shortcuts catalogued it would be empty.
      const ids: readonly string[] = allRowIds();

      expect(ids).not.toContain('api-explorer');
      expect(ids).not.toContain('terminal-keyboard');
    });
  });

  describe('search', () => {
    /**
     * Types a query into the search box above the tree and returns the ids of the rows left standing.
     * @param query The text to type.
     * @returns Returns the visible row ids, in order.
     */
    async function search(query: string): Promise<readonly string[]> {
      const input: HTMLInputElement | null = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLInputElement>('.settings__search input');
      input!.value = query;
      input!.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();
      return (component as unknown as { rows: () => readonly { id: string }[] })
        .rows()
        .map((row: { id: string }): string => row.id);
    }

    it('search_byASettingsTitle_leavesTheLeafItLivesOnWithItsAncestorsOpen', async () => {
      // "Line height" is a Code › Appearance setting: the search lands on the page it lives on, with
      // the branch above it open even though the user never expanded it.
      const ids: readonly string[] = await search('line height');

      expect(ids).toContain('code');
      expect(ids).toContain('code-appearance-leaf');
      // The heading of the group holding the match stays; a group with no match loses its heading.
      expect(ids).toContain('group-documents');
      expect(ids).not.toContain('group-studio');
      expect(ids).not.toContain('application-general');
    });

    it('search_byAnAiSecuritySetting_findsSecurityAndPermissionsNotGeneral', async () => {
      // The registry holds every AI setting in one section that two pages share; a match has to land
      // on the page that actually shows it.
      const ids: readonly string[] = await search('permission posture');

      expect(ids).toContain('ai-security-leaf');
      expect(ids).not.toContain('ai-general');
    });

    it('search_byAVersionControlSetting_findsThePageItLivesOn', async () => {
      // Version Control is three pages: General draws several registry sections, Hosting and Cloning
      // one each.
      expect(await search('shallow clone')).toContain('source-control-cloning');
      expect(await search('ci runs scope')).toContain('source-control-hosting');
      const general: readonly string[] = await search('auto fetch');
      expect(general).toContain('source-control-general');
      expect(general).not.toContain('source-control-cloning');
    });

    it('search_byAgentShell_findsTerminalNotArtificialIntelligence', async () => {
      // Agent Shell moved from AI › General to Terminal, keeping its ai. key.
      const ids: readonly string[] = await search('agent shell');

      expect(ids).toContain('terminal-general');
      expect(ids).not.toContain('ai-general');
    });

    it('search_byABranchName_keepsEveryLeafBeneathIt', async () => {
      const ids: readonly string[] = await search('artificial');

      expect(ids).toContain('ai-general');
      expect(ids).toContain('ai-mission-control');
      expect(ids).not.toContain('terminal');
    });

    it('search_whenNothingMatches_saysSo', async () => {
      const ids: readonly string[] = await search('zzzz-nothing-is-called-this');

      expect(ids).toEqual([]);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('No settings match.');
    });

    it('search_whenCleared_restoresTheUsersOwnExpansion', async () => {
      await search('font size');
      const ids: readonly string[] = await search('');

      // Only Application starts expanded; the search's opened branches are not left behind.
      expect(ids).toContain('application-general');
      expect(ids).not.toContain('code-appearance-leaf');
    });
  });
});
