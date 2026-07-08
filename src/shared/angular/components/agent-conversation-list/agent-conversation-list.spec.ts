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
    expect(host.querySelector('.conversations__empty')?.textContent).toContain('No saved');
  });

  it('open_whenRowClicked_rehydratesThatConversation', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('.conversations__open')!.click();

    expect(opened).toEqual(['c1']);
  });
});
