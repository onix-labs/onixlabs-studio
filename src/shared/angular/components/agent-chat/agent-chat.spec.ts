import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import type {
  AgentContextRef,
  AgentSurface,
  AiEffort,
  AiImageRef,
  AiPermissionRemember,
  AiProviderId,
  AiProviderInfo,
  AiSlashCommand,
} from '@shared/api/ai-types';
import type { AgentMode } from '@shared/api/ai-types';
import { Agent, AgentItem, AgentQueuedMessage } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { AgentPrompts } from '@shared/angular/services/agent-prompts/agent-prompts';
import { Search } from '@shared/angular/services/search/search';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { AgentChat } from './agent-chat';

/**
 * Finds a composer button by its visible label. The composer's buttons are `app-button`s, which
 * carry their text in a label span rather than in a class of their own.
 * @param host The component's host element.
 * @param label The button's visible label.
 * @returns Returns the button, or null when it is not shown.
 */
function composerButton(host: HTMLElement, label: string): HTMLElement | null {
  const buttons: HTMLElement[] = [...host.querySelectorAll<HTMLElement>('.agent__composer button')];
  return (
    buttons.find((button: HTMLElement): boolean => button.textContent?.trim() === label) ?? null
  );
}

describe('AgentChat', () => {
  let component: AgentChat;
  let fixture: ComponentFixture<AgentChat>;
  let sent: string[];
  let stopped: number;
  let contextPaths: WritableSignal<readonly AgentContextRef[]>;
  let removed: string[];
  let pendingInput: WritableSignal<AgentItem | undefined>;
  let inputAnswers: { id: string; answer: string | null }[];
  let items: WritableSignal<readonly AgentItem[]>;
  let running: WritableSignal<boolean>;
  let awaiting: WritableSignal<boolean>;
  let retried: string[];
  let queued: WritableSignal<readonly AgentQueuedMessage[]>;
  let removedQueued: string[];
  let permissionResponses: { id: string; granted: boolean; remember?: AiPermissionRemember }[];

  let rewinds: { id: string; text: string }[];
  let sentImages: (readonly AiImageRef[])[];
  let providers: WritableSignal<readonly AiProviderInfo[]>;
  let discoveredCommands: WritableSignal<readonly AiSlashCommand[]>;
  let pendingContextTokens: WritableSignal<number>;
  let contextTokens: WritableSignal<number>;
  let contextWindow: WritableSignal<number>;
  let compacted: number;
  let clearedChats: number;
  let modeChanges: AgentMode[];
  let effortChanges: (AiEffort | null)[];
  let attachedContext: AgentContextRef[];
  let conversationDraft: WritableSignal<string>;

  beforeEach(async () => {
    localStorage.clear();
    conversationDraft = signal<string>('');
    compacted = 0;
    clearedChats = 0;
    modeChanges = [];
    effortChanges = [];
    attachedContext = [];
    retried = [];
    rewinds = [];
    sentImages = [];
    queued = signal<readonly AgentQueuedMessage[]>([]);
    removedQueued = [];
    providers = signal<readonly AiProviderInfo[]>([
      {
        id: 'claude',
        label: 'Claude (Agent SDK)',
        available: true,
        detail: 'ok',
        models: [],
        defaultModelId: 'claude-opus-4-8',
        supportsImages: true,
      },
    ]);
    discoveredCommands = signal<readonly AiSlashCommand[]>([]);
    permissionResponses = [];
    sent = [];
    stopped = 0;
    contextPaths = signal<readonly AgentContextRef[]>([]);
    removed = [];
    pendingInput = signal<AgentItem | undefined>(undefined);
    inputAnswers = [];
    items = signal<readonly AgentItem[]>([]);
    running = signal<boolean>(false);
    awaiting = signal<boolean>(false);
    pendingContextTokens = signal<number>(0);
    contextTokens = signal<number>(0);
    contextWindow = signal<number>(0);
    const agentStub: Partial<Agent> = {
      items,
      isRunning: running,
      awaitingDecision: awaiting,
      pendingInput,
      contextTokens,
      contextWindow,
      costUsd: signal<number>(0),
      pendingContextTokens,
      contextPaths,
      send: (
        text: string,
        _tab?: string,
        _surface?: AgentSurface,
        images: readonly AiImageRef[] = [],
      ): void => {
        sent.push(text);
        sentImages.push(images);
      },
      stop: (): void => void (stopped += 1),
      removeContext: (path: string): void => void removed.push(path),
      respondPermission: (
        item: AgentItem,
        granted: boolean,
        remember?: AiPermissionRemember,
      ): void =>
        void permissionResponses.push(
          remember === undefined ? { id: item.id, granted } : { id: item.id, granted, remember },
        ),
      respondInput: (item: AgentItem, answer: string | null): void =>
        void inputAnswers.push({ id: item.id, answer }),
      retry: (item: AgentItem): void => void retried.push(item.id),
      rewind: (item: AgentItem, text: string): void => void rewinds.push({ id: item.id, text }),
      mode: signal<AgentMode>('agent'),
      effort: signal<AiEffort | null>(null),
      discoveredCommands,
      compact: (): void => void (compacted += 1),
      clear: (): void => void (clearedChats += 1),
      setMode: (value: AgentMode): void => void modeChanges.push(value),
      setEffort: (value: AiEffort | null): void => void effortChanges.push(value),
      attachContext: (ref: AgentContextRef): void => void attachedContext.push(ref),
      queued,
      removeQueued: (id: string): void => void removedQueued.push(id),
      takeQueued: (id: string): string | null => {
        const entry: AgentQueuedMessage | undefined = queued().find(
          (candidate: AgentQueuedMessage): boolean => candidate.id === id,
        );
        if (entry === undefined) {
          return null;
        }
        queued.set(
          queued().filter((candidate: AgentQueuedMessage): boolean => candidate.id !== id),
        );
        return entry.text;
      },
    };

    const engineStub: Partial<AgentEngine> = {
      providers,
      provider: signal<AiProviderId>('claude'),
    };

    const workspaceStub: unknown = { root: signal<{ path: string } | null>({ path: '/repo' }) };
    const searchStub: Partial<Search> = {
      listFiles: (): Promise<readonly string[]> =>
        Promise.resolve(['src/main.ts', 'README.md', 'src/app/main-menu.ts']),
    };

    await TestBed.configureTestingModule({
      imports: [AgentChat],
      providers: [
        { provide: AgentEngine, useValue: engineStub },
        { provide: Workspace, useValue: workspaceStub },
        { provide: Search, useValue: searchStub },
        // A host conversation carrying the persistent composer draft, so the chat's draft is backed by
        // it exactly as it is in the app (the source of the survives-remount behaviour below).
        {
          provide: AgentConversation,
          useValue: { draft: conversationDraft } as unknown as AgentConversation,
        },
      ],
    })
      .overrideComponent(AgentChat, {
        set: { providers: [{ provide: Agent, useValue: agentStub }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AgentChat);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('discoveredCommands_offerAllButAppNativeAndInteractive', () => {
    discoveredCommands.set([
      { name: 'review', description: 'Review the diff', argumentHint: '' },
      { name: 'clear', description: 'app-native', argumentHint: '' },
      { name: 'login', description: 'interactive', argumentHint: '' },
    ]);
    const comp: { discoveredSuggestions(query: string): readonly { label: string }[] } =
      component as unknown as {
        discoveredSuggestions(query: string): readonly { label: string }[];
      };

    const labels: readonly string[] = comp
      .discoveredSuggestions('')
      .map((entry): string => entry.label);
    expect(labels).toEqual(['/review']);
  });

  it('effortCommand_isGatedByTheProvidersCapability_andDispatchesSetEffort', () => {
    const comp: {
      effortSuggestions(): readonly { label: string; value: string }[];
      runCommand(command: string): void;
    } = component as unknown as {
      effortSuggestions(): readonly { label: string; value: string }[];
      runCommand(command: string): void;
    };

    // A provider with no effort control offers no /effort entries.
    expect(comp.effortSuggestions()).toEqual([]);

    // A provider that declares effort levels offers one entry per level plus a default.
    providers.set([
      {
        id: 'claude',
        label: 'Claude (Agent SDK)',
        available: true,
        detail: 'ok',
        models: [],
        defaultModelId: 'claude-opus-4-8',
        supportsImages: true,
        supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
    ]);
    const labels: readonly string[] = comp.effortSuggestions().map((entry): string => entry.label);
    expect(labels).toContain('/effort high');
    expect(labels).toContain('/effort default');

    // Picking a level (and the default) dispatches to the agent.
    comp.runCommand('effort:high');
    comp.runCommand('effort:default');
    expect(effortChanges).toEqual(['high', null]);
  });

  it('send_whenDraftEntered_sendsToTheAgentAndClearsTheDraft', () => {
    component.onInput('what can you do?');
    component.send();

    expect(sent).toEqual(['what can you do?']);
    expect(component.draft()).toBe('');
  });

  it('draft_isBackedByTheHostConversation_soItSurvivesTheChatUnmountingAndRemounting', () => {
    // Typing writes through to the host conversation, which outlives the chat component.
    component.onInput('half-typed prompt');
    expect(conversationDraft()).toBe('half-typed prompt');

    // A Mission Control column unmounts its chat when its tab is left and mounts a fresh one on the
    // way back. A second chat over the same conversation reads the draft back rather than starting
    // empty — the bug this guards against was the draft living on the (destroyed) component.
    const remounted: AgentChat = TestBed.createComponent(AgentChat).componentInstance;
    expect(remounted.draft()).toBe('half-typed prompt');
  });

  it('send_whenDraftBlank_doesNothing', () => {
    component.onInput('   ');
    component.send();

    expect(sent).toHaveLength(0);
  });

  it('send_whenAQuestionIsPending_answersItInsteadOfSendingAMessage', () => {
    pendingInput.set({
      id: 'item-2',
      kind: 'input-request',
      text: '',
      inputId: 'q1',
      inputQuestion: 'Which approach?',
      inputChoices: [],
      inputState: 'pending',
    });

    component.onInput('the second one');
    component.send();

    expect(sent).toEqual([]);
    expect(inputAnswers).toEqual([{ id: 'item-2', answer: 'the second one' }]);
    expect(component.draft()).toBe('');
  });

  it('confirmChoice_whenAChoiceIsSelected_answersWithIt', () => {
    const item: AgentItem = {
      id: 'item-2',
      kind: 'input-request',
      text: '',
      inputId: 'q1',
      inputQuestion: 'Which approach?',
      inputChoices: [{ label: 'A' }, { label: 'B', description: 'the bold one' }],
      inputState: 'pending',
    };

    component.selectChoice('B');
    component.confirmChoice(item);

    expect(inputAnswers).toEqual([{ id: 'item-2', answer: 'B' }]);
  });

  it('confirmChoice_whenNothingIsSelected_isIgnored', () => {
    const item: AgentItem = {
      id: 'item-2',
      kind: 'input-request',
      text: '',
      inputId: 'q1',
      inputQuestion: 'Which approach?',
      inputChoices: [{ label: 'A' }, { label: 'B' }],
      inputState: 'pending',
    };

    component.confirmChoice(item);

    expect(inputAnswers).toEqual([]);
  });

  it('skipInput_whenCalled_declinesTheQuestion', () => {
    const item: AgentItem = {
      id: 'item-2',
      kind: 'input-request',
      text: '',
      inputId: 'q1',
      inputQuestion: 'Which approach?',
      inputChoices: [],
      inputState: 'pending',
    };

    component.skipInput(item);

    expect(inputAnswers).toEqual([{ id: 'item-2', answer: null }]);
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

  /**
   * Builds a transcript of the given number of user messages, numbered from one.
   * @param count How many messages to create.
   * @returns Returns the messages.
   */
  function userMessages(count: number): readonly AgentItem[] {
    return Array.from(
      { length: count },
      (_: unknown, index: number): AgentItem => ({
        id: `m-${index + 1}`,
        kind: 'user',
        text: `message ${index + 1}`,
      }),
    );
  }

  it('rows_whenTranscriptExceedsTheWindow_rendersOnlyTheMostRecentAndOffersTheRest', () => {
    items.set(userMessages(250));
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    // Only the most-recent 200 of 250 are in the DOM; the oldest 50 are offered by the affordance.
    expect(host.querySelectorAll('.agent__message--user').length).toBe(200);
    expect(host.querySelector('.agent__earlier')?.textContent).toContain('Show 50 earlier');
    // The window is anchored to the tail: the first rendered bubble is message 51, not message 1.
    const first: Element | null = host.querySelector('.agent__message--user .agent__bubble');
    expect(first?.innerHTML).toContain('message 51');
  });

  it('rows_whenTranscriptWithinTheWindow_rendersEveryRowWithNoAffordance', () => {
    items.set(userMessages(10));
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.agent__message--user').length).toBe(10);
    expect(host.querySelector('.agent__earlier')).toBeNull();
  });

  it('showEarlier_whenCalled_revealsTheNextBatchOfOlderRows', () => {
    items.set(userMessages(250));
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.agent__message--user').length).toBe(200);

    component.showEarlier();
    fixture.detectChanges();

    // One batch (200) more than the window covers all 250, so the affordance disappears.
    expect(host.querySelectorAll('.agent__message--user').length).toBe(250);
    expect(host.querySelector('.agent__earlier')).toBeNull();
  });

  it('historyKeys_whenArrowUpAndDown_walkSentPromptsAndRestoreTheDraft', () => {
    items.set([
      { id: 'item-1', kind: 'user', text: 'first prompt' },
      { id: 'item-2', kind: 'assistant', text: 'reply' },
      { id: 'item-3', kind: 'user', text: 'second prompt' },
    ]);
    const area: HTMLTextAreaElement = document.createElement('textarea');
    const key: (name: string) => KeyboardEvent = (name: string): KeyboardEvent => {
      const event: KeyboardEvent = new KeyboardEvent('keydown', { key: name });
      Object.defineProperty(event, 'target', { value: area });
      return event;
    };

    area.value = 'a draft';
    component.onInput('a draft');
    component.onKeydown(key('ArrowUp'));
    expect(component.draft()).toBe('second prompt');

    component.onKeydown(key('ArrowUp'));
    expect(component.draft()).toBe('first prompt');

    // Past the oldest prompt there is nothing further; the composer keeps the oldest.
    component.onKeydown(key('ArrowUp'));
    expect(component.draft()).toBe('first prompt');

    component.onKeydown(key('ArrowDown'));
    expect(component.draft()).toBe('second prompt');

    component.onKeydown(key('ArrowDown'));
    expect(component.draft()).toBe('a draft');
  });

  it('historyKeys_whenCaretIsInsideAMultiLineDraft_leaveTheCaretAlone', () => {
    items.set([{ id: 'item-1', kind: 'user', text: 'previous' }]);
    const area: HTMLTextAreaElement = document.createElement('textarea');
    area.value = 'line one\nline two';
    area.setSelectionRange(area.value.length, area.value.length);
    component.onInput(area.value);
    const event: KeyboardEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });
    Object.defineProperty(event, 'target', { value: area });

    component.onKeydown(event);

    // The caret sits on the second line, so ArrowUp is caret movement, not history recall.
    expect(component.draft()).toBe('line one\nline two');
  });

  it('copy_whenClicked_writesTheItemTextToTheClipboard', async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string): Promise<void> => {
          writes.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    component.copy({ id: 'item-1', kind: 'assistant', text: 'the answer' });
    await Promise.resolve();

    expect(writes).toEqual(['the answer']);
  });

  it('respond_whenARememberScopeIsPicked_carriesItOnAGrantOnly', () => {
    const item: AgentItem = {
      id: 'item-9',
      kind: 'permission',
      text: '',
      permissionId: 'p1',
      permissionName: 'Bash',
      permissionState: 'pending',
      permissionHasWorkspace: true,
    };

    component.setRemember('item-9', 'session');
    component.respond(item, true);
    component.respond(item, false);

    expect(permissionResponses).toEqual([
      { id: 'item-9', granted: true, remember: 'session' },
      { id: 'item-9', granted: false, remember: 'session' },
    ]);
  });

  it('rememberOptions_whenTheRunHasNoWorkspace_omitTheWorkspaceScope', () => {
    const values: (hasWorkspace: boolean) => string[] = (hasWorkspace: boolean): string[] =>
      component
        .rememberOptions({
          id: 'item-9',
          kind: 'permission',
          text: '',
          permissionHasWorkspace: hasWorkspace,
        })
        .map((option: { value: string }): string => option.value);

    expect(values(true)).toEqual(['once', 'session', 'workspace', 'always']);
    expect(values(false)).toEqual(['once', 'session', 'always']);
  });

  it('contextMeter_whenASelectionIsAttached_showsTheEstimate', () => {
    pendingContextTokens.set(500);
    contextPaths.set([{ path: 'main.ts — selection #1 (12 lines)', kind: 'selection' }]);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    // The meter appears on the estimate alone (no usage reported yet), marked approximate.
    expect(host.querySelector('.agent__context-label')?.textContent?.trim()).toBe('≈500');
    expect(host.querySelector('.agent__attachment-name')?.textContent?.trim()).toBe(
      'main.ts — selection #1 (12 lines)',
    );
  });

  it('contextMeter_whenTheWindowIsKnown_showsUsageWithPercent', () => {
    contextTokens.set(750_100);
    contextWindow.set(1_000_000);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.agent__context-label')?.textContent?.trim()).toBe('750.1k (75%)');
    expect(host.querySelector<HTMLElement>('.agent__meter-fill')?.getAttribute('style')).toContain(
      '75%',
    );
  });

  it('contextMeter_whenTheWindowIsUnknown_showsUsageWithoutPercent', () => {
    contextTokens.set(12_300);
    contextWindow.set(0);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.agent__context-label')?.textContent?.trim()).toBe('12.3k');
  });

  it('contextMeter_colourBands_followTheThirds', () => {
    contextWindow.set(1_000_000);
    const context: () => HTMLElement = (): HTMLElement =>
      (fixture.nativeElement as HTMLElement).querySelector('.agent__context')!;

    contextTokens.set(200_000); // 20% — plenty of headroom, success band.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--warn')).toBe(false);
    expect(context().classList.contains('agent__context--high')).toBe(false);

    contextTokens.set(500_000); // 50% — warning band.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--warn')).toBe(true);
    expect(context().classList.contains('agent__context--high')).toBe(false);

    contextTokens.set(800_000); // 80% — error band.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--high')).toBe(true);
  });

  it('contextMeter_colourBands_switchAtTheThirdsBoundaries', () => {
    contextWindow.set(100);
    const context: () => HTMLElement = (): HTMLElement =>
      (fixture.nativeElement as HTMLElement).querySelector('.agent__context')!;

    contextTokens.set(33); // still success at 33%.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--warn')).toBe(false);
    expect(context().classList.contains('agent__context--high')).toBe(false);

    contextTokens.set(34); // crosses into warning at 34%.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--warn')).toBe(true);

    contextTokens.set(66); // still warning at 66%.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--warn')).toBe(true);
    expect(context().classList.contains('agent__context--high')).toBe(false);

    contextTokens.set(67); // crosses into error at 67%.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--high')).toBe(true);
  });

  it('attachments_whenContextAttached_rendersAChipWithItsBasename', () => {
    contextPaths.set([{ path: '/repo/src/main.ts', kind: 'file' }]);
    fixture.detectChanges();

    const chip: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.agent__attachment-name',
    );
    expect(chip?.textContent?.trim()).toBe('main.ts');
  });

  it('removeContext_whenChipRemoveClicked_detachesThePath', () => {
    contextPaths.set([{ path: '/repo/src/main.ts', kind: 'file' }]);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button[aria-label="Remove main.ts"]')!
      .click();

    expect(removed).toEqual(['/repo/src/main.ts']);
  });

  it('thinking_whenSettled_rendersACollapsedDisclosureWithItsWordCount', () => {
    items.set([
      { id: 'item-1', kind: 'thinking', text: 'weighing the two options carefully' },
      { id: 'item-2', kind: 'assistant', text: 'Done.' },
    ]);
    fixture.detectChanges();

    const disclosure: HTMLDetailsElement | null = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLDetailsElement>('.agent__thinking');
    expect(disclosure).not.toBeNull();
    expect(disclosure!.open).toBe(false);
    expect(disclosure!.querySelector('.agent__action-label')?.textContent?.trim()).toBe(
      'Thought process',
    );
    expect(disclosure!.querySelector('.agent__lane-meta')?.textContent?.trim()).toBe('5 words');
    expect(disclosure!.querySelector('.agent__thinking-body')?.textContent).toContain(
      'weighing the two options',
    );
  });

  it('thinking_whileTheRunStreamsIt_readsAsLiveProgress', () => {
    items.set([
      { id: 'item-1', kind: 'user', text: 'go' },
      { id: 'item-2', kind: 'thinking', text: 'first pass' },
    ]);
    running.set(true);
    fixture.detectChanges();

    const label: Element | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.agent__thinking .agent__action-label',
    );
    expect(label?.textContent?.trim()).toBe('Thinking…');

    // A later item ends the stream: the disclosure settles even while the run continues.
    items.set([
      { id: 'item-1', kind: 'user', text: 'go' },
      { id: 'item-2', kind: 'thinking', text: 'first pass' },
      { id: 'item-3', kind: 'assistant', text: 'Now doing it.' },
    ]);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.agent__thinking .agent__action-label')
        ?.textContent?.trim(),
    ).toBe('Thought process');
  });

  it('toolDetail_whenExpanded_showsTheFullInputAndOutputSections', () => {
    items.set([
      {
        id: 'item-1',
        kind: 'tool',
        text: '',
        toolId: 't1',
        toolName: 'Bash',
        toolDetail: 'ls',
        toolState: 'error',
        toolInput: '{\n  "command": "ls"\n}',
        toolOutput: 'ls: no such directory',
      },
    ]);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const sections: string[] = Array.from(host.querySelectorAll('.agent__action-section')).map(
      (section: Element): string => section.textContent?.trim() ?? '',
    );
    expect(sections).toEqual(['Input', 'Error']);
    const payloads: NodeListOf<Element> = host.querySelectorAll('.agent__action-payload');
    expect(payloads[0].textContent).toContain('"command": "ls"');
    expect(payloads[1].textContent).toContain('no such directory');
  });

  it('subAgent_rendersItsActivityAsANestedTimeline_notAFlatList', () => {
    items.set([
      {
        id: 'task-1',
        kind: 'tool',
        text: '',
        toolId: 'task-1',
        toolName: 'Task',
        toolDetail: 'Explore the repo',
        toolState: 'ok',
        agentType: 'Explore',
      },
      { id: 'kid-1', kind: 'assistant', text: 'Looked around.', parentToolId: 'task-1' },
      {
        id: 'kid-2',
        kind: 'tool',
        text: '',
        toolId: 'k2',
        toolName: 'Grep',
        toolDetail: 'foo',
        toolState: 'ok',
        toolInput: '{ "pattern": "foo" }',
        parentToolId: 'task-1',
      },
    ]);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const lane: HTMLElement | null = host.querySelector('.agent__lane');
    expect(lane).not.toBeNull();
    expect(
      lane!.querySelector('.agent__lane-summary .agent__action-label')?.textContent?.trim(),
    ).toBe('Explore');

    // The sub-agent's activity renders through the SAME rail markup as the parent: proper timeline
    // rows, an assistant bubble, and an expandable tool action — not the old flat one-liners.
    const nestedRows: NodeListOf<Element> = lane!.querySelectorAll('.agent__lane-rail .agent__row');
    expect(nestedRows.length).toBe(2);
    expect(lane!.querySelector('.agent__lane-rail .agent__bubble')?.textContent).toContain(
      'Looked around.',
    );
    const nestedTool: HTMLElement | null = lane!.querySelector('.agent__lane-rail .agent__action');
    expect(nestedTool?.tagName.toLowerCase()).toBe('details');
    expect(nestedTool?.querySelector('.agent__action-payload')?.textContent).toContain('"pattern"');

    // The flattened lane styling is gone entirely.
    expect(host.querySelector('.agent__lane-tool')).toBeNull();
    expect(host.querySelector('.agent__lane-text')).toBeNull();
  });

  it('payloads_whenLong_clipBehindShowAllUntilRevealed', () => {
    const long: string = 'x'.repeat(2_000);
    items.set([
      {
        id: 'item-1',
        kind: 'tool',
        text: '',
        toolId: 't1',
        toolName: 'Read',
        toolState: 'ok',
        toolOutput: long,
      },
    ]);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.agent__action-payload')?.textContent?.length).toBe(1_500);
    const more: HTMLButtonElement | null =
      host.querySelector<HTMLButtonElement>('.agent__action-more');
    expect(more?.textContent).toContain('500 more characters');

    more!.click();
    fixture.detectChanges();

    expect(host.querySelector('.agent__action-payload')?.textContent?.length).toBe(2_000);
    expect(host.querySelector('.agent__action-more')).toBeNull();
  });

  it('errorItem_whenRendered_showsCauseProviderDiagnosticsAndRetry', () => {
    items.set([
      {
        id: 'item-1',
        kind: 'error',
        text: 'Request failed with status 529',
        errorProvider: 'Claude (Agent SDK) · claude-opus-4-8',
        errorDetail: 'Request failed with status 529\noverloaded',
        errorToolContext: 'Bash: command not found',
        errorPrompt: 'do the thing',
      },
    ]);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const card: HTMLElement | null = host.querySelector('.agent__error');
    expect(card).not.toBeNull();
    expect(card!.querySelector('.agent__error-text')?.textContent).toContain(
      'Request failed with status 529',
    );
    expect(card!.querySelector('.agent__error-provider')?.textContent?.trim()).toBe(
      'Claude (Agent SDK) · claude-opus-4-8',
    );
    const diagnostics: string = card!.querySelector('.agent__error-diagnostics')?.textContent ?? '';
    expect(diagnostics).toContain('overloaded');
    expect(diagnostics).toContain('Failed tool — Bash: command not found');

    card!.querySelector<HTMLButtonElement>('app-button button')!.click();
    expect(retried).toEqual(['item-1']);
  });

  it('errorItem_whenAlreadyRetried_showsTheSpentStateInsteadOfTheButton', () => {
    items.set([
      {
        id: 'item-1',
        kind: 'error',
        text: 'boom',
        errorPrompt: 'do the thing',
        errorRetried: true,
      },
    ]);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.agent__error app-button')).toBeNull();
    expect(host.querySelector('.agent__error .agent__ask-state')?.textContent?.trim()).toBe(
      'Retried',
    );
  });

  it('queue_whenMessagesWait_rendersRowsWithEditAndRemove', () => {
    queued.set([
      { id: 'q-1', text: 'first follow-up' },
      { id: 'q-2', text: 'second follow-up' },
    ]);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const rows: NodeListOf<Element> = host.querySelectorAll('.agent__queue-item');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.agent__queue-text')?.textContent?.trim()).toBe(
      'first follow-up',
    );

    rows[1].querySelector<HTMLButtonElement>('[aria-label="Remove queued message"]')!.click();
    expect(removedQueued).toEqual(['q-2']);

    rows[0].querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')!.click();
    expect(component.draft()).toBe('first follow-up');
    expect(queued()).toHaveLength(1);
  });

  it('composer_whileRunning_offersSendOnlyOnceADraftIsWritten', () => {
    running.set(true);
    fixture.detectChanges();

    // No draft: Stop stands alone.
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(composerButton(host, 'Send')).toBeNull();
    expect(composerButton(host, 'Stop')).not.toBeNull();

    // Typing reveals Send (for steering or queueing) beside Stop.
    component.onInput('a follow-up');
    fixture.detectChanges();
    expect(composerButton(host, 'Send')).not.toBeNull();
    expect(composerButton(host, 'Stop')).not.toBeNull();
  });

  it('editAndResend_whenSendingInEditMode_rewindsTheConversationWithTheNewText', () => {
    const userItem: AgentItem = { id: 'item-1', kind: 'user', text: 'original' };
    items.set([userItem, { id: 'item-2', kind: 'assistant', text: 'reply' }]);
    fixture.detectChanges();

    component.beginEdit(userItem);
    expect(component.draft()).toBe('original');

    component.onInput('improved');
    component.send();

    expect(rewinds).toEqual([{ id: 'item-1', text: 'improved' }]);
    expect(sent).toEqual([]);
    expect(component.draft()).toBe('');
  });

  it('editMode_whenCancelled_restoresTheStashedDraft', () => {
    const userItem: AgentItem = { id: 'item-1', kind: 'user', text: 'original' };
    items.set([userItem]);
    component.onInput('half-written draft');

    component.beginEdit(userItem);
    expect(component.draft()).toBe('original');

    component.cancelEdit();

    expect(component.draft()).toBe('half-written draft');

    component.send();
    expect(rewinds).toEqual([]);
    expect(sent).toEqual(['half-written draft']);
  });

  it('retryLast_whenTheLastTurnHasAReply_rewindsToItsUserMessageUnchanged', () => {
    items.set([
      { id: 'item-1', kind: 'user', text: 'question' },
      { id: 'item-2', kind: 'assistant', text: 'meh answer' },
    ]);
    fixture.detectChanges();

    const retryButton: HTMLButtonElement | null = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('[aria-label="Retry this turn"]');
    expect(retryButton).not.toBeNull();

    retryButton!.click();

    expect(rewinds).toEqual([{ id: 'item-1', text: 'question' }]);
  });

  it('retryLast_whileRunningOrWithoutAReply_offersNoRetry', () => {
    items.set([{ id: 'item-1', kind: 'user', text: 'question' }]);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[aria-label="Retry this turn"]')).toBeNull();

    items.set([
      { id: 'item-1', kind: 'user', text: 'question' },
      { id: 'item-2', kind: 'assistant', text: 'answer' },
    ]);
    running.set(true);
    fixture.detectChanges();
    expect(host.querySelector('[aria-label="Retry this turn"]')).toBeNull();
  });

  it('images_whenAnImageFileIsAttached_showsAChipAndSendsItWithTheMessage', async () => {
    const file: File = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', {
      type: 'image/png',
    });

    await component.addImageFiles([file]);
    fixture.detectChanges();

    const chip: HTMLImageElement | null = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLImageElement>('.agent__image-thumb');
    expect(chip).not.toBeNull();
    expect(chip!.src.startsWith('data:image/png;base64,')).toBe(true);

    component.onInput('what is this?');
    component.send();

    expect(sent).toEqual(['what is this?']);
    expect(sentImages[0]).toHaveLength(1);
    expect(sentImages[0][0].mediaType).toBe('image/png');
    expect(sentImages[0][0].name).toBe('shot.png');
    // The chips clear once sent.
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.agent__image-thumb')).toBeNull();
  });

  it('images_whenTheProviderDoesNotAcceptThem_rejectsAtComposeTimeWithAHint', async () => {
    providers.set([
      {
        id: 'ollama',
        label: 'Ollama',
        available: true,
        detail: 'ok',
        models: [],
        defaultModelId: 'qwen3:8b',
      },
    ]);
    const file: File = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' });

    await component.addImageFiles([file]);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.agent__image-thumb')).toBeNull();
    expect(host.querySelector('.agent__image-hint')?.textContent).toContain(
      'does not accept images',
    );
  });

  it('images_whenOversizeOrWrongType_rejectsWithAHint', async () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const oversize: File = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    });
    await component.addImageFiles([oversize]);
    fixture.detectChanges();
    expect(host.querySelector('.agent__image-thumb')).toBeNull();
    expect(host.querySelector('.agent__image-hint')?.textContent).toContain('4 MB');

    const wrongType: File = new File([new Uint8Array([1])], 'movie.mp4', { type: 'video/mp4' });
    await component.addImageFiles([wrongType]);
    fixture.detectChanges();
    expect(host.querySelector('.agent__image-thumb')).toBeNull();
    expect(host.querySelector('.agent__image-hint')?.textContent).toContain('PNG, JPEG');
  });

  /**
   * Types a value into the composer text area with the caret at its end, driving the input and
   * suggestion hooks like real typing.
   * @param value The draft to type.
   * @returns Returns the text area.
   */
  function type(value: string): HTMLTextAreaElement {
    const area: HTMLTextAreaElement = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLTextAreaElement>('.agent__input')!;
    area.value = value;
    area.setSelectionRange(value.length, value.length);
    component.onInput(value);
    component.updateSuggest(area);
    fixture.detectChanges();
    return area;
  }

  it('slashPopup_whenTypingSlash_offersBuiltinsAndEnterRunsThem', () => {
    type('/comp');

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const labels: string[] = Array.from(host.querySelectorAll('.agent__suggest-label')).map(
      (label: Element): string => label.textContent?.trim() ?? '',
    );
    expect(labels[0]).toBe('/compact');
    expect(labels).toContain('Manage prompts…');

    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(compacted).toBe(1);
    expect(component.draft()).toBe('');
    // Accepting closed the popup; Enter no longer sends.
    expect(sent).toEqual([]);
  });

  it('slashPopup_whenALibraryPromptMatches_insertsItsText', () => {
    TestBed.inject(AgentPrompts).save('review', 'Review this code carefully.');
    type('/rev');

    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(component.draft()).toBe('Review this code carefully.');
    expect(sent).toEqual([]);
  });

  it('mentionPopup_whenTypingAt_listsFilesAndAttachesTheChosenOne', async () => {
    type('@main');
    // The file list loads asynchronously on first open; re-anchor once it lands.
    await fixture.whenStable();
    const area: HTMLTextAreaElement = type('@main');

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const labels: string[] = Array.from(host.querySelectorAll('.agent__suggest-label')).map(
      (label: Element): string => label.textContent?.trim() ?? '',
    );
    expect(labels[0]).toBe('src/main.ts');

    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(attachedContext).toEqual([{ path: '/repo/src/main.ts', kind: 'file' }]);
    expect(component.draft()).toBe('@main.ts ');
    expect(area.value).toBe('@main.ts ');
  });

  it('suggestPopup_whenNavigatingWithArrows_movesTheHighlightAndEscapeCloses', () => {
    type('/');
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const activeLabel: () => string = (): string =>
      host
        .querySelector('.agent__suggest-item--active .agent__suggest-label')
        ?.textContent?.trim() ?? '';
    expect(activeLabel()).toBe('/compact');

    component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(activeLabel()).toBe('/clear');

    component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    fixture.detectChanges();
    expect(activeLabel()).toBe('/compact');

    component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(host.querySelector('.agent__suggest')).toBeNull();
  });

  it('elapsed_whileRunning_ticksAndPausesWhileAwaitingTheUser', () => {
    vi.useFakeTimers();
    try {
      const host: HTMLElement = fixture.nativeElement as HTMLElement;
      running.set(true);
      fixture.detectChanges();
      expect(host.querySelector('.agent__elapsed')?.textContent?.trim()).toBe('0:00');

      vi.advanceTimersByTime(3000);
      fixture.detectChanges();
      expect(host.querySelector('.agent__elapsed')?.textContent?.trim()).toBe('0:03');

      // Blocked on the user: the clock holds and the readout dims.
      awaiting.set(true);
      fixture.detectChanges();
      vi.advanceTimersByTime(5000);
      fixture.detectChanges();
      expect(host.querySelector('.agent__elapsed')?.textContent?.trim()).toContain('0:03');
      expect(host.querySelector('.agent__elapsed--paused')).not.toBeNull();

      // Answered: the clock resumes.
      awaiting.set(false);
      fixture.detectChanges();
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(host.querySelector('.agent__elapsed')?.textContent?.trim()).toBe('0:05');

      running.set(false);
      fixture.detectChanges();
      expect(host.querySelector('.agent__elapsed')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('composer_whenRendered_doesNotShowProviderOrModelDropdowns', () => {
    fixture.detectChanges();
    const dropdowns: NodeListOf<Element> = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.agent__composer app-dropdown',
    );

    expect(dropdowns.length).toBe(0);
  });

  it('markdownComposer_whenOpened_rendersItsEditorAndRetiresItOnCancel', () => {
    const comp: { openMarkdown(): void; cancelMarkdown(): void } = component;
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.agent__md-modal')).toBeNull();

    comp.openMarkdown();
    fixture.detectChanges();

    expect(host.querySelector('.agent__md-title')?.textContent).toContain('Markdown Prompt Editor');

    comp.cancelMarkdown();
    fixture.detectChanges();

    expect(host.querySelector('.agent__md-modal')).toBeNull();
  });
});
