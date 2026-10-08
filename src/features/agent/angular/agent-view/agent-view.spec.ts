import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import { Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { AgentView } from './agent-view';

describe('AgentView', () => {
  let component: AgentView;
  let fixture: ComponentFixture<AgentView>;

  beforeEach(async () => {
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

  it('aNewProjectsStart_opensTheConversation_onStudiosLine_withTheBrief', async () => {
    // #806. The welcome screen opens this tab for a project that has no folder yet.
    TestBed.inject(Workspaces).setAgentStart('agent-1', {
      opening: 'Tell the agent about your project.',
      brief: 'A new project.',
    });
    const started: ComponentFixture<AgentView> = TestBed.createComponent(AgentView);
    started.componentRef.setInput('tabId', 'agent-1');
    await started.whenStable();

    const agent: Agent = started.debugElement.injector.get(Agent);
    expect(agent.items().map((item: AgentItem): string => `${item.kind}:${item.text}`)).toEqual([
      'notice:Tell the agent about your project.',
    ]);
    expect(TestBed.inject(Workspaces).takeAgentStart('agent-1')).toBeUndefined();
  });

  it('anOrdinaryTab_startsEmpty', () => {
    expect(fixture.debugElement.injector.get(Agent).items()).toEqual([]);
  });
});
