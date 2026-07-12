import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentConversationSummary } from '@shared/api/agent-conversation-channels';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentConversationList } from './agent-conversation-list';

describe('AgentConversationList', () => {
  let fixture: ComponentFixture<AgentConversationList>;
  let host: HTMLElement;
  let summaries: WritableSignal<readonly AgentConversationSummary[]>;
  let opened: string[];

  const SUMMARY: AgentConversationSummary = {
    id: 'c1',
    contextId: 'global:',
    title: 'From east to west',
    createdAt: 1,
    updatedAt: 2,
    messageCount: 4,
  };

  beforeEach(async () => {
    opened = [];
    summaries = signal<readonly AgentConversationSummary[]>([]);
    const conversationStub: Partial<AgentConversation> = {
      summaries,
      currentId: signal<string | null>(null),
      open: (id: string): Promise<void> => {
        opened.push(id);
        return Promise.resolve();
      },
      delete: (): Promise<void> => Promise.resolve(),
    };

    await TestBed.configureTestingModule({
      imports: [AgentConversationList],
      providers: [{ provide: AgentConversation, useValue: conversationStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentConversationList);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenEmpty_showsTheEmptyMessage', () => {
    expect(host.querySelector('.list-empty')?.textContent).toContain('No saved');
  });

  it('render_listsEachSummaryAsASharedListViewRow', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    const row: HTMLElement | null = host.querySelector<HTMLElement>('.list-row');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('From east to west');
    expect(row?.textContent).toContain('4 messages');
  });

  it('open_whenRowClicked_rehydratesThatConversation', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    host.querySelector<HTMLElement>('.list-row')!.click();

    expect(opened).toEqual(['c1']);
  });

  it('checkbox_click_togglesWithoutOpeningTheConversation', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    const check: HTMLInputElement = host.querySelector<HTMLInputElement>(
      '.conversations__check input[type="checkbox"]',
    )!;
    check.click();
    fixture.detectChanges();

    expect(opened).toEqual([]);
    // Checking a row reveals the delete action.
    expect(host.querySelector('.conversations__delete')).not.toBeNull();
  });
});
