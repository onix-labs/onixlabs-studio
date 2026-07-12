import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
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
});
