import { TestBed } from '@angular/core/testing';

import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentConversationPanel } from './agent-conversation-panel';

describe('AgentConversationPanel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentConversationPanel],
      // The panel deliberately provides no conversation of its own (a dock stack destroys and
      // recreates it, and the conversation must survive that); the host supplies the pair, as here.
      providers: [Agent, AgentConversation],
    }).compileComponents();
  });

  // The store bridge is absent in jsdom, so history degrades to an empty list. This guards that a
  // host need only provide [Agent, AgentConversation] and drop the panel in.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ReturnType<typeof TestBed.createComponent<AgentConversationPanel>> =
      TestBed.createComponent(AgentConversationPanel);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
