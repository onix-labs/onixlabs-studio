import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentConversationSummary } from '@shared/api/agent-conversation-channels';
import { AgentCategory } from '@shared/api/agent-category-channels';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentCategories } from '@shared/angular/services/agent-categories/agent-categories';
import { AgentConversationList } from './agent-conversation-list';

describe('AgentConversationList', () => {
  let fixture: ComponentFixture<AgentConversationList>;
  let host: HTMLElement;
  let summaries: WritableSignal<readonly AgentConversationSummary[]>;
  let categories: WritableSignal<readonly AgentCategory[]>;
  let opened: string[];

  const SUMMARY: AgentConversationSummary = {
    id: 'c1',
    contextId: 'global:',
    title: 'From east to west',
    createdAt: 1,
    updatedAt: 2,
    messageCount: 4,
  };

  const OTHER: AgentConversationSummary = {
    id: 'c2',
    contextId: 'file:/repo/foo.cs',
    title: 'Northern lights',
    agentType: 'code',
    contextLabel: 'foo.cs',
    createdAt: 3,
    updatedAt: 4,
    messageCount: 2,
  };

  /**
   * Gets the toolbar button whose accessible label contains the given text. The toolbar's buttons are
   * icon-only `app-button`s, which carry their label on aria-label rather than as text.
   * @param label The aria-label text to match.
   * @returns Returns the button.
   */
  function tool(label: string): HTMLButtonElement {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.history__toolbar button')).find(
      (button: HTMLButtonElement): boolean =>
        (button.getAttribute('aria-label') ?? '').includes(label),
    )!;
  }

  /**
   * Gets the checkbox inputs of the conversation leaves (not the node rows).
   * @returns Returns the inputs.
   */
  function itemChecks(): HTMLInputElement[] {
    return Array.from(
      host.querySelectorAll<HTMLInputElement>(
        '.history__leaf .history__check input[type="checkbox"]',
      ),
    );
  }

  beforeEach(async () => {
    opened = [];
    summaries = signal<readonly AgentConversationSummary[]>([]);
    categories = signal<readonly AgentCategory[]>([]);
    const conversationStub: Partial<AgentConversation> = {
      summaries,
      currentId: signal<string | null>(null),
      open: (id: string): Promise<void> => {
        opened.push(id);
        return Promise.resolve();
      },
      refresh: (): Promise<void> => Promise.resolve(),
      rename: (): Promise<void> => Promise.resolve(),
      setCategory: (): Promise<void> => Promise.resolve(),
      duplicate: (): Promise<void> => Promise.resolve(),
      delete: (): Promise<void> => Promise.resolve(),
    };
    const categoriesStub: Partial<AgentCategories> = {
      categories,
      create: (): Promise<AgentCategory | null> => Promise.resolve(null),
      update: (): Promise<void> => Promise.resolve(),
      delete: (): Promise<void> => Promise.resolve(),
      reload: (): Promise<void> => Promise.resolve(),
    };

    await TestBed.configureTestingModule({
      imports: [AgentConversationList],
      providers: [
        { provide: AgentConversation, useValue: conversationStub },
        { provide: AgentCategories, useValue: categoriesStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentConversationList);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenEmpty_showsTheEmptyMessageUnderAllConversations', () => {
    expect(host.querySelector('.history__empty')?.textContent).toContain('No conversations yet');
    expect(host.querySelector('.history__node-name')?.textContent).toContain('All Conversations');
  });

  it('render_listsEachConversationWithItsAgentTypeChip', () => {
    summaries.set([OTHER]);
    fixture.detectChanges();

    const leaf: HTMLElement | null = host.querySelector<HTMLElement>('.history__leaf');
    expect(leaf).not.toBeNull();
    expect(leaf?.textContent).toContain('Northern lights');
    // The recorded agent type and the context label both render as chips.
    const chips: string[] = Array.from(leaf!.querySelectorAll<HTMLElement>('.history__chip')).map(
      (chip: HTMLElement): string => chip.textContent?.trim() ?? '',
    );
    expect(chips).toContain('Code');
    expect(chips).toContain('foo.cs');
  });

  it('render_whenAgentTypeIsAbsent_derivesTheChipFromTheContext', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    // A global conversation with no recorded type falls back to the Agent chip.
    const chips: string[] = Array.from(host.querySelectorAll<HTMLElement>('.history__chip')).map(
      (chip: HTMLElement): string => chip.textContent?.trim() ?? '',
    );
    expect(chips).toContain('Agent');
  });

  it('open_whenAConversationLeafIsClicked_rehydratesIt', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    host.querySelector<HTMLElement>('.history__leaf-main')!.click();

    expect(opened).toEqual(['c1']);
  });

  it('checkbox_click_togglesWithoutOpeningTheConversation', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    itemChecks()[0].click();
    fixture.detectChanges();

    expect(opened).toEqual([]);
    expect(tool('Delete').disabled).toBe(false);
  });

  it('delete_isDisabledUntilAConversationIsChecked', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    expect(tool('Delete').disabled).toBe(true);

    itemChecks()[0].click();
    fixture.detectChanges();

    expect(tool('Delete').disabled).toBe(false);
  });

  it('selectAll_togglesEveryVisibleConversation', () => {
    summaries.set([SUMMARY, OTHER]);
    fixture.detectChanges();

    tool('Select all').click();
    fixture.detectChanges();

    expect(itemChecks().every((check: HTMLInputElement): boolean => check.checked)).toBe(true);
    expect(tool('Deselect all')).not.toBeUndefined();

    tool('Deselect all').click();
    fixture.detectChanges();

    expect(itemChecks().some((check: HTMLInputElement): boolean => check.checked)).toBe(false);
  });

  it('search_filtersConversationsByTitle', () => {
    summaries.set([SUMMARY, OTHER]);
    fixture.detectChanges();

    const search: HTMLInputElement = host.querySelector<HTMLInputElement>('.history__search')!;
    search.value = 'northern';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const leaves: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('.history__leaf'));
    expect(leaves.length).toBe(1);
    expect(leaves[0].textContent?.replace(/\s+/g, ' ')).toContain('Northern lights');
  });

  it('categories_renderAsNodesCountingTheirFiledConversations', () => {
    categories.set([{ id: 'cat1', name: 'Work', sortOrder: 0, createdAt: 0 }]);
    summaries.set([SUMMARY, { ...OTHER, categoryId: 'cat1' }]);
    fixture.detectChanges();

    const names: string[] = Array.from(
      host.querySelectorAll<HTMLElement>('.history__node-name'),
    ).map((element: HTMLElement): string => element.textContent?.trim() ?? '');
    expect(names).toContain('Work');

    // The Work node reports one filed conversation; All Conversations reports both.
    const counts: string[] = Array.from(host.querySelectorAll<HTMLElement>('.history__count')).map(
      (element: HTMLElement): string => element.textContent?.trim() ?? '',
    );
    expect(counts).toContain('2');
    expect(counts).toContain('1');
  });

  it('manageCategories_opensTheModalWithEachCategoryAndItsActions', () => {
    categories.set([{ id: 'cat1', name: 'Work', sortOrder: 0, createdAt: 0 }]);
    fixture.detectChanges();

    tool('Manage categories').click();
    fixture.detectChanges();

    const rows: HTMLElement[] = Array.from(
      host.querySelectorAll<HTMLElement>('.history__manage-row'),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Work');
    expect(host.querySelector('.history__modal-title')?.textContent).toContain('Manage categories');
  });

  it('newCategory_opensTheEditorModalWithAnEmptyName', () => {
    tool('New category').click();
    fixture.detectChanges();

    expect(host.querySelector('.history__modal-title')?.textContent).toContain('New category');
    expect(host.querySelector<HTMLInputElement>('.history__modal-input')!.value).toBe('');
  });

  it('delete_whenConfirmed_promptsWithTheCheckedCount', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();
    itemChecks()[0].click();
    fixture.detectChanges();

    tool('Delete').click();
    fixture.detectChanges();

    expect(host.querySelector('.history__modal-title')?.textContent).toContain(
      'Delete conversations?',
    );
    expect(host.querySelector('.history__modal-body')?.textContent).toContain('1 conversation');
  });

  it('modal_whenClosed_doesNotRenderItsContent', () => {
    expect(host.querySelector('.history__modal-title')).toBeNull();
  });
});
