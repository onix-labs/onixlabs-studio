import { TestBed } from '@angular/core/testing';

import { Agent, AgentMessage } from './agent';

describe('Agent', () => {
  let agent: Agent;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    agent = TestBed.inject(Agent);
  });

  it('messages_whenFresh_holdsTheWelcomeMessage', () => {
    expect(agent.messages()).toHaveLength(1);
    expect(agent.messages()[0].role).toBe('assistant');
  });

  it('send_whenGivenText_appendsTheUserMessageAndAStubReply', () => {
    agent.send('hello');
    const messages: readonly AgentMessage[] = agent.messages();
    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({ role: 'user', text: 'hello' });
    expect(messages[2].role).toBe('assistant');
  });

  it('send_whenBlank_isIgnored', () => {
    agent.send('   ');
    expect(agent.messages()).toHaveLength(1);
  });

  it('clear_whenCalled_resetsToTheWelcomeMessage', () => {
    agent.send('hello');
    agent.clear();
    expect(agent.messages()).toHaveLength(1);
    expect(agent.messages()[0].role).toBe('assistant');
  });
});
