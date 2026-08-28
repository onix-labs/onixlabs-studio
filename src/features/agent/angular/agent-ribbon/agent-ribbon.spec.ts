import { Signal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type {
  AgentContextRef,
  AgentMode,
  AiModelInfo,
  AiProviderId,
  AiProviderInfo,
  AiRemoteControlMode,
} from '@shared/api/ai-types';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { AgentSessions } from '@shared/angular/services/agent-sessions/agent-sessions';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { MenuContribution, MenuEntry } from '@shared/angular/services/app-menu/app-menu-model';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { AgentRibbon } from './agent-ribbon';

/**
 * The models the stub agent offers.
 */
const MODELS: readonly AiModelInfo[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', contextWindow: 1_000_000 },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', contextWindow: 200_000 },
];

/**
 * The providers the stub agent reports.
 */
const PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: 'claude',
    label: 'Claude (Agent SDK)',
    available: true,
    detail: 'ok',
    models: MODELS,
    defaultModelId: 'claude-opus-4-8',
  },
  {
    id: 'vercel',
    label: 'Vercel AI SDK',
    available: true,
    detail: 'ok',
    models: MODELS,
    defaultModelId: 'claude-opus-4-8',
  },
];

/**
 * The ribbon internals the Remote Control tests reach into (protected on the component).
 */
interface RibbonInternals {
  readonly remoteConfirmOpen: Signal<boolean>;
  onRemoteControlConfirmed(): void;
  onRemoteControlDismissed(): void;
}

describe('AgentRibbon', () => {
  let component: AgentRibbon;
  let internals: RibbonInternals;
  let fixture: ComponentFixture<AgentRibbon>;
  let host: HTMLElement;
  let cleared: number;
  let stopped: number;
  let historyToggles: number;
  let tailRequests: number;
  let providerChoices: AiProviderId[];
  let modelChoices: string[];
  let remoteControlChoices: boolean[];
  let running: WritableSignal<boolean>;
  let hasMessages: WritableSignal<boolean>;
  let remoteControlEnabled: WritableSignal<boolean>;
  let historyOpen: WritableSignal<boolean>;
  let mode: WritableSignal<AgentMode>;
  let modeChoices: AgentMode[];
  let compacted: number;
  let attachedFiles: number;
  let attachedFolders: number;
  let attachedSelections: number;
  let clearedContexts: number;
  let contextRefs: WritableSignal<readonly AgentContextRef[]>;
  let hasSelection: WritableSignal<boolean>;
  let windows: FakeModalWindows;

  /**
   * Finds a ribbon button by its visible label.
   * @param label The button label.
   * @returns Returns the matching button element.
   */
  function button(label: string): HTMLButtonElement {
    const match: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
    if (match === undefined) {
      throw new Error(`No button labelled "${label}"`);
    }
    return match;
  }

  /**
   * Finds a ribbon field's select by its caption (exposed as the select's accessible name).
   * @param caption The field caption.
   * @returns Returns the matching select element.
   */
  function field(caption: string): HTMLSelectElement {
    const select: HTMLSelectElement | null = host.querySelector<HTMLSelectElement>(
      `select[aria-label="${caption}"]`,
    );
    if (select === null) {
      throw new Error(`No field captioned "${caption}"`);
    }
    return select;
  }

  beforeEach(async () => {
    cleared = 0;
    stopped = 0;
    historyToggles = 0;
    tailRequests = 0;
    providerChoices = [];
    modelChoices = [];
    remoteControlChoices = [];
    running = signal<boolean>(false);
    hasMessages = signal<boolean>(true);
    remoteControlEnabled = signal<boolean>(false);
    historyOpen = signal<boolean>(false);
    mode = signal<AgentMode>('agent');
    modeChoices = [];
    compacted = 0;
    attachedFiles = 0;
    attachedFolders = 0;
    attachedSelections = 0;
    clearedContexts = 0;
    contextRefs = signal<readonly AgentContextRef[]>([]);
    hasSelection = signal<boolean>(false);
    windows = new FakeModalWindows();
    const engineStub: Partial<AgentEngine> = {
      providers: signal<readonly AiProviderInfo[]>(PROVIDERS),
    };
    const sessionsStub: Partial<AgentSessions> = {
      isRunning: running,
      hasMessages,
      historyOpen,
      mode,
      contextPaths: contextRefs,
      provider: signal<AiProviderId>('claude'),
      model: signal<string>('claude-opus-4-8'),
      models: signal<readonly AiModelInfo[]>(MODELS),
      supportsRemoteControl: signal<boolean>(true),
      remoteControl: signal<AiRemoteControlMode>('off'),
      remoteControlEnabled,
      setProvider: (id: AiProviderId): void => void providerChoices.push(id),
      setModel: (id: string): void => void modelChoices.push(id),
      setRemoteControlEnabled: (enabled: boolean): void => void remoteControlChoices.push(enabled),
      newChat: (): void => void (cleared += 1),
      stop: (): void => void (stopped += 1),
      toggleHistory: (): void => void (historyToggles += 1),
      scrollToBottom: (): void => void (tailRequests += 1),
      setMode: (value: AgentMode): void => void modeChoices.push(value),
      compact: (): void => void (compacted += 1),
      attachFile: (): void => void (attachedFiles += 1),
      attachFolder: (): void => void (attachedFolders += 1),
      attachSelection: (): void => void (attachedSelections += 1),
      clearContext: (): void => void (clearedContexts += 1),
    };

    const editorsStub: Partial<EditorCommands> = { hasSelection };

    await TestBed.configureTestingModule({
      imports: [AgentRibbon],
      providers: [
        { provide: AgentEngine, useValue: engineStub },
        { provide: AgentSessions, useValue: sessionsStub },
        { provide: EditorCommands, useValue: editorsStub },
        { provide: ModalWindows, useValue: windows },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentRibbon);
    component = fixture.componentInstance;
    internals = component as unknown as RibbonInternals;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('newChat_whenClicked_clearsTheTranscript', () => {
    button('New').click();

    expect(cleared).toBe(1);
  });

  it('newChat_whenChatEmpty_isDisabled', () => {
    hasMessages.set(false);
    fixture.detectChanges();

    expect(button('New').disabled).toBe(true);
  });

  it('stop_whenNotRunning_isDisabled', () => {
    expect(button('Stop').disabled).toBe(true);
  });

  it('stop_whenRunningAndClicked_stopsTheRun', () => {
    running.set(true);
    fixture.detectChanges();

    const stop: HTMLButtonElement = button('Stop');
    expect(stop.disabled).toBe(false);
    stop.click();

    expect(stopped).toBe(1);
  });

  it('engine_whenRendered_offersOneFieldGroupingModelsByProvider', () => {
    // One merged field, not a Provider field and a Model field.
    expect(host.querySelector('select[aria-label="Provider"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Model"]')).toBeNull();

    const select: HTMLSelectElement = field('Provider and model');
    const groups: NodeListOf<HTMLOptGroupElement> = select.querySelectorAll('optgroup');
    expect(Array.from(groups, (group: HTMLOptGroupElement): string => group.label)).toEqual([
      'Claude (Agent SDK)',
      'Vercel AI SDK',
    ]);
    // Both providers offer the same model ids, so the values must name the pair, not the model alone.
    expect(Array.from(select.options, (option: HTMLOptionElement): string => option.value)).toEqual(
      [
        'claude::claude-opus-4-8',
        'claude::claude-haiku-4-5',
        'vercel::claude-opus-4-8',
        'vercel::claude-haiku-4-5',
      ],
    );
    expect(select.value).toBe('claude::claude-opus-4-8');
  });

  it('engine_whenAModelOfAnotherProviderIsPicked_setsTheProviderThenTheModel', () => {
    const select: HTMLSelectElement = field('Provider and model');
    select.value = 'vercel::claude-haiku-4-5';
    select.dispatchEvent(new Event('change'));

    // The provider must be applied first: setting it resets the model to that provider's default.
    expect(providerChoices).toEqual(['vercel']);
    expect(modelChoices).toEqual(['claude-haiku-4-5']);
  });

  it('engine_whenAModelOfTheCurrentProviderIsPicked_leavesTheProviderAlone', () => {
    const select: HTMLSelectElement = field('Provider and model');
    select.value = 'claude::claude-haiku-4-5';
    select.dispatchEvent(new Event('change'));

    expect(providerChoices).toEqual([]);
    expect(modelChoices).toEqual(['claude-haiku-4-5']);
  });

  it('remote_whenClicked_doesNotFlipUntilTheConfirmationIsAnswered', () => {
    button('Remote').click();
    fixture.detectChanges();

    // The confirmation is now presented in its own modal window; the press opens it but must not flip
    // the toggle until it is answered.
    expect(windows.openWindows).toBe(1);
    expect(remoteControlChoices).toEqual([]);
    expect(internals.remoteConfirmOpen()).toBe(true);
  });

  it('remote_whenConfirmed_flipsTheRemoteControlState', () => {
    button('Remote').click();
    fixture.detectChanges();
    internals.onRemoteControlConfirmed();

    expect(remoteControlChoices).toEqual([true]);
    expect(internals.remoteConfirmOpen()).toBe(false);
  });

  it('remote_whenDismissed_leavesRemoteControlWhereItWas', () => {
    remoteControlEnabled.set(true);
    button('Remote').click();
    fixture.detectChanges();
    internals.onRemoteControlDismissed();

    expect(remoteControlChoices).toEqual([]);
    expect(internals.remoteConfirmOpen()).toBe(false);
  });

  it('history_whenClicked_togglesTheHistoryList', () => {
    button('History').click();

    expect(historyToggles).toBe(1);
  });

  it('bottom_whenClicked_scrollsTheActiveTranscriptToItsLatestMessage', () => {
    button('Bottom').click();

    expect(tailRequests).toBe(1);
  });

  it('mode_whenChanged_setsTheChosenMode', () => {
    const select: HTMLSelectElement = field('Mode');
    expect(select.value).toBe('Full agent');

    select.value = 'Assistant only';
    select.dispatchEvent(new Event('change'));

    expect(modeChoices).toEqual(['chat']);
  });

  it('compact_whenClicked_compactsTheConversation', () => {
    button('Compact').click();

    expect(compacted).toBe(1);
  });

  it('compact_whenRunning_isDisabled', () => {
    running.set(true);
    fixture.detectChanges();

    expect(button('Compact').disabled).toBe(true);
  });

  it('compact_whenChatEmpty_isDisabled', () => {
    hasMessages.set(false);
    fixture.detectChanges();

    expect(button('Compact').disabled).toBe(true);
  });

  it('attachFile_whenClicked_attachesAFile', () => {
    button('File').click();

    expect(attachedFiles).toBe(1);
  });

  it('addFolder_whenClicked_attachesAFolder', () => {
    button('Folder').click();

    expect(attachedFolders).toBe(1);
  });

  it('attachSelection_whenAnEditorHoldsOne_attachesTheEditorSelection', () => {
    hasSelection.set(true);
    fixture.detectChanges();

    button('Selection').click();

    expect(attachedSelections).toBe(1);
  });

  it('attachSelection_whenNothingIsSelected_isDisabled', () => {
    // Nothing to attach, so the control does not offer itself rather than silently doing nothing.
    expect(button('Selection').disabled).toBe(true);
  });

  it('groups_whenRendered_areSessionViewEngineAndAttachmentsOnly', () => {
    // Permissions is gone: its Mode field moved into Engine and its Remote toggle into Session.
    const titles: string[] = Array.from(
      host.querySelectorAll<HTMLElement>('.ribbon-group__title'),
      (title: HTMLElement): string => title.textContent?.trim() ?? '',
    );
    expect(titles).toEqual(['Session', 'View', 'Engine', 'Attachments']);
    expect(field('Mode').closest('.ribbon-group')?.textContent).toContain('Engine');
    expect(button('Remote').closest('.ribbon-group')?.textContent).toContain('Session');
  });

  it('menu_whenACommandIsChosen_runsTheSameHandlerAsTheRibbon', () => {
    // The ribbon contributes the agent tab's menu, so the menu is a second route into these commands
    // and needs to be exercised as one: a menu entry wired to the wrong handler looks fine on the bar.
    const menu: AppMenu = TestBed.inject(AppMenu);
    TestBed.tick();

    menu.dispatch('agent.newChat');
    menu.dispatch('agent.stop');
    menu.dispatch('agent.compact');
    menu.dispatch('agent.history');
    menu.dispatch('agent.attachFile');
    menu.dispatch('agent.attachFolder');
    menu.dispatch('agent.attachSelection');
    menu.dispatch('agent.clearContext');

    expect(cleared).toBe(1);
    expect(stopped).toBe(1);
    expect(compacted).toBe(1);
    expect(historyToggles).toBe(1);
    expect(attachedFiles).toBe(1);
    expect(attachedFolders).toBe(1);
    expect(attachedSelections).toBe(1);
    expect(clearedContexts).toBe(1);
  });

  it('menu_whenRemoteControlIsChosen_opensTheConfirmationRatherThanFlipping', () => {
    const menu: AppMenu = TestBed.inject(AppMenu);
    TestBed.tick();

    menu.dispatch('agent.remoteControl');

    // Same rule as the ribbon button: exposing a session is confirmed before it happens.
    expect(remoteControlChoices).toEqual([]);
    expect(internals.remoteConfirmOpen()).toBe(true);
  });

  it('menu_whenStateChanges_reflectsEnablementAndChecks', () => {
    const menu: AppMenu = TestBed.inject(AppMenu);
    running.set(true);
    hasMessages.set(false);
    historyOpen.set(true);
    fixture.detectChanges();
    TestBed.tick();

    const items: readonly MenuEntry[] =
      menu.sections().find((section: MenuContribution): boolean => section.id === 'agent')?.items ??
      [];
    const entry: (id: string) => MenuEntry | undefined = (id: string): MenuEntry | undefined =>
      items.find((candidate: MenuEntry): boolean => candidate.id === id);

    expect(entry('agent.stop')?.enabled).toBe(true);
    expect(entry('agent.compact')?.enabled).toBe(false);
    expect(entry('agent.history')?.checked).toBe(true);
  });

  it('clearContext_whenNothingAttached_isDisabledOtherwiseClears', () => {
    expect(button('Clear').disabled).toBe(true);

    contextRefs.set([{ path: '/repo/a.ts', kind: 'file' }]);
    fixture.detectChanges();
    const clear: HTMLButtonElement = button('Clear');
    expect(clear.disabled).toBe(false);

    clear.click();
    expect(clearedContexts).toBe(1);
  });
});
