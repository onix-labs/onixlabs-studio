import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';

import { MarkdownAgentPanel } from './markdown-agent-panel';

describe('MarkdownAgentPanel', () => {
  let component: MarkdownAgentPanel;
  let fixture: ComponentFixture<MarkdownAgentPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownAgentPanel],
      // The agent and conversation are provided by the owning MarkdownView in the app; the spec's
      // TestBed stands in for that injector.
      providers: [Agent, AgentConversation, { provide: AGENT_CONVERSATION_KIND, useValue: 'code' }],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownAgentPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('documentId', 'doc-1');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_isTitledAgent', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.tool-panel__title')?.textContent).toContain('Agent');
  });

  it('render_whenShown_hostsTheAgentChat', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-agent-chat')).not.toBeNull();
  });
});
