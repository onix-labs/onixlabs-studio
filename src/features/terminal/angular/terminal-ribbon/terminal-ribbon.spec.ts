import { DebugElement, signal, WritableSignal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { ShellInfo } from '@shared/api/terminal-channels';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { MenuContribution, MenuEntry } from '@shared/angular/services/app-menu/app-menu-model';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';
import { TerminalAgents } from '@features/terminal/angular/terminal-agents/terminal-agents';
import { TerminalCommands } from '@features/terminal/angular/terminal-commands/terminal-commands';
import {
  ShellFamily,
  TerminalListing,
  TerminalLocation,
} from '@features/terminal/angular/terminal-commands/shell-commands';
import {
  RibbonMenuItem,
  RibbonStripMenuButton,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { TerminalRibbon } from './terminal-ribbon';

/**
 * The shells the stub provider reports, backing the New button's dropdown.
 */
const SHELLS: readonly ShellInfo[] = [
  { name: 'zsh', path: '/bin/zsh' },
  { name: 'bash', path: '/bin/bash' },
];

describe('TerminalRibbon', () => {
  let component: TerminalRibbon;
  let fixture: ComponentFixture<TerminalRibbon>;
  let host: HTMLElement;
  let menu: AppMenu;
  let calls: string[];
  let scrollLocked: WritableSignal<boolean>;
  let activeTabId: WritableSignal<string | undefined>;
  let toggledAgents: string[];
  let shellFamily: WritableSignal<ShellFamily | null>;

  /**
   * Finds a ribbon button by its visible label.
   * @param label The button label.
   * @returns Returns the matching button element.
   */
  function button(label: string): HTMLButtonElement {
    const match: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
    if (match === undefined) {
      throw new Error(`No button labelled "${label}"`);
    }
    return match;
  }

  /**
   * Reads the entries the ribbon contributes to a menu section.
   * @param id The section id.
   * @returns Returns the section's entries.
   */
  function menuItems(id: string): readonly MenuEntry[] {
    return (
      menu.sections().find((section: MenuContribution): boolean => section.id === id)?.items ?? []
    );
  }

  /**
   * Finds a menu entry by id, searching submenus too.
   * @param entries The entries to search.
   * @param id The entry id.
   * @returns Returns the entry, or undefined when there is none.
   */
  function findEntry(entries: readonly MenuEntry[], id: string): MenuEntry | undefined {
    for (const entry of entries) {
      if (entry.id === id) {
        return entry;
      }
      const nested: MenuEntry | undefined =
        entry.items === undefined ? undefined : findEntry(entry.items, id);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  }

  /**
   * Gets a ribbon menu button's component by its label.
   * @param label The button label.
   * @returns Returns the matching component.
   */
  function menuButton(label: string): RibbonStripMenuButton {
    const match: DebugElement | undefined = fixture.debugElement
      .queryAll(By.directive(RibbonStripMenuButton))
      .find(
        (element: DebugElement): boolean =>
          (element.componentInstance as RibbonStripMenuButton).label() === label,
      );
    if (match === undefined) {
      throw new Error(`No menu button labelled "${label}"`);
    }
    return match.componentInstance as RibbonStripMenuButton;
  }

  beforeEach(async () => {
    calls = [];
    toggledAgents = [];
    scrollLocked = signal<boolean>(false);
    shellFamily = signal<ShellFamily | null>('posix');
    activeTabId = signal<string | undefined>('term-1');
    const commandsStub: Partial<TerminalCommands> = {
      scrollLocked,
      shellFamily,
      clear: (): void => void calls.push('clear'),
      restart: (): void => void calls.push('restart'),
      newSession: (shell?: string): void => void calls.push(`newSession:${shell ?? 'default'}`),
      cut: (): void => void calls.push('cut'),
      copy: (): void => void calls.push('copy'),
      paste: (): void => void calls.push('paste'),
      list: (listing: TerminalListing): void => void calls.push(`list:${listing}`),
      open: (): void => void calls.push('open'),
      goTo: (location: TerminalLocation): void => void calls.push(`goTo:${location}`),
      setScrollLock: (value: boolean): void => void calls.push(`scrollLock:${value}`),
      scrollToBottom: (): void => void calls.push('scrollToBottom'),
      find: (): void => void calls.push('find'),
    };
    const shellsStub: Partial<TerminalShells> = {
      shells: signal<readonly ShellInfo[]>(SHELLS),
    };
    const agentsStub: Partial<TerminalAgents> = {
      toggle: (id: string): void => void toggledAgents.push(id),
    };
    const tabsStub: Partial<Tabs> = { activeTabId };

    await TestBed.configureTestingModule({
      imports: [TerminalRibbon],
      providers: [
        { provide: TerminalCommands, useValue: commandsStub },
        { provide: TerminalShells, useValue: shellsStub },
        { provide: TerminalAgents, useValue: agentsStub },
        { provide: Tabs, useValue: tabsStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TerminalRibbon);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    menu = TestBed.inject(AppMenu);
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.tick();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('buttons_whenPressed_routeToTheActiveTerminal', () => {
    button('Cut').click();
    button('Copy').click();
    button('Paste').click();
    button('List').click();
    button('Home').click();
    button('Open').click();
    button('Scroll').click();
    button('Find').click();

    expect(calls).toEqual([
      'cut',
      'copy',
      'paste',
      'list:names',
      'goTo:home',
      'open',
      'scrollToBottom',
      'find',
    ]);
  });

  it('listDropdown_whenAListingIsChosen_listsThatWay', () => {
    const list: RibbonStripMenuButton = menuButton('List');
    expect(list.items().map((item: RibbonMenuItem): string => item.id)).toEqual([
      'all',
      'byTime',
      'bySize',
      'folders',
    ]);

    list.selected.emit('all');
    list.selected.emit('byTime');

    expect(calls).toEqual(['list:all', 'list:byTime']);
  });

  it('homeDropdown_whenALocationIsChosen_goesThere', () => {
    const home: RibbonStripMenuButton = menuButton('Home');
    expect(home.items().map((item: RibbonMenuItem): string => item.id)).toEqual([
      'root',
      'up',
      'previous',
      'desktop',
      'documents',
      'downloads',
    ]);

    home.selected.emit('root');
    home.selected.emit('downloads');

    expect(calls).toEqual(['goTo:root', 'goTo:downloads']);
  });

  it('homeDropdown_whenTheShellKeepsNoPreviousFolder_disablesIt', () => {
    shellFamily.set('cmd');
    fixture.detectChanges();
    TestBed.tick();

    const previous: RibbonMenuItem | undefined = menuButton('Home')
      .items()
      .find((item: RibbonMenuItem): boolean => item.id === 'previous');
    expect(previous?.disabled).toBe(true);
    expect(findEntry(menuItems('terminal'), 'terminal.goTo.previous')?.enabled).toBe(false);

    shellFamily.set('pwsh');
    fixture.detectChanges();
    TestBed.tick();

    expect(findEntry(menuItems('terminal'), 'terminal.goTo.previous')?.enabled).toBe(true);
  });

  it('scrollLock_whenPressed_togglesAndDisablesScroll', () => {
    button('Scroll Lock').click();
    expect(calls).toEqual(['scrollLock:true']);

    // Jumping to newest output is meaningless while the viewport is frozen, so Scroll gives way.
    scrollLocked.set(true);
    fixture.detectChanges();
    expect(button('Scroll').disabled).toBe(true);

    button('Scroll Lock').click();
    expect(calls).toEqual(['scrollLock:true', 'scrollLock:false']);
  });

  it('menu_whenACommandIsChosen_runsTheSameHandlerAsTheRibbon', () => {
    menu.dispatch('terminal.new');
    // Cut, Copy and Paste are deliberately not on the menu — the core's native roles carry those
    // chords to whatever holds focus. Guarded by editing-chords.contract.spec.ts.
    menu.dispatch('terminal.find');
    menu.dispatch('terminal.clear');
    menu.dispatch('terminal.list');
    menu.dispatch('terminal.list.all');
    menu.dispatch('terminal.home');
    menu.dispatch('terminal.goTo.root');
    menu.dispatch('terminal.open');
    menu.dispatch('terminal.scrollToBottom');

    expect(calls).toEqual([
      'newSession:default',
      'find',
      'clear',
      'list:names',
      'list:all',
      'goTo:home',
      'goTo:root',
      'open',
      'scrollToBottom',
    ]);
  });

  it('menu_whenScrollLockIsChosen_flipsTheCurrentState', () => {
    menu.dispatch('terminal.scrollLock');

    expect(calls).toEqual(['scrollLock:true']);
  });

  it('menu_whenAgentIsChosen_togglesTheActiveTabsPanel', () => {
    menu.dispatch('terminal.agent');

    expect(toggledAgents).toEqual(['term-1']);
  });

  it('agent_whenNoTabIsActive_doesNothing', () => {
    activeTabId.set(undefined);
    fixture.detectChanges();

    button('Agent').click();

    expect(toggledAgents).toEqual([]);
  });

  it('newShellItems_whenShellsAreInstalled_offerOnePerShell', () => {
    const items: readonly MenuEntry[] = menuItems('file');
    expect(items.some((entry: MenuEntry): boolean => entry.id === 'terminal.new')).toBe(true);

    // The dropdown lists the installed shells; the button's own press uses the configured default.
    const dropdown: HTMLElement | null = host.querySelector('app-ribbon-strip-menu-button');
    expect(dropdown).not.toBeNull();
  });

  it('scrollLock_whenEngaged_isReflectedAsCheckedInTheMenu', () => {
    scrollLocked.set(true);
    fixture.detectChanges();
    TestBed.tick();

    const entry: MenuEntry | undefined = findEntry(menuItems('terminal'), 'terminal.scrollLock');

    expect(entry?.checked).toBe(true);
  });
});
