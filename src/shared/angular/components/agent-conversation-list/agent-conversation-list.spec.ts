import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AgentConversationSummary } from '@shared/api/agent-conversation-channels';
import { AgentCategory } from '@shared/api/agent-category-channels';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentCategories } from '@shared/angular/services/agent-categories/agent-categories';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Settings } from '@shared/angular/services/settings/settings';
import { AgentConversationList } from './agent-conversation-list';

describe('AgentConversationList', () => {
  let fixture: ComponentFixture<AgentConversationList>;
  let host: HTMLElement;
  let summaries: WritableSignal<readonly AgentConversationSummary[]>;
  let categories: WritableSignal<readonly AgentCategory[]>;
  let opened: string[];
  let deleted: string[];
  let renamed: { id: string; title: string }[];
  let filed: [string, string | null][];
  let duplicated: string[];
  let createdNames: string[];
  let categoryCreator: () => Promise<AgentCategory | null>;
  let categoryUpdates: { id: string; name: string | undefined }[];
  let deletedCategories: string[];
  let windows: FakeModalWindows;

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

  const WORK: AgentCategory = { id: 'cat1', name: 'Work', sortOrder: 0, createdAt: 0 };

  const CREATED: AgentCategory = { id: 'new-cat', name: 'Fresh', sortOrder: 1, createdAt: 0 };

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
    localStorage.clear();
    deleted = [];
    opened = [];
    renamed = [];
    filed = [];
    duplicated = [];
    createdNames = [];
    categoryCreator = (): Promise<AgentCategory | null> => Promise.resolve(CREATED);
    categoryUpdates = [];
    deletedCategories = [];
    windows = new FakeModalWindows();
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
      rename: (id: string, title: string): Promise<void> => {
        renamed.push({ id, title });
        return Promise.resolve();
      },
      setCategory: (id: string, categoryId: string | null): Promise<void> => {
        filed.push([id, categoryId]);
        return Promise.resolve();
      },
      duplicate: (id: string): Promise<void> => {
        duplicated.push(id);
        return Promise.resolve();
      },
      delete: (ids: readonly string[]): Promise<void> => {
        deleted.push(...ids);
        return Promise.resolve();
      },
    };
    const categoriesStub: Partial<AgentCategories> = {
      categories,
      create: (name: string): Promise<AgentCategory | null> => {
        createdNames.push(name);
        return categoryCreator();
      },
      update: (id: string, patch: { name?: string }): Promise<void> => {
        categoryUpdates.push({ id, name: patch.name });
        return Promise.resolve();
      },
      delete: (id: string): Promise<void> => {
        deletedCategories.push(id);
        return Promise.resolve();
      },
      reload: (): Promise<void> => Promise.resolve(),
    };

    await TestBed.configureTestingModule({
      imports: [AgentConversationList],
      providers: [
        { provide: AgentConversation, useValue: conversationStub },
        { provide: AgentCategories, useValue: categoriesStub },
        { provide: ModalWindows, useValue: windows },
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
    const chips: string[] = Array.from(
      leaf!.querySelectorAll<HTMLElement>('.history__chips app-chip'),
    ).map((chip: HTMLElement): string => chip.textContent?.trim() ?? '');
    expect(chips).toContain('Code');
    expect(chips).toContain('foo.cs');
  });

  it('render_whenAgentTypeIsAbsent_derivesTheChipFromTheContext', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    // A global conversation with no recorded type falls back to the Agent chip.
    const chips: string[] = Array.from(
      host.querySelectorAll<HTMLElement>('.history__chips app-chip'),
    ).map((chip: HTMLElement): string => chip.textContent?.trim() ?? '');
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

    const search: HTMLInputElement =
      host.querySelector<HTMLInputElement>('.history__search input')!;
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
    TestBed.inject(ApplicationRef).tick();

    expect(windows.openWindows).toBe(1);
    const content: HTMLElement = windows.contentHost!;
    const rows: HTMLElement[] = Array.from(
      content.querySelectorAll<HTMLElement>('.history__manage-row'),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Work');
    expect(content.querySelector('.history__modal-title')?.textContent).toContain(
      'Manage categories',
    );
  });

  it('newCategory_opensTheEditorModalWithAnEmptyName', () => {
    tool('New category').click();
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();

    expect(windows.openWindows).toBe(1);
    const content: HTMLElement = windows.contentHost!;
    expect(content.querySelector('.history__modal-title')?.textContent).toContain('New category');
    expect(content.querySelector<HTMLInputElement>('.history__modal-input input')!.value).toBe('');
  });

  it('delete_whenConfirmationIsTurnedOff_deletesWithoutAsking', async () => {
    TestBed.inject(Settings).set('ai.confirmDeleteConversations', false);
    summaries.set([SUMMARY]);
    fixture.detectChanges();
    itemChecks()[0].click();
    fixture.detectChanges();

    tool('Delete').click();
    await fixture.whenStable();

    expect(windows.openWindows).toBe(0);
    expect(deleted).toEqual([SUMMARY.id]);
  });

  it('delete_whenConfirmed_promptsWithTheCheckedCount', () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();
    itemChecks()[0].click();
    fixture.detectChanges();

    tool('Delete').click();
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();

    expect(windows.openWindows).toBe(1);
    const content: HTMLElement = windows.contentHost!;
    expect(content.querySelector('.history__modal-title')?.textContent).toContain(
      'Delete conversations?',
    );
    expect(content.querySelector('.history__modal-body')?.textContent).toContain('1 conversation');
  });

  /**
   * Chooses Rename from a conversation row's overflow menu, as opening the menu on that row and
   * picking the item would, and settles the render.
   * @param summary The conversation.
   * @param rowId The id of the row the menu was opened on.
   * @returns Returns a promise that resolves once the row's field has rendered.
   */
  async function rename(summary: AgentConversationSummary, rowId: string): Promise<void> {
    const list: { onOpenMenu(s: AgentConversationSummary, r: string): void; onRename(): void } =
      fixture.componentInstance as unknown as {
        onOpenMenu(s: AgentConversationSummary, r: string): void;
        onRename(): void;
      };
    list.onOpenMenu(summary, rowId);
    list.onRename();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Gets the in-place rename field's input, if a row is being renamed.
   * @returns Returns the input, or null.
   */
  function renameField(): HTMLInputElement | null {
    return host.querySelector<HTMLInputElement>('app-row-edit-field input');
  }

  it('rename_turnsTheConversationsRowIntoAFieldSeededWithItsTitle', async () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();

    await rename(SUMMARY, 'c1');

    expect(renameField()?.value).toBe('From east to west');
    // The title, chips and actions give way to the field; nothing asks in a window.
    expect(host.querySelector('.history__leaf')).toBeNull();
    expect(windows.openCount).toBe(0);
  });

  it('rename_ofAFiledConversation_editsOnlyTheRowItWasChosenOn', async () => {
    // Filed under a category, a conversation has two rows; only the one the menu opened on edits.
    categories.set([{ id: 'k1', name: 'Keep', sortOrder: 0, createdAt: 0 }]);
    summaries.set([{ ...SUMMARY, categoryId: 'k1' }]);
    fixture.detectChanges();
    host.querySelectorAll<HTMLElement>('.tree-row')[2]?.click();
    fixture.detectChanges();

    await rename({ ...SUMMARY, categoryId: 'k1' }, 'k1:c1');

    expect(host.querySelectorAll('app-row-edit-field').length).toBe(1);
    expect(host.querySelector('[data-tree-id="k1:c1"] app-row-edit-field')).not.toBeNull();
  });

  it('rename_whenCommitted_retitlesTheConversation', async () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();
    await rename(SUMMARY, 'c1');

    const input: HTMLInputElement = renameField()!;
    input.value = 'From west to east';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(renamed).toEqual([{ id: 'c1', title: 'From west to east' }]);
    expect(renameField()).toBeNull();
  });

  it('rename_whenCancelled_leavesTheTitleAlone', async () => {
    summaries.set([SUMMARY]);
    fixture.detectChanges();
    await rename(SUMMARY, 'c1');

    renameField()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(renamed).toEqual([]);
    expect(renameField()).toBeNull();
    expect(host.querySelector('.history__leaf')?.textContent).toContain('From east to west');
  });

  /**
   * Renders every pending change, in the list and in its modal windows.
   * @returns Returns a promise that resolves once the render has settled.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
  }

  /**
   * Gets the titles of the conversations on show.
   * @returns Returns the titles, in order.
   */
  function titles(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.history__leaf-title')).map(
      (title: HTMLElement): string => title.textContent?.trim() ?? '',
    );
  }

  /**
   * Finds an entry of whichever menu is open.
   * @param label The entry's text.
   * @returns Returns the entry.
   */
  function menuEntry(label: string): HTMLButtonElement {
    const entry: HTMLButtonElement | undefined = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.app-menu-panel__item'),
    ).find((item: HTMLButtonElement): boolean => item.textContent?.trim() === label);
    if (entry === undefined) {
      throw new Error(`No menu entry "${label}"`);
    }
    return entry;
  }

  /**
   * Opens a conversation row's overflow menu.
   * @param index The row's place among the rows on show.
   * @returns Returns a promise that resolves once the menu is open.
   */
  async function openRowMenu(index: number): Promise<void> {
    host.querySelectorAll<HTMLElement>('.history__overflow')[index].click();
    await settle();
  }

  /**
   * Chooses an entry of whichever menu is open.
   * @param label The entry's text.
   * @returns Returns a promise that resolves once the choice has landed.
   */
  async function choose(label: string): Promise<void> {
    menuEntry(label).click();
    await settle();
  }

  /**
   * Clicks a button in the most recently opened modal window.
   * @param label The button's text or accessible label.
   * @returns Returns a promise that resolves once the click has landed.
   */
  async function clickInWindow(label: string): Promise<void> {
    const found: HTMLButtonElement | undefined = Array.from(
      windows.contentHost?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    ).find(
      (button: HTMLButtonElement): boolean =>
        button.textContent?.trim() === label || button.getAttribute('aria-label') === label,
    );
    if (found === undefined) {
      throw new Error(`No button "${label}" in the window`);
    }
    found.click();
    await settle();
  }

  /**
   * Types a category name into the open editor.
   * @param name The name.
   * @returns Returns a promise that resolves once the field has taken it.
   */
  async function typeCategoryName(name: string): Promise<void> {
    const input: HTMLInputElement | null | undefined =
      windows.contentHost?.querySelector<HTMLInputElement>('.history__modal-input input');
    if (input === null || input === undefined) {
      throw new Error('The category editor is not open');
    }
    input.value = name;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  /**
   * Raises a drag event, as the browser would, with a transfer the handlers can write to.
   * @param target The element under the pointer.
   * @param type The event type.
   * @returns Returns the raised event.
   */
  function drag(target: Element, type: string): Event {
    const event: Event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { setData: (): void => undefined, getData: (): string => '' },
    });
    target.dispatchEvent(event);
    return event;
  }

  /**
   * Gets the drop target of a category's row.
   * @param index The node's place in the tree.
   * @returns Returns the node row.
   */
  function nodeRow(index: number): HTMLElement {
    return host.querySelectorAll<HTMLElement>('.history__node-row')[index];
  }

  describe('filters', () => {
    beforeEach(async () => {
      summaries.set([SUMMARY, { ...OTHER, categoryId: 'cat1' }]);
      await settle();
      host.querySelector<HTMLElement>('.history__tool')?.click();
      await settle();
    });

    it('filter_byAgentType_hidesThatTypeAndMarksTheTrigger', async () => {
      await choose('Code');

      expect(titles()).toEqual(['From east to west']);
      expect(host.querySelector('.history__tool--active')).not.toBeNull();

      await choose('Code');

      expect(titles()).toEqual(['From east to west', 'Northern lights']);
      expect(host.querySelector('.history__tool--active')).toBeNull();
    });

    it('filter_uncategorizedOnly_hidesEverythingFiled', async () => {
      await choose('Uncategorized only');

      expect(titles()).toEqual(['From east to west']);
    });

    it('filter_reset_bringsEverythingBack', async () => {
      await choose('Code');
      await choose('Uncategorized only');

      await choose('Reset filters');

      expect(titles()).toEqual(['From east to west', 'Northern lights']);
      expect(host.querySelector('.history__tool--active')).toBeNull();
    });
  });

  describe('checking', () => {
    /**
     * Gets a node row's checkbox.
     * @param index The node's place in the tree.
     * @returns Returns the checkbox.
     */
    function nodeCheck(index: number): HTMLInputElement {
      const check: HTMLInputElement | null =
        nodeRow(index).querySelector<HTMLInputElement>('.history__check input');
      if (check === null) {
        throw new Error('The node has no checkbox');
      }
      return check;
    }

    it('nodeCheckbox_checksOnlyThatCategorysConversations_andUnchecksThem', async () => {
      categories.set([WORK]);
      summaries.set([SUMMARY, { ...OTHER, categoryId: 'cat1' }]);
      await settle();

      nodeCheck(1).click();
      await settle();

      expect(tool('Delete 1 conversation(s)')).toBeDefined();
      expect(nodeCheck(1).checked).toBe(true);
      expect(nodeCheck(0).checked).toBe(false);

      nodeCheck(1).click();
      await settle();

      expect(tool('Delete').disabled).toBe(true);
    });

    it('checkbox_clickedTwice_leavesNothingToDelete', async () => {
      summaries.set([SUMMARY]);
      await settle();

      itemChecks()[0].click();
      await settle();
      itemChecks()[0].click();
      await settle();

      expect(tool('Delete').disabled).toBe(true);
    });

    it('checked_whenTheConversationGoesAway_stopsCounting', async () => {
      summaries.set([SUMMARY, OTHER]);
      await settle();
      itemChecks()[0].click();
      await settle();

      summaries.set([OTHER]);
      await settle();

      expect(tool('Delete').disabled).toBe(true);
    });
  });

  describe('expansion', () => {
    /**
     * Builds the list afresh, as reopening the view would.
     * @returns Returns a promise that resolves once it has rendered.
     */
    async function reopen(): Promise<void> {
      fixture.destroy();
      fixture = TestBed.createComponent(AgentConversationList);
      host = fixture.nativeElement as HTMLElement;
      await settle();
    }

    it('collapse_survivesReopeningTheList', async () => {
      summaries.set([SUMMARY]);
      await settle();
      expect(titles()).toEqual(['From east to west']);

      nodeRow(0).click();
      await settle();
      expect(titles()).toEqual([]);

      await reopen();

      expect(titles()).toEqual([]);
    });

    it('expansion_whenTheStoredStateIsCorrupt_fallsBackToTheDefault', async () => {
      summaries.set([SUMMARY]);
      await settle();
      nodeRow(0).click();
      await settle();
      localStorage.setItem('agent-history:expanded', '{not json');

      await reopen();

      expect(titles()).toEqual(['From east to west']);
    });

    it('expansion_whenTheStoredStateIsNotAnObject_fallsBackToTheDefault', async () => {
      summaries.set([SUMMARY]);
      await settle();
      nodeRow(0).click();
      await settle();
      localStorage.setItem('agent-history:expanded', 'null');

      await reopen();

      expect(titles()).toEqual(['From east to west']);
    });

    it('collapse_whenStorageRefuses_stillCollapses', async () => {
      summaries.set([SUMMARY]);
      await settle();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation((): void => {
        throw new Error('quota exceeded');
      });

      nodeRow(0).click();
      await settle();
      vi.restoreAllMocks();

      expect(titles()).toEqual([]);
    });
  });

  describe('row menu', () => {
    beforeEach(async () => {
      categories.set([WORK]);
      summaries.set([SUMMARY]);
      await settle();
      await openRowMenu(0);
    });

    it('removeFromCategory_ofAnUnfiledConversation_isUnavailable', async () => {
      await choose('Remove from category');

      expect(filed).toEqual([]);
    });

    it('moveToCategory_filesTheConversation', async () => {
      await choose('Move to category');

      await choose('Work');

      expect(filed).toEqual([['c1', 'cat1']]);
    });

    it('duplicate_copiesTheConversation', async () => {
      await choose('Duplicate');

      expect(duplicated).toEqual(['c1']);
    });

    it('delete_asksFirst_andCancellingKeepsTheConversation', async () => {
      await choose('Delete');
      expect(windows.contentHost?.textContent).toContain('1 conversation will be');

      await clickInWindow('Cancel');

      expect(deleted).toEqual([]);
      expect(windows.openWindows).toBe(0);
    });

    it('delete_whenConfirmed_deletesThatConversation_andClearsTheChecks', async () => {
      await choose('Delete');

      await clickInWindow('Delete');

      expect(deleted).toEqual(['c1']);
      expect(tool('Delete').disabled).toBe(true);
    });
  });

  it('removeFromCategory_ofAFiledConversation_clearsItsCategory', async () => {
    summaries.set([{ ...SUMMARY, categoryId: 'cat1' }]);
    await settle();
    await openRowMenu(0);

    await choose('Remove from category');

    expect(filed).toEqual([['c1', null]]);
  });

  describe('dragging', () => {
    beforeEach(async () => {
      categories.set([WORK]);
      summaries.set([SUMMARY]);
      await settle();
    });

    /**
     * Picks a conversation up.
     * @returns Returns a promise that resolves once the drag has begun.
     */
    async function pickUp(): Promise<void> {
      drag(host.querySelector('.history__leaf') ?? host, 'dragstart');
      await settle();
    }

    it('drop_onACategory_filesTheConversation', async () => {
      await pickUp();

      const over: Event = drag(nodeRow(1), 'dragover');
      await settle();
      expect(over.defaultPrevented).toBe(true);
      expect(nodeRow(1).classList).toContain('history__node-row--drop');

      drag(nodeRow(1), 'drop');
      await settle();

      expect(filed).toEqual([['c1', 'cat1']]);
      expect(nodeRow(1).classList).not.toContain('history__node-row--drop');
    });

    it('dragOver_ofAllConversations_refusesTheDrop', async () => {
      await pickUp();

      const over: Event = drag(nodeRow(0), 'dragover');

      expect(over.defaultPrevented).toBe(false);
    });

    it('dragOver_ofSomethingFromOutsideTheList_refusesTheDrop', () => {
      const over: Event = drag(nodeRow(1), 'dragover');

      expect(over.defaultPrevented).toBe(false);
    });

    it('dragLeave_clearsTheHighlight', async () => {
      await pickUp();
      drag(nodeRow(1), 'dragover');
      await settle();

      drag(nodeRow(1), 'dragleave');
      await settle();

      expect(nodeRow(1).classList).not.toContain('history__node-row--drop');
    });

    it('dragEnd_withoutADrop_filesNothingAndLeavesNoHighlight', async () => {
      await pickUp();
      drag(nodeRow(1), 'dragover');
      await settle();

      drag(host.querySelector('.history__leaf') ?? host, 'dragend');
      await settle();

      expect(filed).toEqual([]);
      expect(nodeRow(1).classList).not.toContain('history__node-row--drop');
      expect(drag(nodeRow(1), 'dragover').defaultPrevented).toBe(false);
    });
  });

  describe('categories', () => {
    it('newCategory_savesWhatWasTyped_andClosesTheEditor', async () => {
      tool('New category').click();
      await settle();

      await typeCategoryName('Fresh');
      await clickInWindow('Save');

      expect(createdNames).toEqual(['Fresh']);
      expect(windows.openWindows).toBe(0);
    });

    it('newCategory_withABlankName_cannotBeSaved', async () => {
      tool('New category').click();
      await settle();

      await typeCategoryName('   ');
      await clickInWindow('Save');

      expect(createdNames).toEqual([]);
      expect(windows.openWindows).toBe(1);
    });

    it('newCategory_fromTheMoveMenu_filesTheConversationUnderIt', async () => {
      summaries.set([SUMMARY]);
      await settle();
      await openRowMenu(0);
      await choose('Move to category');
      await choose('New category…');

      await typeCategoryName('Fresh');
      await clickInWindow('Save');
      await settle();

      expect(filed).toEqual([['c1', 'new-cat']]);
    });

    it('newCategory_whenItCouldNotBeSaved_filesNothing', async () => {
      categoryCreator = (): Promise<AgentCategory | null> => Promise.resolve(null);
      summaries.set([SUMMARY]);
      await settle();
      await openRowMenu(0);
      await choose('Move to category');
      await choose('New category…');

      await typeCategoryName('Fresh');
      await clickInWindow('Save');
      await settle();

      expect(createdNames).toEqual(['Fresh']);
      expect(filed).toEqual([]);
    });

    it('newCategory_whenCancelled_doesNotFileUnderTheNextOne', async () => {
      summaries.set([SUMMARY]);
      await settle();
      await openRowMenu(0);
      await choose('Move to category');
      await choose('New category…');
      await clickInWindow('Cancel');

      tool('New category').click();
      await settle();
      await typeCategoryName('Fresh');
      await clickInWindow('Save');
      await settle();

      expect(createdNames).toEqual(['Fresh']);
      expect(filed).toEqual([]);
    });

    it('newCategory_filesTheConversationItWasAskedFor_whenAnotherEditorOpensMeanwhile', async () => {
      let finishCreating: (category: AgentCategory) => void = (): void => undefined;
      categoryCreator = (): Promise<AgentCategory | null> =>
        new Promise<AgentCategory | null>((resolve: (value: AgentCategory) => void): void => {
          finishCreating = resolve;
        });
      summaries.set([SUMMARY, OTHER]);
      await settle();
      await openRowMenu(0);
      await choose('Move to category');
      await choose('New category…');
      await typeCategoryName('Fresh');
      await clickInWindow('Save');

      await openRowMenu(1);
      await choose('Move to category');
      await choose('New category…');
      finishCreating(CREATED);
      await settle();

      expect(filed).toEqual([['c1', 'new-cat']]);
    });

    it('renameCategory_savesTheNewName', async () => {
      categories.set([WORK]);
      await settle();
      tool('Manage categories').click();
      await settle();

      await clickInWindow('Rename category');
      expect(
        windows.contentHost?.querySelector<HTMLInputElement>('.history__modal-input input')?.value,
      ).toBe('Work');
      await typeCategoryName('Play');
      await clickInWindow('Save');

      expect(categoryUpdates).toEqual([{ id: 'cat1', name: 'Play' }]);
      expect(createdNames).toEqual([]);
    });

    it('deleteCategory_deletesIt', async () => {
      categories.set([WORK]);
      await settle();
      tool('Manage categories').click();
      await settle();

      await clickInWindow('Delete category');

      expect(deletedCategories).toEqual(['cat1']);
    });

    it('manageCategories_closesOnDone', async () => {
      tool('Manage categories').click();
      await settle();

      await clickInWindow('Done');

      expect(windows.openWindows).toBe(0);
    });
  });

  it('modal_whenClosed_doesNotRenderItsContent', () => {
    expect(windows.openWindows).toBe(0);
  });
});
