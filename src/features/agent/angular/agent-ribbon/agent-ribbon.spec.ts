import { signal, WritableSignal } from '@angular/core';
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
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
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

describe('AgentRibbon', () => {
  let component: AgentRibbon;
  let fixture: ComponentFixture<AgentRibbon>;
  let host: HTMLElement;
  let cleared: number;
  let stopped: number;
  let historyToggles: number;
  let providerChoices: AiProviderId[];
  let modelChoices: string[];
  let remoteControlChoices: AiRemoteControlMode[];
  let running: WritableSignal<boolean>;
  let hasMessages: WritableSignal<boolean>;
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
    providerChoices = [];
    modelChoices = [];
    remoteControlChoices = [];
    running = signal<boolean>(false);
    hasMessages = signal<boolean>(true);
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
      setProvider: (id: AiProviderId): void => void providerChoices.push(id),
      setModel: (id: string): void => void modelChoices.push(id),
      setRemoteControl: (mode: AiRemoteControlMode): void => void remoteControlChoices.push(mode),
      newChat: (): void => void (cleared += 1),
      stop: (): void => void (stopped += 1),
      toggleHistory: (): void => void (historyToggles += 1),
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentRibbon);
    component = fixture.componentInstance;
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

  it('provider_whenChanged_selectsTheMatchingProvider', () => {
    const select: HTMLSelectElement = field('Provider');
    select.value = 'Vercel AI SDK';
    select.dispatchEvent(new Event('change'));

    expect(providerChoices).toEqual(['vercel']);
  });

  it('model_whenChanged_selectsTheMatchingModel', () => {
    const select: HTMLSelectElement = field('Model');
    select.value = 'Haiku 4.5';
    select.dispatchEvent(new Event('change'));

    expect(modelChoices).toEqual(['claude-haiku-4-5']);
  });

  it('remote_whenChanged_setsTheMatchingRemoteControlMode', () => {
    const select: HTMLSelectElement = field('Remote');
    select.value = 'Remote mirror (view-only)';
    select.dispatchEvent(new Event('change'));

    expect(remoteControlChoices).toEqual(['mirror']);
  });

  it('history_whenClicked_togglesTheHistoryList', () => {
    button('History').click();

    expect(historyToggles).toBe(1);
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
