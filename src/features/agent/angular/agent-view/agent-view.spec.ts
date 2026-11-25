import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { AgentView } from './agent-view';

describe('AgentView', () => {
  let component: AgentView;
  let fixture: ComponentFixture<AgentView>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AgentView],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('chat_runsOnTheProjectSurface', () => {
    // The standalone agent has no owning document; its runs must carry the project surface so the
    // providers register no in-app editor tools (the built-in tools are this surface's capability set).
    const chatEl: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      'app-agent-chat',
    );
    expect(chatEl).not.toBeNull();

    const chat: AgentChat = fixture.debugElement.query(
      (node): boolean => node.nativeElement === chatEl,
    ).componentInstance as AgentChat;
    expect(chat.surface()).toBe('project');
  });

  it('aNewProjectsStart_sendsTheUsersFirstMessage_atOnce', async () => {
    // #806. The welcome screen opens this tab for a project that has no folder yet.
    TestBed.inject(Workspaces).setAgentStart('agent-1', {
      prompt: 'I want to build a game. Help me plan it.',
      brief: 'A new project.',
    });
    const started: ComponentFixture<AgentView> = TestBed.createComponent(AgentView);
    started.componentRef.setInput('tabId', 'agent-1');
    await started.whenStable();

    const agent: Agent = started.debugElement.injector.get(Agent);
    expect(agent.items()[0]).toMatchObject({
      kind: 'user',
      text: 'I want to build a game. Help me plan it.',
    });
    expect(TestBed.inject(Workspaces).takeAgentStart('agent-1')).toBeUndefined();
  });

  it('anOrdinaryTab_startsEmpty', () => {
    expect(fixture.debugElement.injector.get(Agent).items()).toEqual([]);
  });

  describe('its conversation history', () => {
    let conversation: AgentConversation;
    let reveal: DockReveal;

    beforeEach(() => {
      conversation = fixture.debugElement.injector.get(AgentConversation);
      reveal = fixture.debugElement.injector.get(DockReveal);
    });

    it('opensAndClosesInTheDock_asTheRibbonTogglesIt', async () => {
      conversation.toggleHistory();
      await fixture.whenStable();
      expect(reveal.isOpen('history')).toBe(true);

      conversation.toggleHistory();
      await fixture.whenStable();
      expect(reveal.isOpen('history')).toBe(false);
    });

    it('isClosedForTheRibbonToo_whenClosedFromItsTitleBar', async () => {
      conversation.toggleHistory();
      await fixture.whenStable();

      reveal.close('history');
      await fixture.whenStable();

      expect(conversation.historyOpen()).toBe(false);
    });
  });
});
