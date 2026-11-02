import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AgentConversationSummary } from '@shared/api/agent-conversation-channels';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Settings } from '@shared/angular/services/settings/settings';
import { ConversationRetentionPrompt } from './conversation-retention-prompt';

/**
 * Builds a conversation summary last updated long ago.
 * @param id The conversation id.
 * @returns Returns the summary.
 */
function old(id: string): AgentConversationSummary {
  return {
    id,
    contextId: 'agent',
    title: `Chat ${id}`,
    messageCount: 2,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('ConversationRetentionPrompt', () => {
  let fixture: ComponentFixture<ConversationRetentionPrompt>;
  let windows: FakeModalWindows;
  let deleted: string[];

  /**
   * Presses a button in the open dialog.
   * @param testId The button's test id.
   */
  async function press(testId: string): Promise<void> {
    windows.contentHost?.querySelector<HTMLElement>(`[data-testid="${testId}"] button`)?.click();
    await fixture.whenStable();
  }

  beforeEach(async (): Promise<void> => {
    localStorage.clear();
    deleted = [];
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [ConversationRetentionPrompt],
      providers: [
        { provide: ModalWindows, useValue: windows },
        {
          provide: AgentConversations,
          useValue: {
            listAll: (): Promise<readonly AgentConversationSummary[]> =>
              Promise.resolve([old('a'), old('b')]),
            delete: (ids: readonly string[]): Promise<void> => {
              deleted.push(...ids);
              return Promise.resolve();
            },
          },
        },
      ],
    }).compileComponents();
    TestBed.inject(Settings).set('ai.deleteConversationsAfterDays', 30);
    fixture = TestBed.createComponent(ConversationRetentionPrompt);
    await fixture.whenStable();
    await fixture.whenStable();
  });

  afterEach((): void => {
    localStorage.clear();
  });

  it('asksAboutTheOldConversations_andYesDeletesThemAll', async (): Promise<void> => {
    expect(windows.contentHost?.textContent).toContain('Delete Old Conversations?');
    expect(windows.contentHost?.textContent).toContain('2 saved conversations');

    await press('retention-yes');

    expect(deleted).toEqual(['a', 'b']);
  });

  it('no_keepsThemAll', async (): Promise<void> => {
    await press('retention-no');

    expect(deleted).toEqual([]);
    expect(windows.openWindows).toBe(0);
  });

  it('review_deletesOnlyTheTickedConversations', async (): Promise<void> => {
    await press('retention-review');
    expect(windows.contentHost?.textContent).toContain('Review Old Conversations');

    windows.contentHost
      ?.querySelector<HTMLInputElement>('[data-testid="retention-item-a"] input')
      ?.click();
    await fixture.whenStable();
    await press('retention-delete-ticked');

    expect(deleted).toEqual(['b']);
  });
});
