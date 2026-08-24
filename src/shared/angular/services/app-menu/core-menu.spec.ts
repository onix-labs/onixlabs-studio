import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Documents } from '@shared/angular/services/documents/documents';
import { Icon } from '@shared/angular/icons/icon';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AppMenu } from './app-menu';
import { MenuContribution, MenuEntry } from './app-menu-model';
import { CoreMenu } from './core-menu';

describe('CoreMenu', () => {
  let menu: AppMenu;

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
    const tabsStub: Partial<Tabs> = {
      activeTab: signal<Tab | undefined>(undefined),
      open: (): Tab => stubTab,
      close: (): void => undefined,
    };
    const documentsStub: Partial<Documents> = {
      openFile: (): Promise<void> => Promise.resolve(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Tabs, useValue: tabsStub },
        { provide: Documents, useValue: documentsStub },
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

  it('sections_whenComposed_putEditBetweenFileAndView', () => {
    const ids: readonly string[] = menu
      .sections()
      .map((section: MenuContribution): string => section.id);

    expect(ids.indexOf('edit')).toBeGreaterThan(ids.indexOf('file'));
    expect(ids.indexOf('edit')).toBeLessThan(ids.indexOf('view'));
  });
});
