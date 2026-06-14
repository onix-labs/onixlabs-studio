import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AiProviderId, AiProviderInfo } from '../../../../shared/ai-types';
import { Agent, AgentItem } from '../../../services/agent/agent';
import { AgentChat } from './agent-chat';

describe('AgentChat', () => {
  let component: AgentChat;
  let fixture: ComponentFixture<AgentChat>;
  let sent: string[];
  let stopped: number;

  beforeEach(async () => {
    sent = [];
    stopped = 0;
    const agentStub: Partial<Agent> = {
      items: signal<readonly AgentItem[]>([]),
      isRunning: signal<boolean>(false),
      providers: signal<readonly AiProviderInfo[]>([
        { id: 'claude', label: 'Claude (Agent SDK)', available: true, detail: 'ok' },
      ]),
      provider: signal<AiProviderId>('claude'),
      awaitingDecision: signal<boolean>(false),
      send: (text: string): void => void sent.push(text),
      stop: (): void => void (stopped += 1),
      clear: (): void => undefined,
      setProvider: (): void => undefined,
      respondPermission: (): void => undefined,
    };

    await TestBed.configureTestingModule({
      imports: [AgentChat],
      providers: [{ provide: Agent, useValue: agentStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentChat);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('send_whenDraftEntered_sendsToTheAgentAndClearsTheDraft', () => {
    component.onInput('what can you do?');
    component.send();

    expect(sent).toEqual(['what can you do?']);
    expect(component.draft()).toBe('');
  });

  it('send_whenDraftBlank_doesNothing', () => {
    component.onInput('   ');
    component.send();

    expect(sent).toHaveLength(0);
  });

  it('stop_whenCalled_stopsTheAgent', () => {
    component.stop();

    expect(stopped).toBe(1);
  });

  it('onKeydown_whenEnterWithoutShift_sends', () => {
    component.onInput('hi');
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(sent).toEqual(['hi']);
  });

  it('onKeydown_whenShiftEnter_doesNotSend', () => {
    component.onInput('hi');
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));

    expect(sent).toHaveLength(0);
  });
});
