import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { TabType } from '@shared/angular/services/tabs/tab';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { RecentItem, RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { WelcomeGetStarted } from './welcome-get-started';

/**
 * Exposes the protected members exercised by the missing-item tests.
 */
interface GetStartedInternals {
  openRecent(item: RecentItem): Promise<void>;
  missingItem(): RecentItem | null;
  removeMissing(): void;
  dismissMissing(): void;
}

describe('WelcomeGetStarted', () => {
  let fixture: ComponentFixture<WelcomeGetStarted>;
  let windows: FakeModalWindows;
  let host: HTMLElement;
  let recentItems: RecentItems;
  let internals: GetStartedInternals;
  let opened: TabType[];
  let newProjects: number;

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
    newProjects = 0;
    fixture.componentInstance.openTab.subscribe((type: TabType): void => void opened.push(type));
    fixture.componentInstance.newProject.subscribe((): void => void (newProjects += 1));
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

  it('actions_areTheEightWaysIn_inOrder', () => {
    expect(
      Array.from(host.querySelectorAll<HTMLElement>('.welcome__action-label')).map(
        (label: HTMLElement): string => label.textContent.trim(),
      ),
    ).toEqual([
      'Open Directory or File',
      'New Project',
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

  it('newProject_asksForTheCreateSection', () => {
    clickAction('New Project');

    expect(newProjects).toBe(1);
    expect(opened).toEqual([]);
  });

  it('anActionWithNothingBehindIt_doesNothing_andLooksIt', () => {
    clickAction('New Database Explorer');

    expect(opened).toEqual([]);
    expect(host.querySelector('.welcome__action--unavailable')?.textContent).toContain(
      'New Database Explorer',
    );
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
    expect(row.querySelector('button[aria-label="Show in Finder"]')).not.toBeNull();
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
    expect(prompt.querySelectorAll('.welcome__confirm-actions--stack app-button').length).toBe(3);
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
