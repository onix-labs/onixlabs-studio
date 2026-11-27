import { ComponentFixture, TestBed } from '@angular/core/testing';

import { APPLICATION_KEYBINDINGS } from '@shared/angular/services/app-menu/core-keybindings';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Tab } from '@shared/angular/services/tabs/tab';
import { MAIN_WINDOW_ID, Tabs } from '@shared/angular/services/tabs/tabs';
import { TitleStripTabList } from './title-strip-tab-list';

describe('TitleStripTabList', () => {
  let component: TitleStripTabList;
  let fixture: ComponentFixture<TitleStripTabList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripTabList],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripTabList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenTabsOpen_rendersATabPerOpenTab', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    tabs.open('code');
    tabs.open('terminal');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('app-title-strip-tab').length).toBe(2);
  });

  it('render_showsOnlyItsOwnWindowsTabs (#1587)', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    tabs.open('code');
    tabs.open('terminal', undefined, { windowId: 'w2' });
    tabs.focusWindow(MAIN_WINDOW_ID);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const shown: string[] = [...element.querySelectorAll('[role="tab"]')].map(
      (tab: Element): string => tab.getAttribute('data-tab-type') ?? '',
    );
    expect(shown).toEqual(['code']);
  });

  it('onKeydown_whenArrowRightPressed_activatesTheNextTab', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    const first: Tab = tabs.open('code');
    const second: Tab = tabs.open('terminal');
    tabs.activate(first.id);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const tablist: HTMLElement | null = element.querySelector<HTMLElement>('[role="tablist"]');
    tablist?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(tabs.activeTabId()).toBe(second.id);
  });

  describe('a tab\u2019s context menu (#1592)', () => {
    let tabs: Tabs;

    beforeEach(() => {
      tabs = TestBed.inject(Tabs);
    });

    /**
     * Right-clicks a tab and reads its menu's rows.
     * @param tab The tab.
     * @returns Returns each row as its label, `(disabled)` after a disabled one, and its shortcut.
     */
    function openMenu(tab: Tab): string[] {
      fixture.detectChanges();
      const host: HTMLElement | undefined = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('app-title-strip-tab'),
      ).find((element: HTMLElement): boolean => element.textContent.includes(tab.title));
      host?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLButtonElement>('.app-menu-panel__item')).map(
        (row: HTMLButtonElement): string =>
          [
            row.querySelector('.app-menu-panel__item-label')?.textContent.trim(),
            row.disabled || row.getAttribute('aria-disabled') === 'true' ? '(disabled)' : '',
            row.querySelector('.app-menu-panel__item-shortcut')?.textContent.trim() ?? '',
          ]
            .filter((part: string | undefined): boolean => part !== undefined && part !== '')
            .join(' '),
      );
    }

    /**
     * Chooses a row of the open menu.
     * @param label The row's label.
     */
    function choose(label: string): void {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.app-menu-panel__item'))
        .find((row: HTMLButtonElement): boolean => row.textContent.includes(label))
        ?.click();
      fixture.detectChanges();
    }

    /**
     * Lists the open tabs' types, in strip order.
     * @returns Returns the types.
     */
    function order(): string[] {
      return tabs.tabs().map((tab: Tab): string => tab.type);
    }

    it('offersTheMoves_andClose_disablingAMoveThatWouldChangeNothing', () => {
      const code: Tab = tabs.open('code');
      tabs.open('terminal');
      tabs.open('markdown');

      expect(openMenu(code)).toEqual([
        'Move Tab to Beginning (disabled)',
        'Move Tab to End',
        'Close Tab',
      ]);
    });

    it('moveTabToEnd_andToBeginning_moveItThere', () => {
      const code: Tab = tabs.open('code');
      tabs.open('terminal');
      const markdown: Tab = tabs.open('markdown');

      openMenu(code);
      choose('Move Tab to End');
      expect(order()).toEqual(['terminal', 'markdown', 'code']);

      openMenu(markdown);
      choose('Move Tab to Beginning');
      expect(order()).toEqual(['markdown', 'terminal', 'code']);
    });

    it('moveTabToBeginning_stopsAfterTheFixedTabs', () => {
      tabs.open('settings');
      tabs.open('code');
      const terminal: Tab = tabs.open('terminal');

      openMenu(terminal);
      choose('Move Tab to Beginning');

      expect(order()).toEqual(['settings', 'terminal', 'code']);
    });

    it('aFixedTab_offersCloseAlone', () => {
      const settings: Tab = tabs.open('settings');
      tabs.open('code');

      expect(openMenu(settings)).toEqual(['Close Tab']);
    });

    it('closeTab_closesTheTabItWasOpenedOn', async () => {
      const code: Tab = tabs.open('code');
      const terminal: Tab = tabs.open('terminal');
      tabs.activate(terminal.id);

      openMenu(code);
      choose('Close Tab');
      await fixture.whenStable();

      expect(tabs.tabs().map((tab: Tab): string => tab.id)).toEqual([terminal.id]);
    });

    it('aRightClick_leavesTheShowingTabShowing', () => {
      const code: Tab = tabs.open('code');
      const terminal: Tab = tabs.open('terminal');
      tabs.activate(terminal.id);
      fixture.detectChanges();
      const tab: HTMLElement | undefined = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          'app-title-strip-tab > [role="tab"]',
        ),
      )[0];

      tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
      openMenu(code);

      expect(tabs.activeTabId()).toBe(terminal.id);
    });

    it('closeTab_namesTheCloseChord_onlyOnTheActiveTab_whichItCloses', () => {
      TestBed.inject(Keybindings).contribute(APPLICATION_KEYBINDINGS);
      const code: Tab = tabs.open('code');
      const terminal: Tab = tabs.open('terminal');
      tabs.activate(terminal.id);

      // Outside Electron the platform writes chords as Windows does.
      expect(openMenu(terminal).at(-1)).toBe('Close Tab Ctrl+W');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.click();
      fixture.detectChanges();
      expect(openMenu(code).at(-1)).toBe('Close Tab');
    });
  });
});
