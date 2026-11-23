import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { TabType } from '@shared/angular/services/tabs/tab';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { RecentItem, RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { OPEN_IN_FILE_SYSTEM_LABEL } from '@shared/angular/services/shell/shell-labels';
import { WelcomeGetStarted } from './welcome-get-started';

/**
 * Exposes the protected members exercised by the missing-item tests.
 */
interface GetStartedInternals {
  openRecent(item: RecentItem): Promise<void>;
  missingItem(): RecentItem | null;
  removeMissing(): void;
  locateMissing(): Promise<void>;
  dismissMissing(): void;
}

describe('WelcomeGetStarted', () => {
  let fixture: ComponentFixture<WelcomeGetStarted>;
  let windows: FakeModalWindows;
  let host: HTMLElement;
  let recentItems: RecentItems;
  let internals: GetStartedInternals;
  let opened: TabType[];

  beforeEach(async () => {
    // Recent items persist to local storage, so one test's items would otherwise outlive it.
    localStorage.clear();
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [WelcomeGetStarted],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeGetStarted);
    recentItems = TestBed.inject(RecentItems);
    internals = fixture.componentInstance as unknown as GetStartedInternals;
    opened = [];
    fixture.componentInstance.openTab.subscribe((type: TabType): void => void opened.push(type));
    await fixture.whenStable();
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Records a recent item and returns it, so a test can drive an open of a known entry. Outside
   * Electron the bridge is absent, so re-opening any such item fails — standing in for a moved file.
   * @returns Returns the item.
   */
  function seedRecent(): RecentItem {
    recentItems.record('/gone/report.md', 'report.md', 'markdown');
    return recentItems.items()[0];
  }

  /**
   * Clicks the action with the given label.
   * @param label The action's label.
   */
  function clickAction(label: string): void {
    Array.from(host.querySelectorAll<HTMLButtonElement>('.welcome__action'))
      .find((action: HTMLButtonElement): boolean => action.textContent?.trim() === label)
      ?.click();
  }

  it('actions_areTheSevenWaysIn_inOrder', () => {
    expect(
      Array.from(host.querySelectorAll<HTMLElement>('.welcome__action-label')).map(
        (label: HTMLElement): string => label.textContent.trim(),
      ),
    ).toEqual([
      'Open Directory or File',
      'New Code File',
      'New Markdown File',
      'New Terminal',
      'New Agent',
      'New API Explorer',
      'New Database Explorer',
    ]);
  });

  it('aNewTabAction_asksForItsTab', () => {
    clickAction('New Agent');
    clickAction('New API Explorer');

    expect(opened).toEqual(['agent', 'api-explorer']);
  });

  it('hasNoNewProjectAction_becauseCreateSomethingIsItsOwnTab', () => {
    expect(host.textContent).not.toContain('New Project');
  });

  it('newDatabaseExplorer_asksForItsTab_andNoActionLooksUnavailable', () => {
    clickAction('New Database Explorer');

    expect(opened).toEqual(['database-explorer']);
    expect(host.querySelector('.welcome__action--unavailable')).toBeNull();
  });

  it('recentItems_whenNone_showTheEmptyState', () => {
    expect(host.querySelector('.welcome__recent-empty-title')?.textContent).toContain(
      'No recent items',
    );
  });

  it('recentItems_filterAndSearch', async () => {
    recentItems.record('/a/notes.md', 'notes.md', 'markdown');
    recentItems.record('/a/main.ts', 'main.ts', 'code');
    await fixture.whenStable();
    expect(host.querySelectorAll('.welcome__recent-row')).toHaveLength(2);

    const filter: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
      '.welcome__recent-filter select',
    )!;
    filter.value = 'code';
    filter.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(host.querySelectorAll('.welcome__recent-row')).toHaveLength(1);

    const search: HTMLInputElement = host.querySelector<HTMLInputElement>(
      '.welcome__searchbox input',
    )!;
    search.value = 'nothing-like-it';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(host.querySelector('.welcome__recent-empty-title')?.textContent).toContain(
      'No matching items',
    );
  });

  it('aRecentItem_offersItsActionsInline_andRemoveForgetsIt', async () => {
    recentItems.record('/a/notes.md', 'notes.md', 'markdown');
    await fixture.whenStable();
    const row: HTMLElement = host.querySelector<HTMLElement>('.welcome__recent-row')!;

    // No overflow menu: the row carries its commands as buttons.
    expect(row.querySelector('app-menu')).toBeNull();
    expect(row.querySelector(`button[aria-label="${OPEN_IN_FILE_SYSTEM_LABEL}"]`)).not.toBeNull();
    row.querySelector<HTMLButtonElement>('button[aria-label="Remove item"]')!.click();
    await fixture.whenStable();

    expect(recentItems.items()).toEqual([]);
  });

  it('openRecent_whenItemCannotBeOpened_promptsWithItsChoices', async () => {
    const item: RecentItem = seedRecent();

    await internals.openRecent(item);
    await fixture.whenStable();

    // The missing-item prompt is a modal, so it opens its own window; its content is the most
    // recently opened host.
    expect(internals.missingItem()).toBe(item);
    const prompt: HTMLElement = windows.contentHost!;
    expect(prompt.querySelector('.welcome__confirm-message')).not.toBeNull();
    // One row, primary first and Cancel last (#894).
    expect(
      [...prompt.querySelectorAll('app-button-row button')].map(
        (button: Element): string => button.textContent?.trim() ?? '',
      ),
    ).toEqual(['Locate', 'Remove', 'Cancel']);
  });

  it('removeMissing_whenPrompted_forgetsTheItemAndDismisses', async () => {
    const item: RecentItem = seedRecent();
    await internals.openRecent(item);

    internals.removeMissing();

    expect(internals.missingItem()).toBeNull();
    expect(recentItems.items().some((entry: RecentItem): boolean => entry.path === item.path)).toBe(
      false,
    );
  });

  describe('locateMissing', () => {
    let opener: FileOpener;
    let reported: number;

    beforeEach(() => {
      opener = TestBed.inject(FileOpener);
      reported = 0;
      fixture.componentInstance.opened.subscribe((): void => {
        reported += 1;
      });
    });

    /**
     * Stands in for the folder dialog: records the chosen folder as opening it does.
     * @param path The folder the user chose, or null when they cancelled.
     */
    function chooseFolder(path: string | null): void {
      vi.spyOn(opener, 'openFolderInteractive').mockImplementation((): Promise<string | null> => {
        if (path !== null) {
          recentItems.record(path, 'project', 'directory');
        }
        return Promise.resolve(path);
      });
    }

    /**
     * Records a directory and opens it, which fails outside Electron, so the prompt shows.
     * @param pinned Whether it is starred.
     */
    async function promptForDirectory(pinned: boolean = false): Promise<void> {
      recentItems.record('/gone/project', 'project', 'directory');
      if (pinned) {
        recentItems.togglePin('/gone/project');
      }
      await internals.openRecent(recentItems.items()[0]);
    }

    it('ofAFolderThatMoved_opensIt_andReplacesTheOldEntry', async () => {
      await promptForDirectory(true);
      chooseFolder('/moved/project');

      await internals.locateMissing();

      expect(recentItems.items()).toMatchObject([{ path: '/moved/project', pinned: true }]);
      expect(internals.missingItem()).toBeNull();
      expect(reported).toBe(1);
    });

    it('ofAFolderStillWhereItWas_keepsItsEntryAndItsStar', async () => {
      await promptForDirectory(true);
      chooseFolder('/gone/project');

      await internals.locateMissing();

      expect(recentItems.items()).toMatchObject([{ path: '/gone/project', pinned: true }]);
      expect(reported).toBe(1);
    });

    it('whereTheNewPathIsAlreadyStarred_leavesItStarred', async () => {
      recentItems.record('/moved/project', 'project', 'directory');
      recentItems.togglePin('/moved/project');
      await promptForDirectory(true);
      chooseFolder('/moved/project');

      await internals.locateMissing();

      expect(recentItems.items()).toMatchObject([{ path: '/moved/project', pinned: true }]);
    });

    it('whenTheDialogIsCancelled_leavesThePromptUp', async () => {
      await promptForDirectory();
      chooseFolder(null);

      await internals.locateMissing();

      expect(internals.missingItem()?.path).toBe('/gone/project');
      expect(reported).toBe(0);
    });

    it('ofAFile_reopensTheChosenFile', async () => {
      await internals.openRecent(seedRecent());
      vi.spyOn(TestBed.inject(FileSystem), 'pickPath').mockResolvedValue('/moved/report.md');
      vi.spyOn(opener, 'reopenFile').mockImplementation((path: string): Promise<boolean> => {
        recentItems.record(path, 'report.md', 'markdown');
        return Promise.resolve(true);
      });

      await internals.locateMissing();

      expect(recentItems.items()).toMatchObject([{ path: '/moved/report.md' }]);
      expect(reported).toBe(1);
    });
  });

  it('dismissMissing_whenPrompted_keepsTheItemButHidesThePrompt', async () => {
    const item: RecentItem = seedRecent();
    await internals.openRecent(item);

    internals.dismissMissing();

    expect(internals.missingItem()).toBeNull();
    expect(recentItems.items().some((entry: RecentItem): boolean => entry.path === item.path)).toBe(
      true,
    );
  });
});
