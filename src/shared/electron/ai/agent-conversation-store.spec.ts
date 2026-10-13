import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentConversationChannel,
  AgentConversationSummary,
  StoredAgentConversation,
} from '@shared/api/agent-conversation-channels';
import { AgentConversationStore } from './agent-conversation-store';

const electron: {
  userData: string;
  handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>;
} = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { getPath: (): string => electron.userData },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void =>
      void electron.handlers.set(channel, handler),
  },
}));

describe('AgentConversationStore', () => {
  let store: AgentConversationStore;

  /**
   * Calls a registered IPC handler as the renderer would.
   * @param channel The channel.
   * @param args The arguments.
   * @returns Returns what the handler returns.
   */
  function call<T>(channel: AgentConversationChannel, ...args: unknown[]): Promise<T> {
    const handler: ((event: unknown, ...args: unknown[]) => unknown) | undefined =
      electron.handlers.get(channel);
    return Promise.resolve(handler?.({}, ...args) as T);
  }

  /**
   * Builds a conversation with the given id and transcript length.
   * @param id The conversation id.
   * @param messages How many messages the transcript holds.
   * @returns Returns the conversation.
   */
  function conversation(id: string, messages: number): StoredAgentConversation {
    return {
      id,
      contextId: 'global:',
      title: id,
      provider: 'claude',
      model: 'claude-opus-4-8',
      createdAt: 1,
      updatedAt: messages,
      messageCount: messages,
      items: Array.from({ length: messages }, (_: unknown, index: number): unknown => ({
        id: `item-${index}`,
        kind: 'user',
        text: `message ${index}`,
      })),
    };
  }

  /**
   * Reads a conversation's file straight from disk.
   * @param id The conversation id.
   * @returns Returns the parsed file.
   */
  function onDisk(id: string): StoredAgentConversation {
    return JSON.parse(
      readFileSync(join(electron.userData, 'agent-conversations', `${id}.json`), 'utf8'),
    ) as StoredAgentConversation;
  }

  beforeEach(() => {
    electron.userData = mkdtempSync(join(tmpdir(), 'conversation-store-'));
    electron.handlers.clear();
    store = new AgentConversationStore();
    store.register();
  });

  afterEach(async () => {
    await store.flush();
    rmSync(electron.userData, { recursive: true, force: true });
  });

  it('save_answersWithTheSummaryAtOnce_andWritesInTheBackground', async () => {
    const summary: AgentConversationSummary | null = await call(
      AgentConversationChannel.Save,
      conversation('c1', 2),
    );

    expect(summary?.id).toBe('c1');
    await store.flush();
    expect(onDisk('c1').messageCount).toBe(2);
  });

  it('save_inABurst_leavesTheNewestCopyOnDisk', async () => {
    for (let messages: number = 1; messages <= 20; messages += 1) {
      await call(AgentConversationChannel.Save, conversation('c1', messages));
    }

    await store.flush();

    expect(onDisk('c1').messageCount).toBe(20);
    const index: readonly AgentConversationSummary[] = JSON.parse(
      readFileSync(join(electron.userData, 'agent-conversations', 'index.json'), 'utf8'),
    ) as readonly AgentConversationSummary[];
    expect(index.map((entry: AgentConversationSummary): number => entry.messageCount)).toEqual([
      20,
    ]);
  });

  it('load_beforeTheWriteLands_returnsTheNewestCopy', async () => {
    await call(AgentConversationChannel.Save, conversation('c1', 3));

    const loaded: StoredAgentConversation | null = await call(AgentConversationChannel.Load, 'c1');

    expect(loaded?.messageCount).toBe(3);
  });

  it('listAll_servesFromMemory_newestFirst', async () => {
    await call(AgentConversationChannel.Save, conversation('older', 1));
    await call(AgentConversationChannel.Save, conversation('newer', 5));

    const listed: readonly AgentConversationSummary[] = await call(
      AgentConversationChannel.ListAll,
    );

    expect(listed.map((entry: AgentConversationSummary): string => entry.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('index_isReadFromDiskOnce_byANewStore', async () => {
    await call(AgentConversationChannel.Save, conversation('c1', 2));
    await store.flush();
    electron.handlers.clear();
    new AgentConversationStore().register();

    const listed: readonly AgentConversationSummary[] = await call(
      AgentConversationChannel.ListAll,
    );

    expect(listed.map((entry: AgentConversationSummary): string => entry.id)).toEqual(['c1']);
  });

  it('delete_whileAWriteIsQueued_leavesNoFileBehind', async () => {
    await call(AgentConversationChannel.Save, conversation('c1', 2));

    await call(AgentConversationChannel.Delete, ['c1']);
    await store.flush();

    expect(existsSync(join(electron.userData, 'agent-conversations', 'c1.json'))).toBe(false);
    expect(await call(AgentConversationChannel.ListAll)).toEqual([]);
  });
});
