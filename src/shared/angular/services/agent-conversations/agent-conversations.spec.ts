import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import {
  AgentConversationChannel,
  AgentConversationSummary,
  StoredAgentConversation,
} from '@shared/api/agent-conversation-channels';
import { AgentConversations } from './agent-conversations';

/**
 * A recorded bridge invocation.
 */
interface InvokeCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('AgentConversations', () => {
  let calls: InvokeCall[];

  /**
   * Installs a stub bridge on the window that records invocations and returns a fixed result.
   * @param result The value the stubbed invoke resolves with.
   */
  function stubBridge(result: unknown): void {
    calls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        return Promise.resolve(result as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('list_forwardsTheContextIdAndReturnsSummaries', async () => {
    const summary: AgentConversationSummary = {
      id: 'a',
      contextId: 'file:/x',
      title: 't',
      messageCount: 2,
      createdAt: 1,
      updatedAt: 2,
    };
    stubBridge([summary]);
    const service: AgentConversations = TestBed.inject(AgentConversations);

    const result: readonly AgentConversationSummary[] = await service.list('file:/x');

    expect(calls[0].channel).toBe(AgentConversationChannel.List);
    expect(calls[0].args).toEqual(['file:/x']);
    expect(result).toEqual([summary]);
  });

  it('save_forwardsTheRecord', async () => {
    stubBridge(null);
    const service: AgentConversations = TestBed.inject(AgentConversations);
    const record: StoredAgentConversation = {
      id: 'a',
      contextId: 'global:',
      title: 'hi',
      provider: 'claude',
      model: 'm',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
      items: [{ id: 'item-1', kind: 'user', text: 'hi' }],
    };

    await service.save(record);

    expect(calls[0].channel).toBe(AgentConversationChannel.Save);
    expect(calls[0].args[0]).toEqual(record);
  });

  it('delete_forwardsTheIds', async () => {
    stubBridge(undefined);
    const service: AgentConversations = TestBed.inject(AgentConversations);

    await service.delete(['a', 'b']);

    expect(calls[0].channel).toBe(AgentConversationChannel.Delete);
    expect(calls[0].args).toEqual([['a', 'b']]);
  });

  it('list_whenBridgeAbsent_returnsEmpty', async () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const service: AgentConversations = TestBed.inject(AgentConversations);

    expect(await service.list('x')).toEqual([]);
    expect(service.isAvailable).toBe(false);
  });

  it('load_whenBridgeAbsent_returnsNull', async () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const service: AgentConversations = TestBed.inject(AgentConversations);

    expect(await service.load('x')).toBeNull();
  });
});
