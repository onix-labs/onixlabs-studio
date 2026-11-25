import { Component, input, InputSignal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { By } from '@angular/platform-browser';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { TabDocks } from '@shared/angular/services/dock-layout/tab-docks';

import { TerminalView } from './terminal-view';

/**
 * Stands in for the agent's conversation, whose chat needs a runtime the test environment lacks.
 */
@Component({ selector: 'app-agent-conversation-panel', template: '' })
class StubConversationPanel {
  public readonly tabId: InputSignal<string | undefined> = input<string>();
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
  public readonly surface: InputSignal<string> = input<string>('editor');
}

/**
 * A view of the terminal, with what the tests reach into it for.
 */
interface Parts {
  readonly findText: WritableSignal<string>;
  showFind(): void;
}

describe('TerminalView', () => {
  let component: TerminalView;
  let fixture: ComponentFixture<TerminalView>;
  let element: HTMLElement;
  let dock: DockState;
  let reveal: DockReveal;

  /**
   * Settles the view.
   */
  async function settle(): Promise<void> {
    TestBed.tick();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Moves a panel to the left edge, as dragging it there does.
   * @param panelId The panel.
   */
  function moveToLeft(panelId: string): void {
    dock.removeFromLayout(panelId);
    dock.dockEdge(panelId, 'left');
  }

  /**
   * Reads the titles the dock's groups show.
   * @returns Returns the titles, in order.
   */
  function titles(): readonly string[] {
    return [...element.querySelectorAll('.dock-tab-group__title')].map((title: Element): string =>
      (title.textContent ?? '').trim(),
    );
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [TerminalView],
    })
      .overrideComponent(TerminalView, {
        remove: { imports: [AgentConversationPanel] },
        add: { imports: [StubConversationPanel] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TerminalView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    dock = fixture.debugElement.injector.get(DockState);
    reveal = fixture.debugElement.injector.get(DockReveal);
    await settle();
  });

  afterEach(() => localStorage.clear());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenOutsideElectron_showsTheUnavailableMessage', () => {
    expect(element.querySelector('.terminal')?.textContent).toContain('only available');
  });

  it('opens_withTheTerminalAndNothingElse', () => {
    expect(titles()).toEqual([]);
    expect(element.querySelectorAll('app-terminal')).toHaveLength(1);
  });

  it('theTerminal_isTheSameOne_howeverThePanelsAreArranged', async () => {
    const terminal: Terminal = fixture.debugElement.query(By.directive(Terminal))
      .componentInstance as Terminal;

    reveal.open('agent');
    await settle();
    reveal.open('find');
    await settle();
    moveToLeft('agent');
    await settle();
    await dock.requestClose('find');
    await settle();

    expect(fixture.debugElement.query(By.directive(Terminal)).componentInstance).toBe(terminal);
  });

  it('theAgent_isRegisteredAndKeepsItsConversation_whetherOrNotItsPanelIsOpen', async () => {
    const hosts: AgentHosts = TestBed.inject(AgentHosts);
    const host: AgentHost | undefined = hosts.hosts()[0];

    expect(host?.tabId).toBe('tab-1');
    expect(host?.surface).toBe('terminal');
    expect(element.querySelector('app-agent-conversation-panel')).toBeNull();

    reveal.open('agent');
    await settle();
    expect(element.querySelector('app-agent-conversation-panel')).not.toBeNull();
    reveal.open('find');
    await settle();

    expect(hosts.hosts()).toHaveLength(1);
    expect(hosts.hosts()[0]?.conversation).toBe(
      fixture.debugElement.injector.get(AgentConversation),
    );
  });

  it('agentAndFind_areTabbedTogether_andOnlyCloseIsOnTheirTitleBar', async () => {
    reveal.open('agent');
    reveal.open('find');
    await settle();

    expect(titles()).toHaveLength(1);
    expect(
      [...element.querySelectorAll('.dock-tab__label')].map((tab: Element): string =>
        (tab.textContent ?? '').trim(),
      ),
    ).toEqual(['Agent', 'Find']);
    expect(
      [...element.querySelectorAll('.dock-tab-group__title-buttons button')].map(
        (button: Element): string | null => button.getAttribute('aria-label'),
      ),
    ).toEqual(['Close']);
  });

  it('find_whenBehindTheAgent_keepsItsText', async () => {
    const parts: Parts = component as unknown as Parts;
    parts.showFind();
    await settle();
    parts.findText.set('needle');
    await settle();

    reveal.open('agent');
    await settle();
    expect(element.querySelector('app-find-panel')).toBeNull();
    parts.showFind();
    await settle();

    expect(
      element.querySelector<HTMLInputElement>('app-find-panel .find-panel__input input')?.value,
    ).toBe('needle');
  });

  it('find_whenMoved_keepsItsText', async () => {
    const parts: Parts = component as unknown as Parts;
    parts.showFind();
    await settle();
    parts.findText.set('needle');
    await settle();

    moveToLeft('find');
    await settle();

    expect(
      element.querySelector<HTMLInputElement>('app-find-panel .find-panel__input input')?.value,
    ).toBe('needle');
  });

  it('find_whenClosedFromItsTitleBar_forgetsItsText', async () => {
    const parts: Parts = component as unknown as Parts;
    parts.showFind();
    await settle();
    parts.findText.set('needle');
    await settle();

    await dock.requestClose('find');
    await settle();

    expect(parts.findText()).toBe('');
  });

  it('aNewTab_startsFromTheLastArrangement_withNothingOpen', async () => {
    reveal.open('agent');
    moveToLeft('agent');
    await settle();

    const another: ComponentFixture<TerminalView> = TestBed.createComponent(TerminalView);
    another.componentRef.setInput('tabId', 'tab-2');
    const itsDock: DockState = another.debugElement.injector.get(DockState);
    another.detectChanges();

    expect(itsDock.isOpen('agent')).toBe(false);
    expect(JSON.stringify(itsDock.layout())).toBe(
      localStorage.getItem('dock.layout.terminal') ?? '',
    );
  });

  it('theRibbon_opensAndClosesTheAgent_throughTheTabsDock', async () => {
    const docks: TabDocks = TestBed.inject(TabDocks);

    docks.toggle('tab-1', 'agent');
    await settle();
    expect(titles()).toEqual(['Agent']);
    expect(docks.isOpen('tab-1', 'agent')).toBe(true);

    docks.toggle('tab-1', 'agent');
    await settle();
    expect(titles()).toEqual([]);

    fixture.destroy();
    expect(docks.isOpen('tab-1', 'agent')).toBe(false);
  });
});
