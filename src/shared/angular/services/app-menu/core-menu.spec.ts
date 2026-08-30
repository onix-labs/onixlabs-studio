import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Documents } from '@shared/angular/services/documents/documents';
import { Help } from '@shared/angular/services/help/help';
import { SettingsNavigation } from '@shared/angular/services/settings-navigation/settings-navigation';
import { Icon } from '@shared/angular/icons/icon';
import { Tab, TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AppMenu } from './app-menu';
import { MenuContribution, MenuEntry } from './app-menu-model';
import { CoreMenu } from './core-menu';

describe('CoreMenu', () => {
  let menu: AppMenu;
  let activeTab: WritableSignal<Tab | undefined>;
  let opened: TabType[];
  let closed: string[];
  let openedFiles: number;
  let helped: string[];
  let settingsSections: string[];

  /**
   * Reads a merged section's entries by id.
   * @param id The section id.
   * @returns Returns the section's entries.
   */
  function itemsOf(id: string): readonly MenuEntry[] {
    return (
      menu.sections().find((section: MenuContribution): boolean => section.id === id)?.items ?? []
    );
  }

  beforeEach(() => {
    const stubTab: Tab = { id: 'stub', type: 'code', title: 'Stub', icon: Icon.CODE };
    opened = [];
    closed = [];
    openedFiles = 0;
    activeTab = signal<Tab | undefined>(undefined);
    const tabsStub: Partial<Tabs> = {
      activeTab,
      open: (type: TabType): Tab => {
        opened.push(type);
        return stubTab;
      },
      close: (id: string): void => void closed.push(id),
    };
    const documentsStub: Partial<Documents> = {
      openFile: (): Promise<void> => {
        openedFiles += 1;
        return Promise.resolve();
      },
    };
    helped = [];
    settingsSections = [];
    const helpStub: Partial<Help> = {
      openDocumentation: (): void => void helped.push('documentation'),
      openIssueReport: (): void => void helped.push('issue'),
      openReleaseNotes: (): void => void helped.push('releases'),
      showAbout: (): Promise<void> => {
        helped.push('about');
        return Promise.resolve();
      },
    };
    const settingsNavigationStub: Partial<SettingsNavigation> = {
      open: (section: string): void => void settingsSections.push(section),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Tabs, useValue: tabsStub },
        { provide: Documents, useValue: documentsStub },
        { provide: Help, useValue: helpStub },
        { provide: SettingsNavigation, useValue: settingsNavigationStub },
      ],
    });
    menu = TestBed.inject(AppMenu);
    TestBed.inject(CoreMenu);
    TestBed.tick();
  });

  it('edit_whateverTabIsInFront_offersTheEditingRoles', () => {
    // On macOS the application menu is what binds the editing chords into the window: without these
    // entries Cmd+X/C/V do nothing in any plain text box, whichever tab is in front.
    const roles: readonly (string | undefined)[] = itemsOf('edit')
      .filter((entry: MenuEntry): boolean => entry.kind !== 'separator')
      .map((entry: MenuEntry): string | undefined => entry.role);

    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste']);
  });

  it('edit_whenOffered_carriesNoSelectAll', () => {
    // Deliberate: the editors bind Cmd+A to their own selection model, and a core entry claiming the
    // chord would take it from them.
    const accelerators: readonly (string | undefined)[] = itemsOf('edit').map(
      (entry: MenuEntry): string | undefined => entry.accelerator,
    );

    expect(accelerators).not.toContain('CmdOrCtrl+A');
  });

  it('menu_whenAFileCommandIsChosen_runsIt', () => {
    menu.dispatch('core.file.new.code');
    menu.dispatch('core.file.open');
    menu.dispatch('core.file.settings');

    expect(opened).toEqual(['code', 'settings']);
    expect(openedFiles).toBe(1);
  });

  it('menu_whenAToolIsChosen_opensThatTool', () => {
    menu.dispatch('core.view.tools.mission-control');

    expect(opened).toEqual(['mission-control']);
  });

  it('closeTab_whenATabIsActive_closesThatTabAndIsOtherwiseDisabled', () => {
    // Enablement and the handler read the same active tab, so the disabled entry cannot close anything.
    expect(
      itemsOf('file').find((entry: MenuEntry): boolean => entry.id === 'core.file.closeTab')
        ?.enabled,
    ).toBe(false);

    activeTab.set({ id: 'tab-1', type: 'code', title: 'One', icon: Icon.CODE });
    TestBed.tick();
    menu.dispatch('core.file.closeTab');

    expect(closed).toEqual(['tab-1']);
  });

  it('help_whenAnEntryIsChosen_runsIt', () => {
    menu.dispatch('core.help.documentation');
    menu.dispatch('core.help.issue');
    menu.dispatch('core.help.releases');
    menu.dispatch('core.help.about');

    expect(helped).toEqual(['documentation', 'issue', 'releases', 'about']);
  });

  it('help_whenKeyboardShortcutsIsChosen_landsOnTheKeyboardSection', () => {
    // Opening Settings alone would land wherever it was last left, which is not what the label says.
    menu.dispatch('core.help.shortcuts');

    expect(settingsSections).toEqual(['keyboard']);
  });

  it('sections_whenComposed_endWithHelp', () => {
    // Help is last on every platform's menu bar, so it is contributed with the trailing sections.
    const ids: readonly string[] = menu
      .sections()
      .map((section: MenuContribution): string => section.id);

    expect(ids.at(-1)).toBe('help');
  });

  it('sections_whenComposed_putEditBetweenFileAndView', () => {
    const ids: readonly string[] = menu
      .sections()
      .map((section: MenuContribution): string => section.id);

    expect(ids.indexOf('edit')).toBeGreaterThan(ids.indexOf('file'));
    expect(ids.indexOf('edit')).toBeLessThan(ids.indexOf('view'));
  });
});
