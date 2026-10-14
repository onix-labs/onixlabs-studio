import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type {
  AiModelInfo,
  AiProviderId,
  AiProviderInfo,
  AiRemoteControlMode,
} from '@shared/api/ai-types';
import { Agent } from '@shared/angular/services/agent/agent';
import {
  AgentControls,
  agentControls,
  agentPhase,
} from '@shared/angular/services/agent/agent-controls';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import type { MenuItem } from '@shared/angular/components/menu/menu';
import { AgentToolStrip } from './agent-tool-strip';

/**
 * The strip's protected menu members, reached through a cast so the menus can be driven without
 * opening their overlays.
 */
interface StripMenus {
  /**
   * Gets the Attach menu's items.
   */
  attachItems(): readonly MenuItem[];

  /**
   * Gets the "…" menu's items.
   */
  moreItems(): readonly MenuItem[];

  /**
   * Runs a command chosen from the Attach menu.
   */
  onAttachMenu(id: string): void;

  /**
   * Runs a command chosen from the "…" menu.
   */
  onMoreMenu(id: string): void;
}

describe('AgentToolStrip', () => {
  let fixture: ComponentFixture<AgentToolStrip>;
  let host: HTMLElement;
  let newChats: number;
  let historyToggles: number;
  let tailRequests: number;
  let topRequests: number;
  let promptRequests: number;
  let fileAttaches: number;
  let folderAttaches: number;
  let selectionAttaches: number;
  let hasSelection: WritableSignal<boolean>;
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
      models: modelIds.map((modelId: string): AiModelInfo => ({
        id: modelId,
        label: `${modelId} label`,
        contextWindow: 1_000,
      })),
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

  /**
   * Gets the strip's menu members.
   * @returns Returns the component, typed to its protected menu members.
   */
  function menus(): StripMenus {
    return fixture.componentInstance as unknown as StripMenus;
  }

  /**
   * Finds a menu item by its label.
   * @param items The menu's items.
   * @param label The item's label.
   * @returns Returns the matching item.
   */
  function item(items: readonly MenuItem[], label: string): MenuItem {
    const match: MenuItem | undefined = items.find(
      (candidate: MenuItem): boolean => candidate.label === label,
    );
    if (match === undefined) {
      throw new Error(`No menu item labelled "${label}"`);
    }
    return match;
  }

  /**
   * Chooses an item from the "…" menu by its label, as the menu's selected output would.
   * @param label The item's label.
   */
  function chooseMore(label: string): void {
    menus().onMoreMenu(item(menus().moreItems(), label).id);
  }

  /**
   * Chooses an item from the Attach menu by its label, as the menu's selected output would.
   * @param label The item's label.
   */
  function chooseAttach(label: string): void {
    menus().onAttachMenu(item(menus().attachItems(), label).id);
  }

  beforeEach(async () => {
    newChats = 0;
    fileAttaches = 0;
    folderAttaches = 0;
    selectionAttaches = 0;
    hasSelection = signal<boolean>(true);
    historyToggles = 0;
    tailRequests = 0;
    topRequests = 0;
    promptRequests = 0;
    running = signal<boolean>(false);
    historyOpen = signal<boolean>(false);
    hasMessages = signal<boolean>(true);
    const conversationStub: Partial<AgentConversation> = {
      isRunning: running,
      historyOpen,
      hasMessages,
      controls: computed((): AgentControls =>
        agentControls(agentPhase(hasMessages(), running(), false)),
      ),
      newChat: (): void => void (newChats += 1),
      stop: (): void => undefined,
      compact: (): void => undefined,
      toggleHistory: (): void => void (historyToggles += 1),
      attachFile: (): void => void (fileAttaches += 1),
      attachFolder: (): void => void (folderAttaches += 1),
      attachSelection: (): void => void (selectionAttaches += 1),
      scrollToTop: (): void => void (topRequests += 1),
      scrollToLastPrompt: (): void => void (promptRequests += 1),
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
        { provide: EditorCommands, useValue: { hasSelection } },
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

  it('engineAndAttachments_whileRunning_areDisabled_andStopIsTheOnlyActionLeft', () => {
    // The same table the ribbon reads: while a run is in flight only Stop (and Remote Control) act.
    running.set(true);
    fixture.detectChanges();

    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="Provider and model"]')?.disabled,
    ).toBe(true);
    expect(button('Attach').disabled).toBe(true);
    expect(
      menus()
        .attachItems()
        .every((entry: MenuItem): boolean => entry.disabled === true),
    ).toBe(true);
    expect(button('New chat').disabled).toBe(true);
    expect(button('Compact conversation').disabled).toBe(true);
    expect(button('Stop').disabled).toBe(false);
  });

  it('attach_isOneMenuButton_inPlaceOfTheThreeAttachButtons', () => {
    expect(button('Attach').disabled).toBe(false);
    expect(host.querySelector('button[aria-label="Attach file"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Add folder"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Attach selection"]')).toBeNull();
    expect(
      menus()
        .attachItems()
        .map((entry: MenuItem): string => entry.label),
    ).toEqual(['Attach File…', 'Attach Folder…', 'Attach Selection']);
  });

  it('attachMenu_eachItem_asksTheConversationToAttachThatKind', () => {
    chooseAttach('Attach File…');
    chooseAttach('Attach Folder…');
    chooseAttach('Attach Selection');

    expect(fileAttaches).toBe(1);
    expect(folderAttaches).toBe(1);
    expect(selectionAttaches).toBe(1);
  });

  it('attachSelection_whenThereIsNoSelection_isDisabled_andTheOthersAreNot', () => {
    hasSelection.set(false);

    expect(item(menus().attachItems(), 'Attach Selection').disabled).toBe(true);
    expect(item(menus().attachItems(), 'Attach File…').disabled).toBe(false);
    expect(item(menus().attachItems(), 'Attach Folder…').disabled).toBe(false);
  });

  it('moreActions_isOneMenuButton_holdingHistoryThenTheScrollJumps', () => {
    expect(button('More Actions')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Conversation history"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Scroll to top"]')).toBeNull();
    expect(
      menus()
        .moreItems()
        .map((entry: MenuItem): string => (entry.separator === true ? '---' : entry.label)),
    ).toEqual([
      'Conversation History',
      '---',
      'Scroll to Top',
      'Scroll to Bottom',
      'Scroll to Last Prompt',
    ]);
  });

  it('history_whenChosen_togglesTheHistoryList', () => {
    chooseMore('Conversation History');

    expect(historyToggles).toBe(1);
  });

  it('history_isACheckedItem_reflectingWhetherTheListIsOpen', () => {
    expect(item(menus().moreItems(), 'Conversation History').checked).toBe(false);

    historyOpen.set(true);

    expect(item(menus().moreItems(), 'Conversation History').checked).toBe(true);
  });

  it('history_whenAnExternalStateIsSupplied_emitsInsteadOfTogglingTheConversation', () => {
    // A Mission Control tile keeps its own history state, so the shared conversation is left alone.
    let emitted: number = 0;
    fixture.componentInstance.historyToggle.subscribe((): void => void (emitted += 1));
    fixture.componentRef.setInput('history', true);
    fixture.detectChanges();

    expect(item(menus().moreItems(), 'Conversation History').checked).toBe(true);

    chooseMore('Conversation History');

    expect(emitted).toBe(1);
    expect(historyToggles).toBe(0);
  });

  it('scrollToBottom_whenChosen_asksTheTranscriptForItsLatestMessage', () => {
    chooseMore('Scroll to Bottom');

    expect(tailRequests).toBe(1);
  });

  it('scrollToTop_whenChosen_asksTheTranscriptForItsFirstMessage', () => {
    chooseMore('Scroll to Top');

    expect(topRequests).toBe(1);
    // The three jumps are separate requests: asking for the top must not also ask for the tail.
    expect(tailRequests).toBe(0);
    expect(promptRequests).toBe(0);
  });

  it('scrollToLastPrompt_whenChosen_asksTheTranscriptForTheLastThingTheUserSent', () => {
    chooseMore('Scroll to Last Prompt');

    expect(promptRequests).toBe(1);
    expect(topRequests).toBe(0);
    expect(tailRequests).toBe(0);
  });

  it('scrollItems_askAgainOnEveryChoice', () => {
    // Each is an event rather than a state, so a second choice has to scroll a second time.
    chooseMore('Scroll to Top');
    chooseMore('Scroll to Top');

    expect(topRequests).toBe(2);
  });

  it('scrollItems_whenTheConversationIsEmpty_areDisabled_butHistoryIsNot', () => {
    hasMessages.set(false);

    const items: readonly MenuItem[] = menus().moreItems();
    expect(item(items, 'Scroll to Top').disabled).toBe(true);
    expect(item(items, 'Scroll to Bottom').disabled).toBe(true);
    expect(item(items, 'Scroll to Last Prompt').disabled).toBe(true);
    expect(item(items, 'Conversation History').disabled).toBeFalsy();
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
