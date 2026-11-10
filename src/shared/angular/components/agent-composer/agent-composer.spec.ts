import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';

import type {
  AgentContextRef,
  AgentSurface,
  AiEffort,
  AiImageRef,
  AiProviderId,
  AiProviderInfo,
  AiSlashCommand,
} from '@shared/api/ai-types';
import type { AgentMode } from '@shared/api/ai-types';
import {
  Agent,
  AgentItem,
  AgentQueuedMessage,
  AgentTask,
} from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { AgentPrompts } from '@shared/angular/services/agent-prompts/agent-prompts';
import { Search } from '@shared/angular/services/search/search';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { FakeIntersectionObserver } from '@shared/angular/testing/fake-intersection-observer';
import { Settings } from '@shared/angular/services/settings/settings';
import { AgentComposer } from './agent-composer';

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

describe('AgentComposer', () => {
  let component: AgentComposer;
  let fixture: ComponentFixture<AgentComposer>;
  let sent: string[];
  let stopped: number;
  let contextPaths: WritableSignal<readonly AgentContextRef[]>;
  let removed: string[];
  let pendingInput: WritableSignal<AgentItem | undefined>;
  let inputAnswers: { id: string; answer: string | null }[];
  let items: WritableSignal<readonly AgentItem[]>;
  let running: WritableSignal<boolean>;
  let awaiting: WritableSignal<boolean>;
  let lastActivity: number | null;
  let queued: WritableSignal<readonly AgentQueuedMessage[]>;
  let removedQueued: string[];
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
  let sentEvents: number;
  let windows: FakeModalWindows;
  let signInSupported: WritableSignal<boolean>;
  let loginPrompts: number;
  let logouts: number;
  let workspaceRoot: WritableSignal<{ path: string } | null>;

  beforeEach(async () => {
    localStorage.clear();
    windows = new FakeModalWindows();
    signInSupported = signal<boolean>(false);
    loginPrompts = 0;
    logouts = 0;
    workspaceRoot = signal<{ path: string } | null>({ path: '/repo' });
    conversationDraft = signal<string>('');
    compacted = 0;
    clearedChats = 0;
    modeChanges = [];
    effortChanges = [];
    attachedContext = [];
    rewinds = [];
    sentImages = [];
    sentEvents = 0;
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
    sent = [];
    stopped = 0;
    contextPaths = signal<readonly AgentContextRef[]>([]);
    removed = [];
    pendingInput = signal<AgentItem | undefined>(undefined);
    inputAnswers = [];
    items = signal<readonly AgentItem[]>([]);
    running = signal<boolean>(false);
    awaiting = signal<boolean>(false);
    lastActivity = null;
    pendingContextTokens = signal<number>(0);
    contextTokens = signal<number>(0);
    contextWindow = signal<number>(0);
    const agentStub: Partial<Agent> = {
      // The composer hosts the conversation-scoped tasks menu, which reads the live-task list.
      tasks: signal<readonly AgentTask[]>([]),
      items,
      lastActivityAt: (): number | null => lastActivity,
      isRunning: running,
      awaitingDecision: awaiting,
      pendingInput,
      contextTokens,
      contextWindow,
      costUsd: signal<number>(0),
      billedPerToken: signal<boolean>(true),
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
      respondInput: (item: AgentItem, answer: string | null): void =>
        void inputAnswers.push({ id: item.id, answer }),
      rewind: (item: AgentItem, text: string): void => void rewinds.push({ id: item.id, text }),
      provider: signal<AiProviderId>('claude'),
      mode: signal<AgentMode>('agent'),
      effort: signal<AiEffort | null>(null),
      effectiveEffort: signal<AiEffort | null>(null),
      compactOffered: signal<boolean>(false),
      dismissCompactOffer: (): void => undefined,
      discoveredCommands,
      compact: (): void => void (compacted += 1),
      clear: (): void => void (clearedChats += 1),
      setMode: (value: AgentMode): void => void modeChanges.push(value),
      setEffort: (value: AiEffort | null): void => void effortChanges.push(value),
      runWorkspaceRoot: (): string | null => null,
      attachContext: (ref: AgentContextRef): void => void attachedContext.push(ref),
      needsLogin: signal<boolean>(false),
      supportsSignIn: signInSupported,
      signInName: signal<string>('Claude'),
      signInRequest: (): null => null,
      dismissLoginPrompt: (): void => undefined,
      onLoginSucceeded: (): void => undefined,
      promptLogin: (): void => void (loginPrompts += 1),
      logout: (): Promise<void> => {
        logouts += 1;
        return Promise.resolve();
      },
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

    const workspaceStub: unknown = { root: workspaceRoot };
    const searchStub: Partial<Search> = {
      listFiles: (): Promise<readonly string[]> =>
        Promise.resolve(['src/main.ts', 'README.md', 'src/app/main-menu.ts']),
    };

    await TestBed.configureTestingModule({
      imports: [AgentComposer],
      providers: [
        { provide: AgentEngine, useValue: engineStub },
        { provide: Workspace, useValue: workspaceStub },
        { provide: Search, useValue: searchStub },
        // A host conversation carrying the persistent composer draft, so the composer's draft is backed
        // by it exactly as it is in the app (the source of the survives-remount behaviour below).
        {
          provide: AgentConversation,
          useValue: { draft: conversationDraft } as unknown as AgentConversation,
        },
        { provide: ModalWindows, useValue: windows },
      ],
    })
      .overrideComponent(AgentComposer, {
        set: { providers: [{ provide: Agent, useValue: agentStub }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AgentComposer);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tabId', undefined);
    fixture.componentRef.setInput('surface', 'editor');
    component.sent.subscribe((): void => void (sentEvents += 1));
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

  it('send_whenDraftEntered_sendsToTheAgentAndClearsTheDraftAndRepins', () => {
    component.onInput('what can you do?');
    component.send();

    expect(sent).toEqual(['what can you do?']);
    expect(component.draft()).toBe('');
    // The host is told to re-pin the transcript to the tail.
    expect(sentEvents).toBe(1);
  });

  it('draft_isBackedByTheHostConversation_soItSurvivesTheComposerUnmountingAndRemounting', () => {
    // Typing writes through to the host conversation, which outlives the composer component.
    component.onInput('half-typed prompt');
    expect(conversationDraft()).toBe('half-typed prompt');

    // A Mission Control column unmounts its composer when its tab is left and mounts a fresh one on the
    // way back. A second composer over the same conversation reads the draft back rather than starting
    // empty — the bug this guards against was the draft living on the (destroyed) component.
    const remounted: AgentComposer = TestBed.createComponent(AgentComposer).componentInstance;
    expect(remounted.draft()).toBe('half-typed prompt');
  });

  it('send_whenDraftBlank_doesNothing', () => {
    component.onInput('   ');
    component.send();

    expect(sent).toHaveLength(0);
    expect(sentEvents).toBe(0);
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

  it('stop_whenCalled_stopsTheAgent', () => {
    component.stop();

    expect(stopped).toBe(1);
  });

  it('onKeydown_whenEnterWithoutShift_sends', () => {
    component.onInput('hi');
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(sent).toEqual(['hi']);
  });

  it('onKeydown_whenSendMessageWithIsModEnter_sendsOnlyOnModEnter', () => {
    TestBed.inject(Settings).set('ai.sendMessageWith', 'mod-enter');
    component.onInput('hi');

    // Off macOS, where the tests run, the command modifier is Ctrl.
    const plain: KeyboardEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    component.onKeydown(plain);
    expect(sent).toHaveLength(0);
    expect(plain.defaultPrevented).toBe(false);

    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    expect(sent).toEqual(['hi']);
  });

  it('onKeydown_whenSendMessageWithIsShiftEnter_sendsOnShiftEnter', () => {
    TestBed.inject(Settings).set('ai.sendMessageWith', 'shift-enter');
    component.onInput('hi');

    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(sent).toHaveLength(0);

    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    expect(sent).toEqual(['hi']);
  });

  it('onKeydown_whenShiftEnter_doesNotSend', () => {
    component.onInput('hi');
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));

    expect(sent).toHaveLength(0);
  });

  it('onQuickResponse_whenTheComposerIsEmpty_sendsItAsItStands', () => {
    component.onQuickResponse('Looks good to me');

    expect(sent).toEqual(['Looks good to me']);
    expect(component.draft()).toBe('');
  });

  it('onQuickResponse_whenADraftIsBeingWritten_appendsInsteadOfSending', () => {
    component.onInput('Yes');

    component.onQuickResponse('and check the tests too');

    expect(sent).toEqual([]);
    expect(component.draft()).toBe('Yes and check the tests too');
  });

  it('historyKeys_whenAltArrowUpAndDown_walkSentPromptsAndRestoreTheDraft', () => {
    items.set([
      { id: 'item-1', kind: 'user', text: 'first prompt' },
      { id: 'item-2', kind: 'assistant', text: 'reply' },
      { id: 'item-3', kind: 'user', text: 'second prompt' },
    ]);
    const area: HTMLTextAreaElement = document.createElement('textarea');
    const key: (name: string) => KeyboardEvent = (name: string): KeyboardEvent => {
      const event: KeyboardEvent = new KeyboardEvent('keydown', { key: name, altKey: true });
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

  it('historyKeys_whenTheArrowIsPressedAlone_leaveTheDraftToTheCaret', () => {
    items.set([{ id: 'item-1', kind: 'user', text: 'previous' }]);
    const area: HTMLTextAreaElement = document.createElement('textarea');
    area.value = 'line one\nline two';
    area.setSelectionRange(area.value.length, area.value.length);
    component.onInput(area.value);
    const event: KeyboardEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });
    Object.defineProperty(event, 'target', { value: area });

    component.onKeydown(event);

    // Recall is a chord now, so a bare ArrowUp is caret movement wherever the caret sits.
    expect(component.draft()).toBe('line one\nline two');
  });

  it('historyKeys_whenShiftArrowUp_leaveTheDraftAlone_soSelectingUpwardsStillWorks', () => {
    // Shift+arrows extends a textarea selection line by line. Recall lived there once, and selecting
    // the paragraph above replaced the draft with the previous message instead.
    items.set([{ id: 'item-1', kind: 'user', text: 'first prompt' }]);
    component.onInput('a draft\nbeing selected');
    const area: HTMLTextAreaElement = document.createElement('textarea');
    const event: KeyboardEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      shiftKey: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: area });

    component.onKeydown(event);

    expect(component.draft()).toBe('a draft\nbeing selected');
    expect(event.defaultPrevented).toBe(false);
  });

  it('historyKeys_whenAltArrowUpFromTheEndOfAMultiLineDraft_stillRecalls', () => {
    items.set([{ id: 'item-1', kind: 'user', text: 'previous' }]);
    const area: HTMLTextAreaElement = document.createElement('textarea');
    area.value = 'line one\nline two';
    area.setSelectionRange(area.value.length, area.value.length);
    component.onInput(area.value);
    const event: KeyboardEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true });
    Object.defineProperty(event, 'target', { value: area });

    component.onKeydown(event);

    expect(component.draft()).toBe('previous');
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

  it('contextMeter_colourBands_switchAtHalfAndThreeQuarters', () => {
    contextWindow.set(100);
    const context: () => HTMLElement = (): HTMLElement =>
      (fixture.nativeElement as HTMLElement).querySelector('.agent__context')!;

    contextTokens.set(49); // still success at 49%.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--warn')).toBe(false);
    expect(context().classList.contains('agent__context--high')).toBe(false);

    contextTokens.set(50); // crosses into warning at 50%.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--warn')).toBe(true);

    contextTokens.set(74); // still warning at 74%.
    fixture.detectChanges();
    expect(context().classList.contains('agent__context--warn')).toBe(true);
    expect(context().classList.contains('agent__context--high')).toBe(false);

    contextTokens.set(75); // crosses into error at 75%.
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

  it('images_followTheImageSizeSetting', async () => {
    TestBed.inject(Settings).set('ai.maxImageSizeMb', 8);
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const big: File = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    });

    await component.addImageFiles([big]);
    fixture.detectChanges();

    expect(host.querySelector('.agent__image-hint')?.textContent).toContain('8 MB');
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
    expect(labels).toContain('Manage prompts');

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

  it('quiet_afterThirtySecondsUnheard_saysHowLong_andClearsWhenTheAgentSpeaks', () => {
    // #1419: a stall shows on the run clock without reading timestamps.
    vi.useFakeTimers();
    try {
      const host: HTMLElement = fixture.nativeElement as HTMLElement;
      const readout: () => string = (): string =>
        host.querySelector('.agent__elapsed')?.textContent?.trim() ?? '';
      running.set(true);
      fixture.detectChanges();
      lastActivity = Date.now();

      vi.advanceTimersByTime(29_000);
      fixture.detectChanges();
      expect(readout()).not.toContain('quiet');

      vi.advanceTimersByTime(71_000);
      fixture.detectChanges();
      expect(readout()).toBe('1:40 · quiet for 1m 40s');

      lastActivity = Date.now();
      vi.advanceTimersByTime(1000);
      fixture.detectChanges();
      expect(readout()).toBe('1:41');
    } finally {
      vi.useRealTimers();
    }
  });

  it('quiet_whileWaitingOnTheUser_isNotAStall', () => {
    vi.useFakeTimers();
    try {
      const host: HTMLElement = fixture.nativeElement as HTMLElement;
      running.set(true);
      fixture.detectChanges();
      lastActivity = Date.now();
      awaiting.set(true);
      fixture.detectChanges();
      vi.advanceTimersByTime(120_000);

      // Answered: the wait counts as activity, so the clock does not report two minutes of quiet.
      awaiting.set(false);
      fixture.detectChanges();
      vi.advanceTimersByTime(1000);
      fixture.detectChanges();

      expect(host.querySelector('.agent__elapsed')?.textContent).not.toContain('quiet');
    } finally {
      vi.useRealTimers();
    }
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

  it('elapsed_watchesTheFormNotTheBoxlessHost_soTheClockShowsOnScreen', () => {
    const observers: FakeIntersectionObserver = FakeIntersectionObserver.install();
    vi.useFakeTimers();
    try {
      const watched: ComponentFixture<AgentComposer> = TestBed.createComponent(AgentComposer);
      watched.componentRef.setInput('tabId', undefined);
      watched.componentRef.setInput('surface', 'editor');
      watched.detectChanges();
      const host: HTMLElement = watched.nativeElement as HTMLElement;
      const form: HTMLElement = host.querySelector<HTMLElement>('.agent__composer')!;

      // The host is display: contents and has no box, so it would never intersect.
      expect(observers.observed()).toEqual([form]);

      observers.report(form, true);
      running.set(true);
      watched.detectChanges();
      vi.advanceTimersByTime(2000);
      watched.detectChanges();
      expect(host.querySelector('.agent__elapsed')?.textContent?.trim()).toBe('0:02');
    } finally {
      vi.useRealTimers();
      observers.uninstall();
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
    expect(windows.openWindows).toBe(0);

    comp.openMarkdown();
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();

    expect(windows.openWindows).toBe(1);
    expect(windows.contentHost?.querySelector('.agent__md-title')?.textContent).toContain(
      'Markdown Prompt Editor',
    );

    comp.cancelMarkdown();
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();

    expect(windows.openWindows).toBe(0);
  });

  /**
   * Gets the composer's own element.
   * @returns Returns the host.
   */
  function hostElement(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Makes a small image file.
   * @param name The file's name.
   * @returns Returns the file.
   */
  function png(name: string): File {
    return new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
  }

  /**
   * Reads the names of the attached images.
   * @returns Returns the names, in order.
   */
  function attachedImages(): (string | null)[] {
    fixture.detectChanges();
    return Array.from(hostElement().querySelectorAll('.agent__image-thumb')).map(
      (image: Element): string | null => image.getAttribute('alt'),
    );
  }

  /**
   * Raises an event carrying a payload the browser would have attached to it.
   * @param target The element it lands on.
   * @param type The event type.
   * @param property The payload's property.
   * @param value The payload.
   * @returns Returns the raised event.
   */
  function raise(target: Element, type: string, property: string, value: unknown): Event {
    const event: Event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, property, { value });
    target.dispatchEvent(event);
    return event;
  }

  describe('markdown editor', () => {
    it('open_cutsTheDraftIntoTheEditor_andCancelHandsItBack', () => {
      component.onInput('half a thought');

      component.openMarkdown();
      expect(component.draft()).toBe('');

      component.cancelMarkdown();
      expect(component.draft()).toBe('half a thought');
    });

    it('cancel_keepsWhatWasWrittenInTheEditor', () => {
      component.openMarkdown();
      component.onMarkdownChange('# written in the editor');

      component.cancelMarkdown();

      expect(component.draft()).toBe('# written in the editor');
    });

    it('cancel_ofABlankEditor_leavesTheComposerEmpty', () => {
      component.openMarkdown();
      component.onMarkdownChange('   ');

      component.cancelMarkdown();

      expect(component.draft()).toBe('');
    });

    it('submit_sendsTheMarkdown_andRepins', () => {
      component.openMarkdown();
      component.onMarkdownChange('# a prompt');

      component.submitMarkdown();

      expect(sent).toEqual(['# a prompt']);
      expect(sentEvents).toBe(1);
    });

    it('submit_whenBlank_sendsNothing', () => {
      component.openMarkdown();
      component.onMarkdownChange('  ');

      component.submitMarkdown();

      expect(sent).toEqual([]);
    });

    it('submit_whileARunIsInFlight_keepsTheTextForLater', () => {
      running.set(true);
      component.openMarkdown();
      component.onMarkdownChange('# a prompt');

      component.submitMarkdown();
      expect(sent).toEqual([]);

      component.cancelMarkdown();
      expect(component.draft()).toBe('# a prompt');
    });
  });

  describe('suggestions', () => {
    /**
     * Accepts the suggestion on show with Enter.
     */
    function accept(): void {
      component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    }

    it('discoveredCommand_isWrittenIntoTheDraftForArguments', () => {
      discoveredCommands.set([{ name: 'review', description: 'Review', argumentHint: '' }]);
      type('/rev');

      accept();

      expect(component.draft()).toBe('/review ');
      expect(sent).toEqual([]);
    });

    it('modeCommand_togglesTheMode', () => {
      type('/mode');

      accept();

      expect(modeChanges).toEqual(['chat']);
      expect(component.draft()).toBe('');
    });

    it('clearCommand_startsAfresh', () => {
      type('/clear');

      accept();

      expect(clearedChats).toBe(1);
    });

    it('signInCommands_whereSignInIsSupported_reachTheAgent', () => {
      signInSupported.set(true);
      type('/login');
      accept();
      type('/logout');
      accept();

      expect(loginPrompts).toBe(1);
      expect(logouts).toBe(1);
    });

    it('signInCommands_whereSignInIsUnsupported_areNotOffered', () => {
      type('/log');

      expect(hostElement().textContent).not.toContain('/login');
      expect(hostElement().textContent).not.toContain('/logout');
    });

    it('mention_withNoFolderOpen_writesTheNameButAttachesNothing', async () => {
      type('@main');
      await fixture.whenStable();
      type('@main');
      workspaceRoot.set(null);

      accept();

      expect(component.draft()).toBe('@main.ts ');
      expect(attachedContext).toEqual([]);
    });

    it('mention_withNothingTyped_listsTheFiles', async () => {
      type('@');
      await fixture.whenStable();
      type('@');

      const labels: string[] = Array.from(
        hostElement().querySelectorAll('.agent__suggest-label'),
      ).map((label: Element): string => label.textContent?.trim() ?? '');
      expect(labels).toContain('README.md');
    });

    it('highlight_staysOnTheListAsTheQueryNarrowsIt', () => {
      type('/');
      for (let press: number = 0; press < 3; press += 1) {
        component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      }

      type('/comp');

      expect(hostElement().querySelector('.agent__suggest-item--active')?.textContent).toContain(
        'Manage prompts',
      );
    });

    it('manage_opensTheLibrary_andSavingAddsThePromptAndClearsTheForm', () => {
      type('/manage');
      accept();
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();
      const content: HTMLElement | null = windows.contentHost;
      const name: HTMLInputElement | null | undefined = content?.querySelector<HTMLInputElement>(
        '.agent__prompts app-text-field input',
      );
      const text: HTMLTextAreaElement | null | undefined =
        content?.querySelector<HTMLTextAreaElement>('.agent__prompts app-textarea textarea');
      if (name === null || name === undefined || text === null || text === undefined) {
        throw new Error('The library did not open');
      }

      name.value = 'tidy';
      name.dispatchEvent(new Event('input'));
      text.value = 'Tidy this up.';
      text.dispatchEvent(new Event('input'));
      TestBed.inject(ApplicationRef).tick();
      component.savePrompt();
      TestBed.inject(ApplicationRef).tick();

      expect(TestBed.inject(AgentPrompts).prompts()[0]?.text).toBe('Tidy this up.');
      expect(content?.textContent).toContain('/tidy');
      expect(name.value).toBe('');
      expect(text.value).toBe('');

      component.closeManagePrompts();
      TestBed.inject(ApplicationRef).tick();

      expect(windows.openWindows).toBe(0);
    });

    it('library_withABlankForm_savesNothing', () => {
      component.savePrompt();

      expect(TestBed.inject(AgentPrompts).prompts()).toEqual([]);
    });

    it('library_deleteRemovesThePrompt', () => {
      const library: AgentPrompts = TestBed.inject(AgentPrompts);
      library.save('gone', 'Soon gone.');

      component.deletePrompt(library.prompts()[0]?.id ?? '');

      expect(library.prompts()).toEqual([]);
    });
  });

  describe('attaching images', () => {
    it('paste_ofText_isLeftToTheTextArea', () => {
      const pasted: Event = raise(
        hostElement().querySelector('.agent__input') ?? hostElement(),
        'paste',
        'clipboardData',
        { items: [{ type: 'text/plain', getAsFile: (): null => null }] },
      );

      expect(pasted.defaultPrevented).toBe(false);
    });

    it('paste_ofAScreenshot_attachesItInsteadOfPastingText', async () => {
      const pasted: Event = raise(
        hostElement().querySelector('.agent__input') ?? hostElement(),
        'paste',
        'clipboardData',
        { items: [{ type: 'image/png', getAsFile: (): File => png('shot.png') }] },
      );

      expect(pasted.defaultPrevented).toBe(true);
      await vi.waitFor((): void => {
        expect(attachedImages()).toEqual(['shot.png']);
      });
    });

    it('paste_ofAnImageTheClipboardCannotProduce_isLeftAlone', () => {
      const pasted: Event = raise(
        hostElement().querySelector('.agent__input') ?? hostElement(),
        'paste',
        'clipboardData',
        { items: [{ type: 'image/png', getAsFile: (): null => null }] },
      );

      expect(pasted.defaultPrevented).toBe(false);
    });

    it('drop_ofAnImage_attachesIt', async () => {
      const target: Element = hostElement().querySelector('form') ?? hostElement();

      const over: Event = raise(target, 'dragover', 'dataTransfer', undefined);
      const dropped: Event = raise(target, 'drop', 'dataTransfer', { files: [png('drop.png')] });

      expect(over.defaultPrevented).toBe(true);
      expect(dropped.defaultPrevented).toBe(true);
      await vi.waitFor((): void => {
        expect(attachedImages()).toEqual(['drop.png']);
      });
    });

    it('drop_ofNothing_attachesNothing', () => {
      const target: Element = hostElement().querySelector('form') ?? hostElement();

      raise(target, 'drop', 'dataTransfer', { files: [] });

      expect(attachedImages()).toEqual([]);
    });

    it('remove_takesOnlyThatImage', async () => {
      await component.addImageFiles([png('one.png'), png('two.png')]);

      component.removeImage(0);

      expect(attachedImages()).toEqual(['two.png']);
    });

    it('anUnnamedImage_isAttachedWithoutAName', async () => {
      await component.addImageFiles([new File([new Uint8Array([1])], '', { type: 'image/png' })]);

      component.onInput('see this');
      component.send();

      expect(sentImages[0]?.[0]?.name).toBeUndefined();
    });

    it('theCap_stopsTheRestOfADropAndSaysSo', async () => {
      TestBed.inject(Settings).set('ai.maxImagesPerMessage', 4);

      await component.addImageFiles(
        ['1.png', '2.png', '3.png', '4.png', '5.png'].map((name: string): File => png(name)),
      );

      expect(attachedImages()).toHaveLength(4);
      expect(hostElement().querySelector('.agent__image-hint')?.textContent).toContain(
        'At most 4 images',
      );
    });

    it('hint_goesAwayByItself', async () => {
      vi.useFakeTimers();
      try {
        const wrong: File = new File([new Uint8Array([1])], 'a.mp4', { type: 'video/mp4' });
        await component.addImageFiles([wrong]);
        await component.addImageFiles([wrong]);
        vi.advanceTimersByTime(4000);
        fixture.detectChanges();

        expect(hostElement().querySelector('.agent__image-hint')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('queued messages', () => {
    const waiting: AgentQueuedMessage = { id: 'q1', text: 'queued text' };

    it('edit_loadsTheMessageBackAndTakesItOffTheQueue', () => {
      queued.set([waiting]);

      component.editQueued(waiting);
      fixture.detectChanges();

      expect(component.draft()).toBe('queued text');
      expect(hostElement().querySelector<HTMLTextAreaElement>('.agent__input')?.value).toBe(
        'queued text',
      );
      expect(queued()).toEqual([]);
    });

    it('edit_ofAMessageThatHasAlreadyGone_leavesTheDraftAlone', () => {
      component.onInput('still writing');

      component.editQueued(waiting);

      expect(component.draft()).toBe('still writing');
    });

    it('remove_takesItOffTheQueue', () => {
      component.removeQueued('q1');

      expect(removedQueued).toEqual(['q1']);
    });
  });

  describe('editing a sent message', () => {
    const earlier: AgentItem = { id: 'item-1', kind: 'user', text: 'an earlier prompt' };

    it('escape_leavesEditModeAndRestoresTheDraft', () => {
      component.onInput('what I was writing');
      component.beginEdit(earlier);
      const escape: KeyboardEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
      });

      component.onKeydown(escape);

      expect(escape.defaultPrevented).toBe(true);
      expect(component.draft()).toBe('what I was writing');
    });

    it('cancel_outsideEditMode_leavesTheDraftAlone', () => {
      component.onInput('what I was writing');

      component.cancelEdit();

      expect(component.draft()).toBe('what I was writing');
    });
  });

  describe('keys', () => {
    /**
     * Presses Enter in the real text area, so the template's handlers run.
     * @param modifiers The modifiers held.
     * @returns Returns the raised event.
     */
    function pressEnter(modifiers: KeyboardEventInit): KeyboardEvent {
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      hostElement().querySelector('.agent__input')?.dispatchEvent(event);
      return event;
    }

    it('modEnter_whenItDoesNotSend_insertsANewLineAtTheCaret', () => {
      const area: HTMLTextAreaElement = type('ab');
      area.setSelectionRange(1, 1);

      const pressed: KeyboardEvent = pressEnter({ ctrlKey: true });

      expect(pressed.defaultPrevented).toBe(true);
      expect(component.draft()).toBe('a\nb');
      expect(area.selectionStart).toBe(2);
      expect(sent).toEqual([]);
    });

    it('modShiftEnter_doesNothing', () => {
      type('ab');

      const pressed: KeyboardEvent = pressEnter({ ctrlKey: true, shiftKey: true });

      expect(pressed.defaultPrevented).toBe(false);
      expect(sent).toEqual([]);
    });

    it('altEnter_doesNothing', () => {
      type('ab');

      const pressed: KeyboardEvent = pressEnter({ altKey: true });

      expect(pressed.defaultPrevented).toBe(false);
      expect(sent).toEqual([]);
    });

    it('history_withNothingSent_leavesTheDraftAlone', () => {
      const area: HTMLTextAreaElement = type('a draft');

      area.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }),
      );

      expect(component.draft()).toBe('a draft');
    });

    it('history_downBeforeGoingUp_leavesTheDraftAlone', () => {
      items.set([{ id: 'item-1', kind: 'user', text: 'first prompt' }]);
      const area: HTMLTextAreaElement = type('a draft');

      area.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
      );

      expect(component.draft()).toBe('a draft');
    });
  });

  it('images_twoReadsRacingForTheLastPlace_stillHoldTheCap', async () => {
    TestBed.inject(Settings).set('ai.maxImagesPerMessage', 4);
    await component.addImageFiles([png('1.png'), png('2.png'), png('3.png')]);

    await Promise.all([
      component.addImageFiles([png('4.png')]),
      component.addImageFiles([png('5.png')]),
    ]);

    expect(attachedImages()).toEqual(['1.png', '2.png', '3.png', '4.png']);
    expect(hostElement().querySelector('.agent__image-hint')?.textContent).toContain(
      'At most 4 images',
    );
  });

  it('images_whenAFileCannotBeRead_saysSo', async () => {
    /**
     * A reader whose read fails, as one does when the file went away.
     */
    class FailingReader {
      public onerror: (() => void) | null = null;

      public readAsDataURL(): void {
        queueMicrotask((): void => this.onerror?.());
      }
    }
    vi.stubGlobal('FileReader', FailingReader);

    try {
      await component.addImageFiles([png('gone.png')]);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(attachedImages()).toEqual([]);
    expect(hostElement().querySelector('.agent__image-hint')?.textContent).toContain(
      'could not be read',
    );
  });
});
