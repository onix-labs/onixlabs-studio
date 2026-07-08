import { signal, Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { AiProviderId } from '@shared/api/ai-types';
import {
  AgentConversationSummary,
  ConversationContext,
  StoredAgentConversation,
} from '@shared/api/agent-conversation-channels';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
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
function agentStub(items: WritableSignal<readonly AgentItem[]>, log: string[]): Partial<Agent> {
  return {
    items,
    isRunning: signal<boolean>(false),
    clear: (): void => {
      log.push('clear');
      items.set([]);
    },
    stop: (): void => void log.push('stop'),
    restore: (restored: readonly AgentItem[]): void => {
      log.push('restore');
      items.set([...restored]);
    },
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

  /**
   * Configures the module with the given optional context resolver and returns the service.
   * @param resolver The context resolver to provide, or undefined for none.
   * @returns Returns the constructed service.
   */
  function build(resolver?: ConversationContextResolver): AgentConversation {
    const storeStub: Partial<AgentConversations> = {
      list: (): Promise<readonly AgentConversationSummary[]> => Promise.resolve([]),
      load: (): Promise<StoredAgentConversation | null> => Promise.resolve(RECORD),
      delete: (): Promise<void> => Promise.resolve(),
    };
    const engineStub: Partial<AgentEngine> = {
      provider: signal<AiProviderId>('claude'),
      model: signal<string>('claude-opus-4-8'),
    };
    TestBed.configureTestingModule({
      providers: [
        AgentConversation,
        { provide: Agent, useValue: agentStub(items, log) },
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

  it('open_whenRecordExists_restoresTheTranscriptAndMarksItCurrent', async () => {
    const conversation: AgentConversation = build();

    await conversation.open('c1');

    expect(log).toContain('restore');
    expect(conversation.currentId()).toBe('c1');
  });
});
