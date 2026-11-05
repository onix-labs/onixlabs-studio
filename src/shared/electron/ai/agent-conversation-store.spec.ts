import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('load_whenASaveLandsDuringTheRead_answersTheSavedConversation', async () => {
    await call(AgentConversationChannel.Save, conversation('c1', 1));
    await store.flush();

    const loading: Promise<StoredAgentConversation | null> = call(
      AgentConversationChannel.Load,
      'c1',
    );
    await call(AgentConversationChannel.Save, conversation('c1', 7));

    expect((await loading)?.messageCount).toBe(7);
  });

  it('updateMeta_whenASaveIsWrittenDuringItsRead_keepsTheNewerTranscript', async () => {
    // The worst of the races: an old file, read while a new transcript went all the way to disk,
    // must not come back with only the title changed. Conversations are user data.
    await call(AgentConversationChannel.Save, conversation('c1', 1));
    await store.flush();

    const renaming: Promise<unknown> = call(AgentConversationChannel.UpdateMeta, {
      id: 'c1',
      title: 'Renamed',
    });
    await call(AgentConversationChannel.Save, conversation('c1', 7));
    await store.flush();
    await renaming;
    await store.flush();

    const reopened: AgentConversationStore = new AgentConversationStore();
    electron.handlers.clear();
    reopened.register();
    const loaded: StoredAgentConversation | null = await call(AgentConversationChannel.Load, 'c1');
    expect(loaded?.title).toBe('Renamed');
    expect(loaded?.messageCount).toBe(7);
    expect(loaded?.items).toHaveLength(7);
  });

  it('updateMeta_whenTheConversationIsDeletedDuringItsRead_doesNotBringItBack', async () => {
    await call(AgentConversationChannel.Save, conversation('c1', 1));
    await store.flush();

    const renaming: Promise<unknown> = call(AgentConversationChannel.UpdateMeta, {
      id: 'c1',
      title: 'Renamed',
    });
    await call(AgentConversationChannel.Delete, ['c1']);

    expect(await renaming).toBeNull();
    await store.flush();
    expect(await call(AgentConversationChannel.ListAll)).toEqual([]);
    expect(await call(AgentConversationChannel.Load, 'c1')).toBeNull();
  });

  it('save_afterADelete_canStillBeRenamed', async () => {
    await call(AgentConversationChannel.Save, conversation('c1', 1));
    await call(AgentConversationChannel.Delete, ['c1']);
    await call(AgentConversationChannel.Save, conversation('c1', 2));

    expect(
      await call(AgentConversationChannel.UpdateMeta, { id: 'c1', title: 'Again' }),
    ).toMatchObject({ title: 'Again' });
  });

  it('clearCategory_acrossSeveralConversations_clearsEach_andKeepsTheirTranscripts', async () => {
    await call(AgentConversationChannel.Save, { ...conversation('a', 2), categoryId: 'work' });
    await call(AgentConversationChannel.Save, { ...conversation('b', 3), categoryId: 'work' });
    await call(AgentConversationChannel.Save, { ...conversation('c', 1), categoryId: 'home' });
    await store.flush();

    await call(AgentConversationChannel.ClearCategory, 'work');

    const a: StoredAgentConversation | null = await call(AgentConversationChannel.Load, 'a');
    const c: StoredAgentConversation | null = await call(AgentConversationChannel.Load, 'c');
    expect(a?.categoryId).toBeNull();
    expect(a?.items).toHaveLength(2);
    expect(c?.categoryId).toBe('home');
  });

  it('load_withAFileThatIsNotJson_answersNull', async () => {
    await call(AgentConversationChannel.Save, conversation('c1', 1));
    await store.flush();
    writeFileSync(join(electron.userData, 'agent-conversations', 'c1.json'), '{ not json');

    expect(await call(AgentConversationChannel.Load, 'c1')).toBeNull();
  });

  it('load_withNoSuchConversation_answersNull', async () => {
    expect(await call(AgentConversationChannel.Load, 'absent')).toBeNull();
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
