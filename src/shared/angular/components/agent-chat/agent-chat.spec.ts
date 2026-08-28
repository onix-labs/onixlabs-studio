import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

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
import { Search } from '@shared/angular/services/search/search';
import { FakeIntersectionObserver } from '@shared/angular/testing/fake-intersection-observer';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { AgentChat } from './agent-chat';

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
  let tailRequest: WritableSignal<number>;
  // The chat decides for itself whether it is on screen by watching its own host element, which jsdom
  // cannot answer; this puts those observations under the test's control.
  let observers: FakeIntersectionObserver;

  beforeEach(async () => {
    localStorage.clear();
    observers = FakeIntersectionObserver.install();
    conversationDraft = signal<string>('');
    tailRequest = signal<number>(0);
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
      provider: signal<AiProviderId>('claude'),
      mode: signal<AgentMode>('agent'),
      effort: signal<AiEffort | null>(null),
      discoveredCommands,
      compact: (): void => void (compacted += 1),
      clear: (): void => void (clearedChats += 1),
      setMode: (value: AgentMode): void => void modeChanges.push(value),
      setEffort: (value: AiEffort | null): void => void effortChanges.push(value),
      attachContext: (ref: AgentContextRef): void => void attachedContext.push(ref),
      needsLogin: signal<boolean>(false),
      dismissLoginPrompt: (): void => undefined,
      onLoginSucceeded: (): void => undefined,
      promptLogin: (): void => undefined,
      logout: (): Promise<void> => Promise.resolve(),
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
      connection: (): undefined => undefined,
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
          useValue: {
            draft: conversationDraft,
            tailRequest: tailRequest.asReadonly(),
          } as unknown as AgentConversation,
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

  afterEach(() => {
    observers.uninstall();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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

  it('rows_whenNobodyHasReportedItOffScreen_rendersTheTranscript', () => {
    // The regression this guards: the gate used to be an input a host had to pass, and the hosts that
    // passed nothing — the docked agent panel among them — rendered an empty transcript while the same
    // conversation showed up fine in Mission Control. A chat that has been told nothing shows its
    // conversation. It is only ever an observation of its own host element that quietens it.
    items.set(userMessages(10));
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.agent__message--user').length).toBe(10);
  });

  it('rows_whenTheChatGoesOffScreen_rendersNothingAtAll', () => {
    // A hidden view costs what a shown one costs, and every open tab stays mounted — so an agent tab
    // behind Mission Control used to re-check every rendered row on every streamed token for nobody.
    // This is a performance guard: if the gate regresses, the rows come back and so does the lag.
    items.set(userMessages(200));
    fixture.detectChanges();
    observers.report(fixture.nativeElement as HTMLElement, false);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.agent__message--user').length).toBe(0);
    expect(host.querySelector('.agent__earlier')).toBeNull();
  });

  it('rows_whenTheChatComesBackOnScreen_rendersTheTranscriptBack', () => {
    items.set(userMessages(10));
    fixture.detectChanges();
    observers.report(fixture.nativeElement as HTMLElement, false);
    fixture.detectChanges();
    observers.report(fixture.nativeElement as HTMLElement, true);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.agent__message--user').length).toBe(10);
  });

  it('create_whenTheChatIsMounted_watchesItsOwnHostElement', () => {
    // The chat works its visibility out for itself: whatever surface shows it — the agent tab, the
    // docked panel, a Mission Control tile — the thing observed is its own host element, so no host
    // has to know or pass anything.
    expect(observers.observed()).toContain(fixture.nativeElement as HTMLElement);
  });

  it('destroy_whenTheChatIsTornDown_stopsWatching', () => {
    fixture.destroy();

    expect(observers.disconnected()).toBe(observers.count());
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

  it('backgroundedTool_rendersAsLive_withASpinningNode', () => {
    items.set([
      {
        id: 'item-1',
        kind: 'tool',
        text: '',
        toolId: 't1',
        toolName: 'Bash',
        toolDetail: 'sleep 45',
        toolState: 'backgrounded',
      },
    ]);
    fixture.detectChanges();

    // The card is still live: its result came back the instant it backgrounded, but the work carries
    // on until the task settles.
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.agent__spin').length).toBe(1);
    // ...and it says so in words. The spinning node alone is a 12px signal on a row whose label is
    // unchanged, which reads as "finished" at a glance.
    expect(host.textContent).toContain('In background…');
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

  /**
   * Gives the message list the layout jsdom does not have, so the pin's arithmetic can be asserted
   * rather than stubbed out. `scrollHeight` is fixed and `clientHeight` is zero, so a pin that reaches
   * the bottom leaves `scrollTop` at the full height.
   * @param height The list's scrollable height.
   * @returns Returns the scrolling message list.
   */
  function layOutMessages(height: number = 1000): HTMLElement {
    const list: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.agent__messages',
    )!;
    Object.defineProperty(list, 'scrollHeight', { value: height, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 0, configurable: true });
    list.scrollTop = 0;
    return list;
  }

  /**
   * Reports the tail marker as in or out of view, as the browser would once the list has been laid out.
   * @param reached Whether the list is showing its bottom.
   */
  function reportTail(reached: boolean): void {
    const marker: Element = (fixture.nativeElement as HTMLElement).querySelector('.agent__tail')!;
    observers.report(marker, reached);
    fixture.detectChanges();
  }

  it('follow_whenAPinLandsShortOfTheBottom_pinsAgainInsteadOfGivingUp', () => {
    // The bug this exists for: `scrollHeight` under-reports while rows below the fold stand at their
    // estimated height, so the pin lands short. Landing short must be a reason to try again, not a
    // reason to stop — the transcript used to read its own short landing as the reader walking away
    // and never followed its output again.
    items.set(userMessages(3));
    fixture.detectChanges();
    const list: HTMLElement = layOutMessages(1000);

    reportTail(false);

    expect(list.scrollTop).toBe(1000);
  });

  it('follow_whenTheReaderScrollsAway_stopsFollowing', () => {
    items.set(userMessages(3));
    fixture.detectChanges();
    const list: HTMLElement = layOutMessages(1000);
    reportTail(true);

    // A gesture is what tells the reader's scrolling apart from the transcript's own pinning.
    list.dispatchEvent(new Event('wheel'));
    reportTail(false);
    list.scrollTop = 0;

    items.set(userMessages(4));
    fixture.detectChanges();

    expect(list.scrollTop).toBe(0);
  });

  it('follow_whenTheReaderReturnsToTheTail_resumesFollowing', () => {
    items.set(userMessages(3));
    fixture.detectChanges();
    const list: HTMLElement = layOutMessages(1000);
    list.dispatchEvent(new Event('wheel'));
    reportTail(false);

    // Being at the bottom is the whole of what following asks for, however the reader got back there.
    reportTail(true);
    list.scrollTop = 0;
    items.set(userMessages(4));
    fixture.detectChanges();

    expect(list.scrollTop).toBe(1000);
  });

  it('follow_whenTheListSettlesWithoutAGesture_keepsFollowing', () => {
    // A row settling from its estimated height to its real one moves the list off the tail without the
    // reader touching anything. That must not be mistaken for them scrolling away.
    items.set(userMessages(3));
    fixture.detectChanges();
    const list: HTMLElement = layOutMessages(1000);
    reportTail(true);

    reportTail(false);
    list.scrollTop = 0;
    items.set(userMessages(4));
    fixture.detectChanges();

    expect(list.scrollTop).toBe(1000);
  });

  it('tailRequest_whileTheSurfaceIsOffScreen_isHonouredWhenItComesBack', () => {
    // Every surface showing the conversation answers the request, including ones that are off screen
    // with nothing rendered. Such a surface has no bottom to jump to, so it must leave the request for
    // when it has one rather than consuming it and scrolling nowhere.
    items.set(userMessages(3));
    fixture.detectChanges();
    const list: HTMLElement = layOutMessages(1000);
    observers.report(fixture.nativeElement as HTMLElement, false);
    fixture.detectChanges();

    tailRequest.set(1);
    TestBed.tick();
    fixture.detectChanges();

    observers.report(fixture.nativeElement as HTMLElement, true);
    fixture.detectChanges();

    expect(list.scrollTop).toBe(1000);
  });

  it('tailRequest_whenASurfaceAsksForTheTail_pinsThisTranscript', () => {
    let pins: number = 0;
    // The pin itself moves a scroller, which jsdom has no layout for; what this asserts is the bridge
    // from the conversation (which the ribbon and the tool strip drive) to this transcript.
    (component as unknown as { scrollToBottom: () => void }).scrollToBottom = (): void => {
      pins += 1;
    };

    tailRequest.set(1);
    TestBed.tick();
    expect(pins).toBe(1);

    tailRequest.set(2);
    TestBed.tick();
    // Asking twice scrolls twice: the request is an event, not a state.
    expect(pins).toBe(2);
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
});
