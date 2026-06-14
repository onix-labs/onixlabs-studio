import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AiModelInfo, AiProviderId, AiProviderInfo } from '../../../../shared/ai-types';
import { Agent, AgentItem } from '../../../services/agent/agent';
import { AgentChat } from './agent-chat';

/**
 * The models the stub agent offers.
 */
const MODELS: readonly AiModelInfo[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

describe('AgentChat', () => {
  let component: AgentChat;
  let fixture: ComponentFixture<AgentChat>;
  let sent: string[];
  let stopped: number;
  let models: string[];

  beforeEach(async () => {
    sent = [];
    stopped = 0;
    models = [];
    const agentStub: Partial<Agent> = {
      items: signal<readonly AgentItem[]>([]),
      isRunning: signal<boolean>(false),
      providers: signal<readonly AiProviderInfo[]>([
        {
          id: 'claude',
          label: 'Claude (Agent SDK)',
          available: true,
          detail: 'ok',
          models: MODELS,
          defaultModelId: 'claude-opus-4-8',
        },
      ]),
      provider: signal<AiProviderId>('claude'),
      models: signal<readonly AiModelInfo[]>(MODELS),
      model: signal<string>('claude-opus-4-8'),
      awaitingDecision: signal<boolean>(false),
      send: (text: string): void => void sent.push(text),
      stop: (): void => void (stopped += 1),
      clear: (): void => undefined,
      setProvider: (): void => undefined,
      setModel: (id: string): void => void models.push(id),
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

  it('onModelChange_whenCalled_selectsTheModel', () => {
    component.onModelChange('claude-haiku-4-5');

    expect(models).toEqual(['claude-haiku-4-5']);
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
