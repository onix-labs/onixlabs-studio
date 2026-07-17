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

  const OTHER: AgentConversationSummary = {
    id: 'c2',
    contextId: 'global:',
    title: 'Northern lights',
    createdAt: 3,
    updatedAt: 4,
    messageCount: 2,
  };

  it('checkbox_click_togglesWithoutOpeningTheConversation', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    const check: HTMLInputElement = host.querySelector<HTMLInputElement>(
      '.conversations__check input[type="checkbox"]',
    )!;
    check.click();
    fixture.detectChanges();

    expect(opened).toEqual([]);
  });

  it('delete_isAlwaysShownButDisabledUntilARowIsChecked', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    const del: HTMLButtonElement = host.querySelector<HTMLButtonElement>('.conversations__delete')!;
    expect(del).not.toBeNull();
    expect(del.disabled).toBe(true);

    host
      .querySelector<HTMLInputElement>('.conversations__check input[type="checkbox"]')!
      .click();
    fixture.detectChanges();

    expect(del.disabled).toBe(false);
  });

  it('selectAll_togglesBetweenCheckingAndClearingEveryVisibleRow', () => {
    summaries.set([SUMMARY, OTHER]);
    fixture.detectChanges();

    const selectAll: HTMLButtonElement =
      host.querySelector<HTMLButtonElement>('.conversations__select-all')!;
    expect(selectAll.textContent?.trim()).toBe('Select All');

    selectAll.click();
    fixture.detectChanges();

    const checks: () => HTMLInputElement[] = (): HTMLInputElement[] =>
      Array.from(
        host.querySelectorAll<HTMLInputElement>('.conversations__check input[type="checkbox"]'),
      );
    expect(checks().every((check: HTMLInputElement): boolean => check.checked)).toBe(true);
    // With everything checked the toggle offers to clear the selection instead.
    expect(selectAll.textContent?.trim()).toBe('Deselect All');
    expect(host.querySelector<HTMLButtonElement>('.conversations__delete')!.disabled).toBe(false);

    selectAll.click();
    fixture.detectChanges();

    expect(checks().some((check: HTMLInputElement): boolean => check.checked)).toBe(false);
    expect(selectAll.textContent?.trim()).toBe('Select All');
    expect(host.querySelector<HTMLButtonElement>('.conversations__delete')!.disabled).toBe(true);
  });

  it('search_filtersRowsByTitle', () => {
    summaries.set([SUMMARY, OTHER]);
    fixture.detectChanges();

    const search: HTMLInputElement = host.querySelector<HTMLInputElement>('.conversations__search')!;
    search.value = 'northern';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const rows: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('.list-row'));
    expect(rows.length).toBe(1);
    expect(rows[0].textContent?.replace(/\s+/g, ' ')).toContain('Northern lights');
  });
});
