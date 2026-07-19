import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { AgentCategory, AgentCategoryChannel } from '@shared/api/agent-category-channels';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { AgentCategories } from './agent-categories';

/**
 * A recorded bridge invocation.
 */
interface InvokeCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('AgentCategories', () => {
  let calls: InvokeCall[];
  let listResult: readonly AgentCategory[];
  let clearedCategories: string[];

  const WORK: AgentCategory = { id: 'cat1', name: 'Work', sortOrder: 0, createdAt: 10 };

  /**
   * Installs a stub bridge that records invocations and resolves list calls with {@link listResult}.
   */
  function stubBridge(): void {
    calls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        if (channel === (AgentCategoryChannel.List as string)) {
          return Promise.resolve(listResult as T);
        }
        if (channel === (AgentCategoryChannel.Save as string)) {
          return Promise.resolve(args[0] as T);
        }
        return Promise.resolve(undefined as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  /**
   * Builds the service with a stub conversation client that records category clears.
   * @returns Returns the service.
   */
  function build(): AgentCategories {
    const conversationsStub: Partial<AgentConversations> = {
      clearCategory: (id: string): Promise<void> => {
        clearedCategories.push(id);
        return Promise.resolve();
      },
    };
    TestBed.configureTestingModule({
      providers: [AgentCategories, { provide: AgentConversations, useValue: conversationsStub }],
    });
    return TestBed.inject(AgentCategories);
  }

  beforeEach(() => {
    listResult = [];
    clearedCategories = [];
    stubBridge();
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('reload_loadsTheStoredCategories', async () => {
    listResult = [WORK];
    const service: AgentCategories = build();

    await service.reload();

    expect(service.categories()).toEqual([WORK]);
  });

  it('create_savesANamedCategoryAndReturnsIt', async () => {
    const service: AgentCategories = build();

    const created: AgentCategory | null = await service.create('Research', '#4f9d69');

    expect(created).not.toBeNull();
    expect(created?.name).toBe('Research');
    expect(created?.color).toBe('#4f9d69');
    const saveCall: InvokeCall | undefined = calls.find(
      (call: InvokeCall): boolean => call.channel === (AgentCategoryChannel.Save as string),
    );
    expect(saveCall).not.toBeUndefined();
  });

  it('create_whenNameIsBlank_savesNothing', async () => {
    const service: AgentCategories = build();

    const created: AgentCategory | null = await service.create('   ');

    expect(created).toBeNull();
    expect(
      calls.some(
        (call: InvokeCall): boolean => call.channel === (AgentCategoryChannel.Save as string),
      ),
    ).toBe(false);
  });

  it('delete_clearsTheCategoryFromConversationsThenRemovesIt', async () => {
    listResult = [WORK];
    const service: AgentCategories = build();
    await service.reload();

    await service.delete('cat1');

    // Conversations are unfiled before the category record is removed.
    expect(clearedCategories).toEqual(['cat1']);
    const deleteCall: InvokeCall | undefined = calls.find(
      (call: InvokeCall): boolean => call.channel === (AgentCategoryChannel.Delete as string),
    );
    expect(deleteCall?.args).toEqual([['cat1']]);
  });

  it('find_returnsTheMatchingCategoryOrUndefined', async () => {
    listResult = [WORK];
    const service: AgentCategories = build();
    await service.reload();

    expect(service.find('cat1')).toEqual(WORK);
    expect(service.find('missing')).toBeUndefined();
    expect(service.find(null)).toBeUndefined();
  });
});
