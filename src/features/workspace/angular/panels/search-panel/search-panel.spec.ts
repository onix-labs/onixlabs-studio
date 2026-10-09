import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkspaceSearchAdapter } from '@features/workspace/angular/find/workspace-search-adapter';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import { Documents } from '@shared/angular/services/documents/documents';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import {
  ReplaceRequest,
  ReplaceResponse,
  SearchRequest,
  SearchResponse,
} from '@shared/api/search-channels';

import { SearchPanel } from './search-panel';

/**
 * A search client that records each request and resolves canned results: one match until told
 * otherwise, and whatever a replace leaves behind after one.
 */
class FakeSearch {
  /**
   * Holds the requests the panel's adapter has run.
   */
  public readonly requests: SearchRequest[] = [];

  /**
   * Holds the replace requests the panel's adapter has made.
   */
  public readonly replaces: ReplaceRequest[] = [];

  /**
   * Holds what a search finds.
   */
  public results: SearchResponse = {
    files: [
      {
        path: '/ws/src/main.ts',
        relativePath: 'src/main.ts',
        matches: [{ line: 3, column: 7, before: 'const ', text: 'todo', after: ' = 1;' }],
      },
    ],
    total: 1,
    capped: false,
  };

  /**
   * Holds what a search finds once a replace has run.
   */
  public afterReplace: SearchResponse = { files: [], total: 0, capped: false };

  /**
   * Holds what a replace reports.
   */
  public outcome: ReplaceResponse = { replaced: 1, files: 1, failed: [] };

  /**
   * Records the request and resolves the canned response.
   * @param request The search request.
   * @returns Returns the canned response.
   */
  public run(request: SearchRequest): Promise<SearchResponse> {
    this.requests.push(request);
    return Promise.resolve(this.results);
  }

  /**
   * Records the replace, and has the next search find what it left.
   * @param request The replace request.
   * @returns Returns the canned outcome.
   */
  public replace(request: ReplaceRequest): Promise<ReplaceResponse> {
    this.replaces.push(request);
    this.results = this.afterReplace;
    return Promise.resolve(this.outcome);
  }
}

/**
 * Reads the panel's protected adapter, so tests can drive it as the find panel would.
 * @param component The panel under test.
 * @returns Returns the panel's adapter.
 */
function adapterOf(component: SearchPanel): WorkspaceSearchAdapter {
  return (component as unknown as { adapter: WorkspaceSearchAdapter }).adapter;
}

describe('SearchPanel', () => {
  let component: SearchPanel;
  let fixture: ComponentFixture<SearchPanel>;
  let search: FakeSearch;
  let rootPath: WritableSignal<string | null>;
  let unsaved: { filePath: () => string; dirty: () => boolean }[];
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    search = new FakeSearch();
    rootPath = signal<string | null>('/ws');
    unsaved = [];
    notify = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SearchPanel],
      providers: [
        { provide: Search, useValue: search },
        { provide: FileOpener, useValue: { openPath: (): Promise<void> => Promise.resolve() } },
        {
          provide: Editors,
          useValue: {
            modelUriForPath: (): string => 'file:///ws',
            locate: (): { documentId: string } => ({ documentId: 'doc' }),
            requestReveal: (): void => undefined,
          },
        },
        { provide: Documents, useValue: { list: (): typeof unsaved => unsaved } },
        { provide: Notifications, useValue: { notify } },
        { provide: ActiveWorkspace, useValue: { rootPath } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Reads one of the panel's protected members.
   * @param name The member.
   * @returns Returns its value.
   */
  function member<T>(name: string): T {
    return (component as unknown as Record<string, T>)[name];
  }

  /**
   * Types into the field, as the user does, without asking for a search.
   * @param text The text.
   */
  function type(text: string): void {
    member<WritableSignal<string>>('draft').set(text);
  }

  /**
   * Gets the strip's toggles.
   * @returns Returns the toggle buttons, in order.
   */
  function toggles(): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.search-panel__strip .panel-toolbar__button',
      ),
    );
  }

  /**
   * Chooses a form from the strip, as the user does.
   * @param index The toggle: 0 for Find in Files, 1 for Replace in Files.
   */
  function choose(index: number): void {
    toggles()[index].click();
    fixture.detectChanges();
  }

  it('render_theStripIsTwoToggles_withFindInFilesChosen', () => {
    // #882: the strip chooses the form; it is not the search itself, nor the dock's placeholder set.
    expect(toggles().map((toggle: HTMLButtonElement): string => toggle.textContent.trim())).toEqual(
      ['Find in Files', 'Replace in Files'],
    );
    expect(toggles()[0].classList.contains('panel-toolbar__button--active')).toBe(true);
    expect(toggles()[1].classList.contains('panel-toolbar__button--active')).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-find-panel')).toBeNull();
  });

  it('theFindForm_hasAFieldTheMatchOptionsAndFind_andNoReplace', () => {
    const form: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.search-panel__form',
    );

    expect(form?.querySelectorAll('app-text-field').length).toBe(1);
    expect(form?.textContent).toContain('Match Case');
    expect(form?.textContent).toContain('Match Whole Word');
    expect(form?.textContent).toContain('Match Regex');
    expect(form?.textContent).not.toContain('Replace All');
  });

  it('theReplaceForm_addsAReplaceField_andReplaceButtons_disabledUntilThereIsSomethingToReplace', () => {
    choose(1);
    const form: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.search-panel__form',
    );

    expect(toggles()[1].classList.contains('panel-toolbar__button--active')).toBe(true);
    expect(form?.querySelectorAll('app-text-field').length).toBe(2);
    const replaceAll: HTMLButtonElement | undefined = Array.from(
      form?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    ).find((button: HTMLButtonElement): boolean => button.textContent.trim() === 'Replace All');
    expect(replaceAll?.disabled).toBe(true);
    expect(formButton('Replace')?.disabled).toBe(true);
  });

  /**
   * Finds one of the form's buttons by its label.
   * @param label The label.
   * @returns Returns the button, or undefined.
   */
  function formButton(label: string): HTMLButtonElement | undefined {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.search-panel__actions button',
      ),
    ).find((button: HTMLButtonElement): boolean => button.textContent.trim() === label);
  }

  /**
   * Finds "todo", chooses the replace form and sets the replacement to "done".
   */
  async function readyToReplace(): Promise<void> {
    await findTodo();
    choose(1);
    member<WritableSignal<string>>('replacement').set('done');
    fixture.detectChanges();
  }

  it('replaceAll_replacesInEveryFileListed_thenSearchesAgain_andSaysWhatItDid', async () => {
    await readyToReplace();

    expect(formButton('Replace All')?.disabled).toBe(false);
    formButton('Replace All')?.click();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(search.replaces).toEqual([
      {
        query: 'todo',
        root: '/ws',
        caseSensitive: false,
        wholeWord: false,
        regexp: false,
        replacement: 'done',
        files: ['/ws/src/main.ts'],
      },
    ]);
    expect(search.requests.length).toBe(2);
    expect(member<() => string>('summary')()).toBe('No results');
    expect(notify).toHaveBeenCalledWith({
      severity: 'success',
      title: 'Replaced 1 match in 1 file',
    });
  });

  it('replaceAll_skipsAFileOpenWithUnsavedEdits_andNamesIt', async () => {
    // ⛔ Writing under unsaved edits would set the file on disk against the editor's copy.
    search.results = {
      files: [
        {
          path: '/ws/a.ts',
          relativePath: 'a.ts',
          matches: [{ line: 1, column: 1, before: '', text: 'todo', after: '' }],
        },
        {
          path: '/ws/b.ts',
          relativePath: 'b.ts',
          matches: [{ line: 1, column: 1, before: '', text: 'todo', after: '' }],
        },
      ],
      total: 2,
      capped: false,
    };
    unsaved = [{ filePath: (): string => '/ws/a.ts', dirty: (): boolean => true }];
    await readyToReplace();

    formButton('Replace All')?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(search.replaces[0].files).toEqual(['/ws/b.ts']);
    expect(notify).toHaveBeenCalledWith({
      severity: 'warning',
      title: 'Replaced 1 match in 1 file',
      detail: 'a.ts has unsaved edits.',
    });
  });

  it('replace_replacesTheSelectedMatchAlone_andMovesOnToTheNext', async () => {
    const second: SearchResponse['files'][number] = {
      path: '/ws/src/main.ts',
      relativePath: 'src/main.ts',
      matches: [{ line: 9, column: 3, before: '  ', text: 'todo', after: '' }],
    };
    search.results = {
      files: [
        {
          ...second,
          matches: [
            { line: 3, column: 7, before: 'const ', text: 'todo', after: ' = 1;' },
            ...second.matches,
          ],
        },
      ],
      total: 2,
      capped: false,
    };
    search.afterReplace = { files: [second], total: 1, capped: false };
    await readyToReplace();
    expect(formButton('Replace')?.disabled).toBe(true);
    adapterOf(component).select(0);
    fixture.detectChanges();

    formButton('Replace')?.click();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(search.replaces[0].files).toEqual([]);
    expect(search.replaces[0].target).toEqual({ path: '/ws/src/main.ts', line: 3, column: 7 });
    expect(adapterOf(component).activeIndex()).toBe(0);
    expect(adapterOf(component).matches()[0].line).toBe(9);
  });

  it('replace_inAFileOpenWithUnsavedEdits_replacesNothing_andSaysSo', async () => {
    unsaved = [{ filePath: (): string => '/ws/src/main.ts', dirty: (): boolean => true }];
    await readyToReplace();
    adapterOf(component).select(0);
    fixture.detectChanges();

    formButton('Replace')?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(search.replaces).toEqual([]);
    expect(notify).toHaveBeenCalledWith({
      severity: 'warning',
      title: 'Save “main.ts” first',
      detail: 'It has unsaved edits, so the match was not replaced.',
    });
  });

  it('switchingForms_keepsTheQuery', async () => {
    vi.useFakeTimers();
    type('todo');
    member<() => void>('find').call(component);
    await vi.advanceTimersByTimeAsync(300);

    choose(1);

    expect(member<() => string>('draft')()).toBe('todo');
    expect(member<() => string>('summary')()).toBe('1 result in 1 file');
  });

  it('theReplaceForm_previewsEachResultsReplacement', async () => {
    vi.useFakeTimers();
    type('todo');
    member<() => void>('find').call(component);
    await vi.advanceTimersByTimeAsync(300);
    choose(1);
    member<WritableSignal<string>>('replacement').set('done');
    fixture.detectChanges();

    const row: HTMLElement | undefined = rowElements()[1];
    expect(row?.querySelector('del')?.textContent).toBe('todo');
    expect(row?.querySelector('ins')?.textContent).toBe('done');
  });

  /**
   * Gets the results tree's rendered rows.
   * @returns Returns the row elements, in order.
   */
  function rowElements(): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.search-panel__results .tree-row',
      ),
    );
  }

  /**
   * Searches for "todo" and settles the results.
   * @returns Returns a promise that resolves once the results are rendered.
   */
  async function findTodo(): Promise<void> {
    vi.useFakeTimers();
    type('todo');
    member<() => void>('find').call(component);
    await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
  }

  it('results_areTheSharedTree_groupedByFile_withEachMatchBeneathItsFile', async () => {
    await findTodo();

    expect((fixture.nativeElement as HTMLElement).querySelector('app-tree-view')).not.toBeNull();
    const rows: HTMLElement[] = rowElements();
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('src/main.ts');
    expect(rows[0].querySelector('.tree-count')?.textContent?.trim()).toBe('1');
    expect(rows[0].getAttribute('aria-expanded')).toBe('true');
    expect(rows[1].textContent).toContain('3');
    expect(rows[1].textContent).toContain('const todo = 1;');
  });

  it('lead_keepsTheMatchInView_byShorteningALongLeadInToItsEnd', () => {
    // A row is one line: a long lead-in pushed the match past the edge, into the ellipsis.
    const lead: (before: string) => string =
      member<(before: string) => string>('lead').bind(component);

    expect(lead('const ')).toBe('const ');
    expect(lead('    return ')).toBe('return ');
    expect(lead('export function greet(')).toBe('…port function greet(');
  });

  it('clickingAFile_foldsItsMatches_andClickingAgainUnfoldsThem', async () => {
    await findTodo();

    rowElements()[0].click();
    fixture.detectChanges();
    expect(rowElements().length).toBe(1);
    expect(rowElements()[0].getAttribute('aria-expanded')).toBe('false');

    rowElements()[0].click();
    fixture.detectChanges();
    expect(rowElements().length).toBe(2);
  });

  it('expandAllAndCollapseAll_foldTheWholeTree_andWaitForResults', async () => {
    /**
     * Finds one of the strip's fold buttons.
     * @param label Its label.
     * @returns Returns the button.
     */
    const fold: (label: string) => HTMLButtonElement | null = (
      label: string,
    ): HTMLButtonElement | null =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        `.search-panel__strip button[aria-label="${label}"]`,
      );
    fixture.detectChanges();
    expect(fold('Expand All')?.disabled).toBe(true);
    expect(fold('Collapse All')?.disabled).toBe(true);

    await findTodo();
    fold('Collapse All')?.click();
    fixture.detectChanges();

    expect(rowElements().length).toBe(1);

    fold('Expand All')?.click();
    fixture.detectChanges();

    expect(rowElements().length).toBe(2);
  });

  it('clickingAMatch_selectsItInTheAdapter', async () => {
    await findTodo();
    const select: ReturnType<typeof vi.spyOn> = vi
      .spyOn(adapterOf(component), 'select')
      .mockImplementation((): void => undefined);

    rowElements()[1].click();

    expect(select).toHaveBeenCalledWith(0);
  });

  it('aNewSearch_unfoldsEveryFile', async () => {
    await findTodo();
    rowElements()[0].click();
    fixture.detectChanges();

    member<() => void>('find').call(component);
    await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();

    expect(rowElements().length).toBe(2);
  });

  it('typing_doesNotSearch_untilFindIsAskedFor', async () => {
    // ⛔ A workspace search crawls every file; one per keystroke is a crawl nobody asked for.
    vi.useFakeTimers();
    type('todo');
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.length).toBe(0);

    member<() => void>('find').call(component);
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.map((request: SearchRequest): string => request.query)).toEqual([
      'todo',
    ]);
  });

  it('enter_inTheField_searches', async () => {
    vi.useFakeTimers();
    type('todo');
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLInputElement>('.search-panel__field input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.length).toBe(1);
  });

  it('aMatchOption_reRunsTheLastSearch_withTheOptionOn', async () => {
    vi.useFakeTimers();
    type('todo');
    member<() => void>('find').call(component);
    await vi.advanceTimersByTimeAsync(300);
    // Typing something new without asking for it does not change what the option re-runs.
    type('something else');

    member<WritableSignal<boolean>>('caseSensitive').set(true);
    member<() => void>('optionChanged').call(component);
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.at(-1)).toMatchObject({ query: 'todo', caseSensitive: true });
  });

  it('aMatchOption_beforeAnySearch_searchesNothing', async () => {
    vi.useFakeTimers();
    member<WritableSignal<boolean>>('regexp').set(true);
    member<() => void>('optionChanged').call(component);
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.length).toBe(0);
  });

  it('summary_countsTheResultsAndTheFilesTheyAreIn', async () => {
    vi.useFakeTimers();
    expect(member<() => string>('summary')()).toBe('');

    type('todo');
    member<() => void>('find').call(component);
    await vi.advanceTimersByTimeAsync(300);

    expect(member<() => string>('summary')()).toBe('1 result in 1 file');
  });

  it('setQuery_afterTheDebounce_searchesTheActiveWorkspaceRoot', async () => {
    vi.useFakeTimers();
    const adapter: WorkspaceSearchAdapter = adapterOf(component);

    adapter.setQuery({ text: 'todo', caseSensitive: false, wholeWord: false, regexp: false });
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.length).toBe(1);
    expect(search.requests[0].query).toBe('todo');
    expect(search.requests[0].root).toBe('/ws');
    expect(adapter.matches().length).toBe(1);
    expect(adapter.matches()[0].file).toBe('src/main.ts');
  });

  it('setQuery_whenNoWorkspaceRootIsOpen_clearsInsteadOfSearching', async () => {
    vi.useFakeTimers();
    const adapter: WorkspaceSearchAdapter = adapterOf(component);
    rootPath.set(null);

    adapter.setQuery({ text: 'todo', caseSensitive: false, wholeWord: false, regexp: false });
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.length).toBe(0);
    expect(adapter.matches().length).toBe(0);
  });

  it('setQuery_whenTheQueryIsCleared_dropsTheMatches', async () => {
    vi.useFakeTimers();
    const adapter: WorkspaceSearchAdapter = adapterOf(component);

    adapter.setQuery({ text: 'todo', caseSensitive: false, wholeWord: false, regexp: false });
    await vi.advanceTimersByTimeAsync(300);

    expect(adapter.matches().length).toBe(1);

    adapter.setQuery({ text: '', caseSensitive: false, wholeWord: false, regexp: false });
    await vi.advanceTimersByTimeAsync(300);

    expect(adapter.matches().length).toBe(0);
    expect(search.requests.length).toBe(1);
  });
});
