import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
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

    const chat: AgentChat = fixture.debugElement
      .query((node): boolean => node.nativeElement === chatEl)
      .componentInstance as AgentChat;
    expect(chat.surface()).toBe('project');
  });
});
