import { signal, Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { AgentContextRef, AiModelInfo, AiProviderId } from '@shared/api/ai-types';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import {
  AgentConversationMetaPatch,
  AgentConversationSummary,
  ConversationContext,
  StoredAgentConversation,
} from '@shared/api/agent-conversation-channels';
import {
  Agent,
  AgentBranchPoint,
  AgentItem,
  AgentQueuedMessage,
} from '@shared/angular/services/agent/agent';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import {
  AGENT_CONVERSATION_CONTEXT,
  ConversationContextResolver,
} from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { AgentConversation } from './agent-conversation';

/**
 * Builds an agent stub tracking clear/restore for the conversation-service tests.
 * @param items The transcript signal the stub exposes.
 * @param log A record the stub appends its calls to.
 * @returns Returns the partial agent.
 */
function agentStub(
  items: WritableSignal<readonly AgentItem[]>,
  log: string[],
  branch: WritableSignal<AgentBranchPoint>,
  attachedRefs: AgentContextRef[],
): Partial<Agent> {
  return {
    items,
    isRunning: signal<boolean>(false),
    provider: signal<AiProviderId>('claude'),
    model: signal<string>('claude-opus-4-8'),
    models: signal<readonly AiModelInfo[]>([]),
    queued: signal<readonly AgentQueuedMessage[]>([]),
    branch,
    clear: (): void => {
      log.push('clear');
      items.set([]);
    },
    stop: (): void => void log.push('stop'),
    restore: (restored: readonly AgentItem[]): void => {
      log.push('restore');
      items.set([...restored]);
    },
    attachContext: (ref: AgentContextRef): void => void attachedRefs.push(ref),
    clearContext: (): void => void log.push('clearContext'),
  };
}

describe('AgentConversation', () => {
  const RECORD: StoredAgentConversation = {
    id: 'c1',
    contextId: 'global:',
    title: 'Saved',
    provider: 'claude',
    model: 'claude-opus-4-8',
    createdAt: 1,
    updatedAt: 2,
    messageCount: 2,
    items: [{ id: 'item-1', kind: 'user', text: 'hi' }] as readonly unknown[],
  };

  let items: WritableSignal<readonly AgentItem[]>;
  let log: string[];
  let branch: WritableSignal<AgentBranchPoint>;
  let saves: StoredAgentConversation[];
  let metaPatches: AgentConversationMetaPatch[];
  let attachedRefs: AgentContextRef[];

  /**
   * Configures the module with the given optional context resolver and returns the service.
   * @param resolver The context resolver to provide, or undefined for none.
   * @returns Returns the constructed service.
   */
  function build(resolver?: ConversationContextResolver): AgentConversation {
    const storeStub: Partial<AgentConversations> = {
      list: (): Promise<readonly AgentConversationSummary[]> => Promise.resolve([]),
      listAll: (): Promise<readonly AgentConversationSummary[]> => Promise.resolve([]),
      load: (): Promise<StoredAgentConversation | null> => Promise.resolve(RECORD),
      save: (record: StoredAgentConversation): Promise<AgentConversationSummary | null> => {
        saves.push(record);
        return Promise.resolve(null);
      },
      updateMeta: (patch: AgentConversationMetaPatch): Promise<AgentConversationSummary | null> => {
        metaPatches.push(patch);
        return Promise.resolve(null);
      },
      clearCategory: (): Promise<void> => Promise.resolve(),
      delete: (): Promise<void> => Promise.resolve(),
    };
    const engineStub: Partial<AgentEngine> = {
      provider: signal<AiProviderId>('claude'),
      model: signal<string>('claude-opus-4-8'),
    };
    TestBed.configureTestingModule({
      providers: [
        AgentConversation,
        { provide: Agent, useValue: agentStub(items, log, branch, attachedRefs) },
        { provide: AgentConversations, useValue: storeStub },
        { provide: AgentEngine, useValue: engineStub },
        ...(resolver === undefined
          ? []
          : [{ provide: AGENT_CONVERSATION_CONTEXT, useValue: resolver }]),
      ],
    });
    return TestBed.inject(AgentConversation);
  }

  beforeEach(() => {
    items = signal<readonly AgentItem[]>([]);
    log = [];
    branch = signal<AgentBranchPoint>({ epoch: 0, origin: [], originSessionId: null });
    saves = [];
    metaPatches = [];
    attachedRefs = [];
  });

  it('context_whenNoResolverAndNoBinding_isGlobal', () => {
    const conversation: AgentConversation = build();

    expect(conversation.context().kind).toBe('global');
  });

  it('context_whenResolverProvided_usesIt', () => {
    const conversation: AgentConversation = build(
      (): ConversationContext => ({ kind: 'workspace', key: '/repo' }),
    );

    expect(conversation.context()).toEqual({ kind: 'workspace', key: '/repo' });
  });

  it('context_whenExplicitBound_winsOverResolver', () => {
    const conversation: AgentConversation = build(
      (): ConversationContext => ({ kind: 'workspace', key: '/repo' }),
    );
    const explicit: Signal<ConversationContext | undefined> = signal<ConversationContext>({
      kind: 'file',
      key: '/repo/a.ts',
    });

    conversation.bindContext(explicit);

    expect(conversation.context()).toEqual({ kind: 'file', key: '/repo/a.ts' });
  });

  it('newChat_whenCalled_clearsTheTranscriptAndClosesHistory', () => {
    const conversation: AgentConversation = build();
    conversation.toggleHistory();

    conversation.newChat();

    expect(log).toContain('clear');
    expect(conversation.historyOpen()).toBe(false);
  });

  it('setAutoScroll_whenToggledOff_updatesThePreference', () => {
    const conversation: AgentConversation = build();
    expect(conversation.autoScroll()).toBe(true);

    conversation.setAutoScroll(false);

    expect(conversation.autoScroll()).toBe(false);
  });

  it('attachSelection_whenAnEditorHasASelection_attachesItsTextAsInlineContext', () => {
    const conversation: AgentConversation = build();
    const editors: EditorCommands = TestBed.inject(EditorCommands);
    editors.register('tab-1', {
      cut: (): void => undefined,
      copy: (): void => undefined,
      paste: (): void => undefined,
      undo: (): void => undefined,
      redo: (): void => undefined,
      find: (): void => undefined,
      formatDocument: (): void => undefined,
      save: (): void => undefined,
      saveAs: (): void => undefined,
      getText: (): string => 'whole document',
      getSelectionText: (): string => 'const answer = 42;\nreturn answer;',
      replaceText: (): void => undefined,
      replaceRange: (): void => undefined,
    });

    conversation.attachSelection();

    expect(attachedRefs).toHaveLength(1);
    expect(attachedRefs[0].kind).toBe('selection');
    expect(attachedRefs[0].content).toBe('const answer = 42;\nreturn answer;');
    expect(attachedRefs[0].path).toContain('selection #1 (2 lines)');
  });

  it('attachSelection_whenNothingIsSelected_attachesNothing', () => {
    const conversation: AgentConversation = build();

    conversation.attachSelection();

    expect(attachedRefs).toHaveLength(0);
  });

  it('branch_whenARewindPublishesAnOrigin_preservesItAsItsOwnRecordAndDetachesTheId', async () => {
    const conversation: AgentConversation = build();
    const origin: readonly AgentItem[] = [
      { id: 'item-1', kind: 'user', text: 'original question' },
      { id: 'item-2', kind: 'assistant', text: 'original answer' },
    ];

    branch.set({ epoch: 1, origin, originSessionId: 'sess-1' });
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(saves).toHaveLength(1);
    expect(saves[0].items).toBe(origin);
    expect(saves[0].sessionId).toBe('sess-1');
    expect(saves[0].title).toBe('original question');
    // The edited line continues under a fresh conversation id.
    expect(conversation.currentId()).toBeNull();
  });

  it('open_whenRecordExists_restoresTheTranscriptAndMarksItCurrent', async () => {
    const conversation: AgentConversation = build();

    await conversation.open('c1');

    expect(log).toContain('restore');
    expect(conversation.currentId()).toBe('c1');
  });

  it('rename_patchesTheTitleThroughTheStore', async () => {
    const conversation: AgentConversation = build();

    await conversation.rename('c1', '  New title  ');

    expect(metaPatches).toEqual([{ id: 'c1', title: 'New title' }]);
  });

  it('rename_whenTitleIsBlank_patchesNothing', async () => {
    const conversation: AgentConversation = build();

    await conversation.rename('c1', '   ');

    expect(metaPatches).toHaveLength(0);
  });

  it('setCategory_filesTheConversationUnderTheGivenCategory', async () => {
    const conversation: AgentConversation = build();

    await conversation.setCategory('c1', 'cat1');

    expect(metaPatches).toEqual([{ id: 'c1', categoryId: 'cat1' }]);
  });

  it('duplicate_savesAnIndependentCopyWithoutASession', async () => {
    const conversation: AgentConversation = build();

    await conversation.duplicate('c1');

    expect(saves).toHaveLength(1);
    expect(saves[0].id).not.toBe('c1');
    expect(saves[0].title).toBe('Saved (copy)');
    expect(saves[0].titleIsCustom).toBe(true);
    expect(saves[0].sessionId).toBeNull();
  });
});
