import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { RecentItem, RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WelcomeModal } from '@shared/angular/services/welcome-modal/welcome-modal';
import { WelcomeScreen } from './welcome-screen';

/**
 * Exposes the protected members exercised by the missing-item tests.
 */
interface WelcomeInternals {
  openRecent(item: RecentItem): Promise<void>;
  missingItem(): RecentItem | null;
  removeMissing(): void;
  dismissMissing(): void;
}

describe('WelcomeScreen', () => {
  let fixture: ComponentFixture<WelcomeScreen>;
  let windows: FakeModalWindows;
  let host: HTMLElement;
  let tabs: Tabs;
  let modal: WelcomeModal;
  let recentItems: RecentItems;
  let internals: WelcomeInternals;

  beforeEach(async () => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [WelcomeScreen],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeScreen);
    tabs = TestBed.inject(Tabs);
    modal = TestBed.inject(WelcomeModal);
    recentItems = TestBed.inject(RecentItems);
    internals = fixture.componentInstance as unknown as WelcomeInternals;
    await fixture.whenStable();
    // The welcome cold-starts into its own window; its content renders into that window's host, so
    // the content queries below run against it rather than the (empty) component element.
    host = windows.contentHost!;
  });

  /**
   * Records a recent item and returns it, so a test can drive an open of a known entry. Outside
   * Electron the bridge is absent, so re-opening any such item fails — standing in for a moved file.
   */
  function seedRecent(): RecentItem {
    recentItems.record('/gone/report.md', 'report.md', 'markdown');
    return recentItems.items()[0];
  }

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  /**
   * Clicks the accordion header of the group with the given title and lets the window's content
   * settle.
   * @param title The group title.
   */
  async function clickGroupHeader(title: string): Promise<void> {
    Array.from(host.querySelectorAll<HTMLButtonElement>('.welcome__group-header'))
      .find((header: HTMLButtonElement): boolean => header.textContent?.trim().startsWith(title) ?? false)
      ?.click();
    await fixture.whenStable();
  }

  it('body_groupsAreGetStartedThenToolsThenRecentItems', () => {
    const titles: (string | undefined)[] = Array.from(
      host.querySelectorAll<HTMLElement>('.welcome__group-title'),
    ).map((heading: HTMLElement): string | undefined => heading.textContent?.trim());
    expect(titles).toEqual(['Get Started', 'Tools', 'Recent Items']);
  });

  it('accordion_opensGetStartedByDefaultAndOnlyOneGroupAtATime', async () => {
    // Get Started open: its actions show. Tools collapsed: its actions are absent.
    expect(host.textContent).toContain('New Terminal');
    expect(host.textContent).not.toContain('Containers');

    // Opening Tools collapses Get Started.
    await clickGroupHeader('Tools');
    expect(host.textContent).toContain('Containers');
    expect(host.textContent).toContain('AI Model Manager');
    expect(host.textContent).not.toContain('New Terminal');

    // Clicking the open group collapses it — both closed.
    await clickGroupHeader('Tools');
    expect(host.textContent).not.toContain('Containers');
    expect(host.textContent).not.toContain('New Terminal');
  });

  it('tools_settingsActionOpensTheSettingsTab', async () => {
    await clickGroupHeader('Tools');
    Array.from(host.querySelectorAll<HTMLButtonElement>('.welcome__action'))
      .find((action: HTMLButtonElement): boolean => action.textContent?.trim() === 'Settings')
      ?.click();
    expect(tabs.tabs().some((tab): boolean => tab.type === 'settings')).toBe(true);
  });

  it('coldStart_whenNoTabs_isVisibleWithItsGlow', () => {
    // Shown by having opened its (freestanding) window; its glow renders in that window's content.
    expect(windows.openWindows).toBe(1);
    expect(host.querySelector('.welcome__glow')).not.toBeNull();
    expect(host.querySelectorAll('.welcome__glow-blob').length).toBe(2);
  });

  it('withTabs_whenModalClosed_isNotVisible', async () => {
    tabs.open('terminal');
    await fixture.whenStable();

    expect(windows.openWindows).toBe(0);
  });

  it('withTabs_whenModalOpen_isVisibleAndLooksTheSame', async () => {
    tabs.open('terminal');
    modal.open();
    await fixture.whenStable();

    // Summoned over tabs it is the same window with the same treatment; only its role differs.
    const content: HTMLElement = windows.contentHost!;
    expect(windows.openWindows).toBe(1);
    expect(content.querySelector('.welcome__glow')).not.toBeNull();
    expect(content.querySelectorAll('.welcome__glow-blob').length).toBe(2);
  });

  it('openRecent_whenItemCannotBeOpened_promptsWithItsChoices', async () => {
    const item: RecentItem = seedRecent();

    await internals.openRecent(item);
    await fixture.whenStable();

    // The missing-item prompt is a nested modal, so it opens its own window over the welcome's; its
    // content is the most recently opened host.
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
