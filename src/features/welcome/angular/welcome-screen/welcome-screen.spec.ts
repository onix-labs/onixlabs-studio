import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WelcomeModal } from '@shared/angular/services/welcome-modal/welcome-modal';
import { WelcomeScreen } from './welcome-screen';

describe('WelcomeScreen', () => {
  let fixture: ComponentFixture<WelcomeScreen>;
  let windows: FakeModalWindows;
  let host: HTMLElement;
  let tabs: Tabs;
  let modal: WelcomeModal;

  beforeEach(async () => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [WelcomeScreen],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeScreen);
    tabs = TestBed.inject(Tabs);
    modal = TestBed.inject(WelcomeModal);
    await fixture.whenStable();
    // The welcome cold-starts into its own window; its content renders into that window's host, so
    // the content queries below run against it rather than the (empty) component element.
    host = windows.contentHost!;
  });

  /**
   * Gets the section tabs.
   * @returns Returns them, in order.
   */
  function sectionTabs(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.welcome__tab'));
  }

  /**
   * Gets the section tab with the given label.
   * @param label The tab's label.
   * @returns Returns the tab.
   */
  function sectionTab(label: string): HTMLButtonElement {
    const tab: HTMLButtonElement | undefined = sectionTabs().find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    );
    if (tab === undefined) {
      throw new Error(`No section tab "${label}"`);
    }
    return tab;
  }

  /**
   * Gets the section element that is showing.
   * @returns Returns its tag name.
   */
  function shownSection(): string {
    const shown: Element[] = Array.from(host.querySelectorAll('.welcome__panel > *:not([hidden])'));
    expect(shown).toHaveLength(1);
    return shown[0].tagName.toLowerCase();
  }

  it('tabs_areTheShownSections_inOrder', () => {
    expect(sectionTabs().map((tab: HTMLButtonElement): string => tab.textContent.trim())).toEqual([
      'Get Started',
      'Tools',
    ]);
  });

  it('createSomethingAndSourceControl_areHidden_untilTheyAreReal', () => {
    // Hidden, not removed: their sections are built and tested, but nothing real stands behind them
    // yet, so neither the tabs nor the sections are on the screen.
    expect(host.querySelector('app-welcome-create')).toBeNull();
    expect(host.querySelector('app-welcome-source-control')).toBeNull();
  });

  it('opensOnGetStarted', () => {
    expect(sectionTab('Get Started').getAttribute('aria-selected')).toBe('true');
    expect(shownSection()).toBe('app-welcome-get-started');
  });

  it('clickingATab_showsItsSection_andMarksItActive', async () => {
    sectionTab('Tools').click();
    await fixture.whenStable();

    expect(sectionTab('Tools').classList).toContain('welcome__tab--active');
    expect(sectionTab('Tools').getAttribute('aria-selected')).toBe('true');
    expect(sectionTab('Get Started').getAttribute('aria-selected')).toBe('false');
    expect(shownSection()).toBe('app-welcome-tools');
  });

  it('everyShownSectionStaysMounted_soItKeepsWhatTheUserWasDoing', async () => {
    sectionTab('Tools').click();
    await fixture.whenStable();

    expect(host.querySelectorAll('.welcome__panel > *')).toHaveLength(2);
    expect(shownSection()).toBe('app-welcome-tools');
  });

  it('arrowKeys_moveBetweenTabs_andWrap', async () => {
    sectionTab('Get Started').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    await fixture.whenStable();
    expect(shownSection()).toBe('app-welcome-tools');

    sectionTab('Tools').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    await fixture.whenStable();
    expect(shownSection()).toBe('app-welcome-get-started');

    sectionTab('Get Started').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    await fixture.whenStable();
    expect(shownSection()).toBe('app-welcome-tools');
  });

  it('onlyTheActiveTab_isInTheTabOrder', () => {
    expect(
      sectionTabs().map((tab: HTMLButtonElement): string | null => tab.getAttribute('tabindex')),
    ).toEqual(['0', '-1']);
  });

  it('aToolCard_opensItsTab_andStepsAside', async () => {
    sectionTab('Tools').click();
    await fixture.whenStable();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.welcome__tool'))
      .find((card: HTMLButtonElement): boolean => card.textContent?.includes('Settings') ?? false)
      ?.click();
    await fixture.whenStable();

    expect(tabs.tabs().some((tab): boolean => tab.type === 'settings')).toBe(true);
    expect(windows.openWindows).toBe(0);
  });

  it('aGetStartedAction_opensItsTab', async () => {
    Array.from(host.querySelectorAll<HTMLButtonElement>('.welcome__action'))
      .find((action: HTMLButtonElement): boolean => action.textContent?.trim() === 'New Terminal')
      ?.click();
    await fixture.whenStable();

    expect(tabs.tabs().some((tab): boolean => tab.type === 'terminal')).toBe(true);
  });

  it('coldStart_whenNoTabs_isVisible_withNoGlow', () => {
    expect(windows.openWindows).toBe(1);
    // Blue is an interaction colour now, not a background: the window carries no glow.
    expect(host.querySelector('.welcome__glow')).toBeNull();
  });

  it('withTabs_whenModalClosed_isNotVisible', async () => {
    tabs.open('terminal');
    await fixture.whenStable();

    expect(windows.openWindows).toBe(0);
  });

  it('summonedAgain_opensOnGetStartedWhateverWasShownLast', async () => {
    sectionTab('Tools').click();
    tabs.open('terminal');
    await fixture.whenStable();
    expect(windows.openWindows).toBe(0);

    modal.open();
    await fixture.whenStable();
    host = windows.contentHost!;

    expect(sectionTab('Get Started').getAttribute('aria-selected')).toBe('true');
  });
});
