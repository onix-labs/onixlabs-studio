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
  let tailRequests: number;
  let running: WritableSignal<boolean>;
  let historyOpen: WritableSignal<boolean>;
  let hasMessages: WritableSignal<boolean>;
  let providers: WritableSignal<readonly AiProviderInfo[]>;
  let selectedProvider: WritableSignal<AiProviderId>;
  let selectedModel: WritableSignal<string>;
  let providerChoices: AiProviderId[];
  let modelChoices: string[];

  /**
   * Builds a provider descriptor offering the given models.
   * @param id The provider id, also used to derive its label.
   * @param modelIds The ids of the models it offers.
   * @returns Returns the descriptor.
   */
  function provider(id: string, modelIds: readonly string[]): AiProviderInfo {
    return {
      id,
      label: `${id} label`,
      available: true,
      detail: '',
      models: modelIds.map(
        (modelId: string): AiModelInfo => ({
          id: modelId,
          label: `${modelId} label`,
          contextWindow: 1_000,
        }),
      ),
      defaultModelId: modelIds[0] ?? '',
    };
  }

  /**
   * Finds the Engine field's underlying select.
   * @returns Returns the select element.
   */
  function engineField(): HTMLSelectElement {
    const match: HTMLSelectElement | null = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Provider and model"]',
    );
    if (match === null) {
      throw new Error('No Engine field');
    }
    return match;
  }

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
    tailRequests = 0;
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
      scrollToBottom: (): void => void (tailRequests += 1),
    };
    providerChoices = [];
    modelChoices = [];
    providers = signal<readonly AiProviderInfo[]>([]);
    selectedProvider = signal<AiProviderId>('claude');
    selectedModel = signal<string>('claude-opus-4-8');
    const agentStub: Partial<Agent> = {
      provider: selectedProvider,
      model: selectedModel,
      models: signal<readonly AiModelInfo[]>([]),
      supportsRemoteControl: signal<boolean>(false),
      remoteControl: signal<AiRemoteControlMode>('off'),
      remoteControlEnabled: signal<boolean>(false),
      setProvider: (id: AiProviderId): void => void providerChoices.push(id),
      setModel: (id: string): void => void modelChoices.push(id),
      setRemoteControlEnabled: (): void => undefined,
    };
    const engineStub: Partial<AgentEngine> = {
      providers,
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

  it('scrollToBottom_whenClicked_asksTheTranscriptForItsLatestMessage', () => {
    button('Scroll to bottom').click();

    expect(tailRequests).toBe(1);
  });

  it('engine_whenProvidersLoad_offersOneFieldGroupingModelsByProvider', () => {
    providers.set([provider('claude', ['opus', 'sonnet']), provider('openai', ['gpt'])]);
    fixture.detectChanges();

    // One merged field, not a Provider field and a Model field.
    expect(host.querySelectorAll('select').length).toBe(1);
    const groups: NodeListOf<HTMLOptGroupElement> = engineField().querySelectorAll('optgroup');
    expect(Array.from(groups, (group: HTMLOptGroupElement): string => group.label)).toEqual([
      'claude label',
      'openai label',
    ]);
    expect(
      Array.from(engineField().options, (option: HTMLOptionElement): string => option.value),
    ).toEqual(['claude::opus', 'claude::sonnet', 'openai::gpt']);
  });

  it('engine_whenSelectionIsSet_showsThatProviderAndModelPair', () => {
    providers.set([provider('claude', ['opus', 'sonnet']), provider('openai', ['gpt'])]);
    selectedProvider.set('openai');
    selectedModel.set('gpt');
    fixture.detectChanges();

    expect(engineField().value).toBe('openai::gpt');
  });

  it('engine_whenAModelOfAnotherProviderIsPicked_setsTheProviderThenTheModel', () => {
    providers.set([provider('claude', ['opus', 'sonnet']), provider('openai', ['gpt'])]);
    fixture.detectChanges();

    const select: HTMLSelectElement = engineField();
    select.value = 'openai::gpt';
    select.dispatchEvent(new Event('change'));

    // The provider must be applied first: setting it resets the model to that provider's default.
    expect(providerChoices).toEqual(['openai']);
    expect(modelChoices).toEqual(['gpt']);
  });

  it('engine_whenAModelOfTheCurrentProviderIsPicked_leavesTheProviderAlone', () => {
    providers.set([provider('claude', ['opus', 'sonnet'])]);
    fixture.detectChanges();

    const select: HTMLSelectElement = engineField();
    select.value = 'claude::sonnet';
    select.dispatchEvent(new Event('change'));

    expect(providerChoices).toEqual([]);
    expect(modelChoices).toEqual(['sonnet']);
  });

  it('engine_whenAProviderOffersNoModels_stillListsItWithAnUnselectableRow', () => {
    providers.set([provider('claude', ['opus']), provider('ollama-1', [])]);
    fixture.detectChanges();

    const groups: NodeListOf<HTMLOptGroupElement> = engineField().querySelectorAll('optgroup');
    expect(Array.from(groups, (group: HTMLOptGroupElement): string => group.label)).toEqual([
      'claude label',
      'ollama-1 label',
    ]);
    const placeholder: HTMLOptionElement = groups[1].querySelector('option')!;
    expect(placeholder.disabled).toBe(true);
    expect(placeholder.textContent?.trim()).toBe('No models available');
  });
});
