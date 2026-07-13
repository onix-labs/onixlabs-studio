import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AgentContextRef, AiPermissionRemember } from '@shared/api/ai-types';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
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
  let permissionResponses: { id: string; granted: boolean; remember?: AiPermissionRemember }[];

  beforeEach(async () => {
    permissionResponses = [];
    sent = [];
    stopped = 0;
    contextPaths = signal<readonly AgentContextRef[]>([]);
    removed = [];
    pendingInput = signal<AgentItem | undefined>(undefined);
    inputAnswers = [];
    items = signal<readonly AgentItem[]>([]);
    const agentStub: Partial<Agent> = {
      items,
      isRunning: signal<boolean>(false),
      awaitingDecision: signal<boolean>(false),
      pendingInput,
      contextTokens: signal<number>(0),
      contextWindow: signal<number>(0),
      costUsd: signal<number>(0),
      contextPaths,
      send: (text: string): void => void sent.push(text),
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
    };

    await TestBed.configureTestingModule({
      imports: [AgentChat],
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
      .querySelector<HTMLButtonElement>('.agent__attachment-remove')!
      .click();

    expect(removed).toEqual(['/repo/src/main.ts']);
  });

  it('composer_whenRendered_doesNotShowProviderOrModelDropdowns', () => {
    fixture.detectChanges();
    const dropdowns: NodeListOf<Element> = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.agent__composer app-dropdown',
    );

    expect(dropdowns.length).toBe(0);
  });
});
