import { TestBed } from '@angular/core/testing';

import type { AgentConversationSummary } from '@shared/api/agent-conversation-channels';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Settings } from '@shared/angular/services/settings/settings';
import { ConversationRetention } from './conversation-retention';

/**
 * Holds the milliseconds in a day.
 */
const DAY: number = 24 * 60 * 60 * 1000;

/**
 * Holds "now" for every test.
 */
const NOW: number = Date.UTC(2026, 10, 2);

/**
 * Builds a stored conversation summary last updated some days before {@link NOW}.
 * @param id The conversation id.
 * @param daysAgo How long ago it last had a message.
 * @returns Returns the summary.
 */
function summary(id: string, daysAgo: number): AgentConversationSummary {
  return {
    id,
    contextId: 'agent',
    title: id,
    messageCount: 2,
    createdAt: NOW - daysAgo * DAY,
    updatedAt: NOW - daysAgo * DAY,
  };
}

/**
 * Stands in for the conversation store: a fixed list, recording what it is asked to delete.
 */
class FakeStore {
  public readonly deleted: string[] = [];

  public constructor(private readonly all: readonly AgentConversationSummary[]) {}

  public listAll(): Promise<readonly AgentConversationSummary[]> {
    return Promise.resolve(this.all);
  }

  public delete(ids: readonly string[]): Promise<void> {
    this.deleted.push(...ids);
    return Promise.resolve();
  }
}

describe('ConversationRetention', () => {
  let store: FakeStore;
  let retention: ConversationRetention;
  let notified: string[];

  beforeEach((): void => {
    localStorage.clear();
    notified = [];
    store = new FakeStore([summary('recent', 5), summary('old', 40), summary('oldest', 100)]);
    TestBed.configureTestingModule({
      providers: [
        { provide: AgentConversations, useValue: store },
        {
          provide: Notifications,
          useValue: {
            notify: (request: { title: string }): void => void notified.push(request.title),
          },
        },
      ],
    });
    retention = TestBed.inject(ConversationRetention);
  });

  afterEach((): void => {
    localStorage.clear();
  });

  it('check_whenSetToNever_doesNothing', async (): Promise<void> => {
    await retention.check(NOW);

    expect(retention.due()).toEqual([]);
    expect(store.deleted).toEqual([]);
  });

  it('check_whenAsk_holdsTheDueConversationsOldestFirst', async (): Promise<void> => {
    TestBed.inject(Settings).set('ai.deleteConversationsAfterDays', 30);

    await retention.check(NOW);

    expect(retention.due().map((due: AgentConversationSummary): string => due.id)).toEqual([
      'oldest',
      'old',
    ]);
    expect(store.deleted).toEqual([]);
  });

  it('check_whenAutomatic_deletesTheDueConversationsAndSaysSo', async (): Promise<void> => {
    TestBed.inject(Settings).set('ai.deleteConversationsAfterDays', 90);
    TestBed.inject(Settings).set('ai.deleteConversationsMode', 'automatic');

    await retention.check(NOW);

    expect(store.deleted).toEqual(['oldest']);
    expect(retention.due()).toEqual([]);
    expect(notified).toEqual(['Deleted 1 old conversation']);
  });

  it('check_runsOncePerLaunch', async (): Promise<void> => {
    TestBed.inject(Settings).set('ai.deleteConversationsAfterDays', 30);
    await retention.check(NOW);
    retention.keep();

    await retention.check(NOW);

    expect(retention.due()).toEqual([]);
  });

  it('delete_removesOnlyTheChosenConversations', async (): Promise<void> => {
    TestBed.inject(Settings).set('ai.deleteConversationsAfterDays', 30);
    await retention.check(NOW);

    await retention.delete(['old']);

    expect(store.deleted).toEqual(['old']);
    expect(retention.due()).toEqual([]);
  });
});
