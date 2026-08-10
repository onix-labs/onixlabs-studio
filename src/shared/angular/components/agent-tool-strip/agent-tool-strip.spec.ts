import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type {
  AiModelInfo,
  AiProviderId,
  AiProviderInfo,
  AiRemoteControlMode,
} from '@shared/api/ai-types';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { AgentToolStrip } from './agent-tool-strip';

describe('AgentToolStrip', () => {
  let fixture: ComponentFixture<AgentToolStrip>;
  let host: HTMLElement;
  let newChats: number;
  let historyToggles: number;
  let running: WritableSignal<boolean>;
  let historyOpen: WritableSignal<boolean>;
  let hasMessages: WritableSignal<boolean>;

  /**
   * Finds a strip button by its accessible label.
   * @param label The button aria-label.
   * @returns Returns the matching button element.
   */
  function button(label: string): HTMLButtonElement {
    const match: HTMLButtonElement | null = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (match === null) {
      throw new Error(`No button labelled "${label}"`);
    }
    return match;
  }

  beforeEach(async () => {
    newChats = 0;
    historyToggles = 0;
    running = signal<boolean>(false);
    historyOpen = signal<boolean>(false);
    hasMessages = signal<boolean>(true);
    const conversationStub: Partial<AgentConversation> = {
      isRunning: running,
      historyOpen,
      hasMessages,
      newChat: (): void => void (newChats += 1),
      stop: (): void => undefined,
      compact: (): void => undefined,
      toggleHistory: (): void => void (historyToggles += 1),
    };
    const agentStub: Partial<Agent> = {
      provider: signal<AiProviderId>('claude'),
      model: signal<string>('claude-opus-4-8'),
      models: signal<readonly AiModelInfo[]>([]),
      supportsRemoteControl: signal<boolean>(false),
      remoteControl: signal<AiRemoteControlMode>('off'),
      setProvider: (): void => undefined,
      setModel: (): void => undefined,
      setRemoteControl: (): void => undefined,
    };
    const engineStub: Partial<AgentEngine> = {
      providers: signal<readonly AiProviderInfo[]>([]),
    };

    await TestBed.configureTestingModule({
      imports: [AgentToolStrip],
      providers: [
        { provide: AgentConversation, useValue: conversationStub },
        { provide: Agent, useValue: agentStub },
        { provide: AgentEngine, useValue: engineStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentToolStrip);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('newChat_whenClicked_startsAFreshConversation', () => {
    button('New chat').click();

    expect(newChats).toBe(1);
  });

  it('newChat_whenConversationIsAlreadyEmpty_isDisabled', () => {
    hasMessages.set(false);
    fixture.detectChanges();

    expect(button('New chat').disabled).toBe(true);
  });

  it('stop_whenNotRunning_isDisabled', () => {
    expect(button('Stop').disabled).toBe(true);
  });

  it('history_whenClicked_togglesTheHistoryList', () => {
    button('Conversation history').click();

    expect(historyToggles).toBe(1);
  });
});
