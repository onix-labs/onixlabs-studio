import { TestBed } from '@angular/core/testing';

import { AgentConversationPanel } from './agent-conversation-panel';

describe('AgentConversationPanel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentConversationPanel],
    }).compileComponents();
  });

  // Mounts with its own [Agent, AgentConversation] providers; the store bridge is absent in jsdom, so
  // history degrades to an empty list. This guards that a host need only drop the panel in.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ReturnType<typeof TestBed.createComponent<AgentConversationPanel>> =
      TestBed.createComponent(AgentConversationPanel);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
