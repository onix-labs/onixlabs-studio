import { ComponentFixture, TestBed } from '@angular/core/testing';

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
  let host: HTMLElement;
  let tabs: Tabs;
  let modal: WelcomeModal;
  let recentItems: RecentItems;
  let internals: WelcomeInternals;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WelcomeScreen],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeScreen);
    host = fixture.nativeElement as HTMLElement;
    tabs = TestBed.inject(Tabs);
    modal = TestBed.inject(WelcomeModal);
    recentItems = TestBed.inject(RecentItems);
    internals = fixture.componentInstance as unknown as WelcomeInternals;
    fixture.detectChanges();
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

  it('coldStart_whenNoTabs_isVisibleWithItsGlow', () => {
    expect(host.querySelector('.modal--visible')).not.toBeNull();
    expect(host.querySelector('.welcome__glow')).not.toBeNull();
    expect(host.querySelectorAll('.welcome__glow-blob').length).toBe(2);
  });

  it('withTabs_whenModalClosed_isNotVisible', () => {
    tabs.open('terminal');
    fixture.detectChanges();

    expect(host.querySelector('.modal--visible')).toBeNull();
  });

  it('withTabs_whenModalOpen_isVisibleAndLooksTheSame', () => {
    tabs.open('terminal');
    modal.open();
    fixture.detectChanges();

    // Summoned over tabs it is the same window with the same treatment; only its role differs.
    expect(host.querySelector('.modal--visible')).not.toBeNull();
    expect(host.querySelector('.welcome__glow')).not.toBeNull();
    expect(host.querySelectorAll('.welcome__glow-blob').length).toBe(2);
  });

  it('openRecent_whenItemCannotBeOpened_promptsWithItsChoices', async () => {
    const item: RecentItem = seedRecent();

    await internals.openRecent(item);
    fixture.detectChanges();

    expect(internals.missingItem()).toBe(item);
    expect(host.querySelector('.welcome__confirm-message')).not.toBeNull();
    expect(host.querySelectorAll('.welcome__confirm-actions--stack app-button').length).toBe(3);
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
