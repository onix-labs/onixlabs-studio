import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { Icon } from '@shared/angular/icons/icon';

import { AgentPanel } from './agent-panel';

describe('AgentPanel', () => {
  let component: AgentPanel;
  let fixture: ComponentFixture<AgentPanel>;

  const panel: DockPanel = {
    id: 'agent',
    title: 'Agent',
    icon: Icon.AGENT,
    role: 'tool',
    component: AgentPanel,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentPanel],
      // In the application the hosting IDE view (workspace / source control) provides the pair, so
      // the conversation outlives the dock's destroy-on-switch of this panel; the test plays host.
      providers: [Agent, AgentConversation],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_embedsTheChatShell', () => {
    fixture.detectChanges();
    const composer: Element | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.agent__composer',
    );
    expect(composer).not.toBeNull();
  });

  it('render_whenShown_runsOnTheWorkspaceSurface', () => {
    // 🔑 #713. The panel used to pass no surface and so ran as `editor` with no owning tab — the model
    // was never told it stood in a workspace, and its edit tools acted on whatever happened to be
    // focused in the well. The surface is what the chat sends with every run.
    fixture.detectChanges();
    const chat: AgentChat = fixture.debugElement.query(By.directive(AgentChat))
      .componentInstance as AgentChat;

    expect(chat.surface()).toBe('workspace');
  });

  it('render_whenAMessageIsSent_showsItInTheTranscript', () => {
    // The regression this guards, in the shape it was reported: a message typed into the workspace's
    // docked agent panel appeared in Mission Control and nowhere else, because this panel passes no
    // inputs to the chat and the transcript was gated on one that defaulted to hidden. The chat works
    // its own visibility out now, so a panel that says nothing still shows the conversation.
    TestBed.inject(Agent).send('Hello');
    fixture.detectChanges();
    const message: Element | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.agent__message--user',
    );

    expect(message?.textContent).toContain('Hello');
  });

  /**
   * Reads the composer's prompt from the rendered panel.
   * @returns Returns the prompt text area, or null when it is not rendered.
   */
  function prompt(): HTMLTextAreaElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('textarea.agent__input');
  }

  it('promptFocus_whenItsGroupIsFocused_putsTheCaretInThePrompt', async () => {
    const stack: StackNode | null = findStackOfPanel(TestBed.inject(DockState).layout(), 'agent');
    expect(stack?.active).toBe('agent');

    TestBed.inject(DockFocus).focus(stack?.id ?? '');
    await fixture.whenStable();

    expect(document.activeElement).toBe(prompt());
  });

  it('promptFocus_whileAnotherGroupIsFocused_leavesFocusAlone', async () => {
    // The workspace opening with the panel docked must not pull focus out of the well.
    TestBed.inject(DockFocus).focus('some-other-stack');
    await fixture.whenStable();

    expect(prompt()).not.toBeNull();
    expect(document.activeElement).not.toBe(prompt());
  });
});
