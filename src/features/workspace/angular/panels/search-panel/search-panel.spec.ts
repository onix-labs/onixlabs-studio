import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type * as MonacoApi from 'monaco-editor';
import { ScopedSearchAdapter } from '@features/workspace/angular/find/scoped-search-adapter';
import {
  FakeCodeEditor,
  FakeTextModel,
} from '@shared/angular/components/search-view/testing/fake-text-model';
import { OwningProject, SolutionModel } from '@features/workspace/angular/project/solution-model';
import { FindRequest } from '@shared/angular/components/find-panel/find-request';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SearchView } from '@shared/angular/components/search-view/search-view';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { Monaco } from '@shared/angular/services/monaco/monaco';
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
import { SearchPanelRequests } from './search-panel-requests';

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
function adapterOf(component: SearchPanel): ScopedSearchAdapter {
  return (component as unknown as { adapter: ScopedSearchAdapter }).adapter;
}

describe('SearchPanel', () => {
  let component: SearchPanel;
  let fixture: ComponentFixture<SearchPanel>;
  let search: FakeSearch;
  let rootPath: WritableSignal<string | null>;
  let unsaved: { id?: string; filePath: () => string; dirty: () => boolean }[];
  let notify: ReturnType<typeof vi.fn>;
  let activeDocumentId: WritableSignal<string | null>;
  let owner: OwningProject | null;
  let openModel: FakeTextModel;
  let openEditor: FakeCodeEditor;
  let opened: string[];
  let reveals: { documentId: string; line: number; column: number; endColumn?: number }[];

  beforeEach(async () => {
    search = new FakeSearch();
    rootPath = signal<string | null>('/ws');
    unsaved = [];
    notify = vi.fn();
    activeDocumentId = signal<string | null>(null);
    owner = null;
    // The one open editor's model, at "/ws/open.ts", with an unsaved edit the disk has never seen.
    openModel = new FakeTextModel(['todo, unsaved']);
    openEditor = new FakeCodeEditor(openModel);
    opened = [];
    reveals = [];
    const monaco: typeof MonacoApi = {
      Uri: { parse: (uri: string): string => uri },
      editor: {
        getModel: (uri: string): MonacoApi.editor.ITextModel | null =>
          uri === 'inmemory://open' ? openModel.asModel() : null,
        getEditors: (): MonacoApi.editor.ICodeEditor[] => [openEditor.asEditor()],
      },
    } as unknown as typeof MonacoApi;

    await TestBed.configureTestingModule({
      imports: [SearchPanel],
      providers: [
        { provide: Search, useValue: search },
        {
          provide: FileOpener,
          useValue: {
            openPath: (path: string): Promise<boolean> => {
              opened.push(path);
              return Promise.resolve(true);
            },
          },
        },
        {
          provide: Editors,
          useValue: {
            modelUriForPath: (path: string): string =>
              path === '/ws/open.ts' ? 'inmemory://open' : 'file:///ws',
            locate: (): { documentId: string } => ({ documentId: 'doc' }),
            requestReveal: (
              documentId: string,
              line: number,
              column: number,
              endColumn?: number,
            ): void => void reveals.push({ documentId, line, column, endColumn }),
          },
        },
        {
          provide: Documents,
          useValue: {
            list: (): typeof unsaved => unsaved,
            activeDocumentId,
            get: (id: string): (typeof unsaved)[number] | undefined =>
              unsaved.find((document: (typeof unsaved)[number]): boolean => document.id === id),
          },
        },
        { provide: Notifications, useValue: { notify } },
        { provide: ActiveWorkspace, useValue: { rootPath } },
        {
          provide: SolutionModel,
          useValue: { owningProject: (): OwningProject | null => owner },
        },
        { provide: Diffs, useValue: { openEditors: (): readonly unknown[] => [] } },
        { provide: Monaco, useValue: { getMonaco: (): typeof MonacoApi => monaco } },
        {
          provide: DockState,
          useValue: { layout: signal(null), setActive: (): void => undefined },
        },
        SearchPanelRequests,
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
   * Gets the shared search view the panel shows.
   * @returns Returns the view.
   */
  function view(): SearchView {
    return fixture.debugElement.query(By.directive(SearchView)).componentInstance as SearchView;
  }

  /**
   * Reads one of the view's protected members.
   * @param name The member.
   * @returns Returns its value.
   */
  function member<T>(name: string): T {
    return (view() as unknown as Record<string, T>)[name];
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
        '.search-view__strip .panel-toolbar__button',
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
      '.search-view__form',
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
      '.search-view__form',
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
        '.search-view__actions button',
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
    member<() => void>('find').call(view());
    await vi.advanceTimersByTimeAsync(300);

    choose(1);

    expect(member<() => string>('draft')()).toBe('todo');
    expect(member<() => string>('summary')()).toBe('1 result in 1 file');
  });

  it('theReplaceForm_previewsEachResultsReplacement', async () => {
    vi.useFakeTimers();
    type('todo');
    member<() => void>('find').call(view());
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
        '.search-view__results .tree-row',
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
    member<() => void>('find').call(view());
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
      member<(before: string) => string>('lead').bind(view());

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
        `.search-view__strip button[aria-label="${label}"]`,
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

  it('clickingAMatchOnDisk_opensItsFile_andHasItsEditorSelectTheMatch', async () => {
    // Matthew, #1007: clicking a result must take you to the line — the match selected, not just a
    // caret dropped somewhere near it.
    await findTodo();

    rowElements()[1].click();
    await vi.advanceTimersByTimeAsync(0);

    expect(opened).toEqual(['/ws/src/main.ts']);
    expect(reveals).toEqual([{ documentId: 'doc', line: 3, column: 7, endColumn: 11 }]);
  });

  it('clickingAMatchInTheOpenEditors_selectsCentresAndFocusesItInItsEditor', async () => {
    // Matthew, #1007: the in-editor scopes selected the match in an editor that kept no focus, so a
    // match already on screen looked as if the click had done nothing.
    openTheFile();
    ask({ mode: 'find', scope: 'file', seed: 'todo', filePath: '/ws/open.ts' });

    rowElements()[1].click();
    // The editor's tab is brought forward first, and only then is the match selected in it.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(opened).toEqual(['/ws/open.ts']);
    expect(openEditor.selection).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 5,
    });
    expect(openEditor.revealed).toEqual(openEditor.selection);
    expect(openEditor.focused).toBe(true);
  });

  it('aNewSearch_unfoldsEveryFile', async () => {
    await findTodo();
    rowElements()[0].click();
    fixture.detectChanges();

    member<() => void>('find').call(view());
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

    member<() => void>('find').call(view());
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
      .querySelector<HTMLInputElement>('.search-view__field input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.length).toBe(1);
  });

  it('aMatchOption_reRunsTheLastSearch_withTheOptionOn', async () => {
    vi.useFakeTimers();
    type('todo');
    member<() => void>('find').call(view());
    await vi.advanceTimersByTimeAsync(300);
    // Typing something new without asking for it does not change what the option re-runs.
    type('something else');

    member<WritableSignal<boolean>>('caseSensitive').set(true);
    member<() => void>('optionChanged').call(view());
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.at(-1)).toMatchObject({ query: 'todo', caseSensitive: true });
  });

  it('aMatchOption_beforeAnySearch_searchesNothing', async () => {
    vi.useFakeTimers();
    member<WritableSignal<boolean>>('regexp').set(true);
    member<() => void>('optionChanged').call(view());
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.length).toBe(0);
  });

  it('summary_countsTheResultsAndTheFilesTheyAreIn', async () => {
    vi.useFakeTimers();
    expect(member<() => string>('summary')()).toBe('');

    type('todo');
    member<() => void>('find').call(view());
    await vi.advanceTimersByTimeAsync(300);

    expect(member<() => string>('summary')()).toBe('1 result in 1 file');
  });

  it('setQuery_afterTheDebounce_searchesTheActiveWorkspaceRoot', async () => {
    vi.useFakeTimers();
    const adapter: ScopedSearchAdapter = adapterOf(component);

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
    const adapter: ScopedSearchAdapter = adapterOf(component);
    rootPath.set(null);

    adapter.setQuery({ text: 'todo', caseSensitive: false, wholeWord: false, regexp: false });
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.length).toBe(0);
    expect(adapter.matches().length).toBe(0);
  });

  it('setQuery_whenTheQueryIsCleared_dropsTheMatches', async () => {
    vi.useFakeTimers();
    const adapter: ScopedSearchAdapter = adapterOf(component);

    adapter.setQuery({ text: 'todo', caseSensitive: false, wholeWord: false, regexp: false });
    await vi.advanceTimersByTimeAsync(300);

    expect(adapter.matches().length).toBe(1);

    adapter.setQuery({ text: '', caseSensitive: false, wholeWord: false, regexp: false });
    await vi.advanceTimersByTimeAsync(300);

    expect(adapter.matches().length).toBe(0);
    expect(search.requests.length).toBe(1);
  });

  /**
   * Gets the scope dropdown's options.
   * @returns Returns the options.
   */
  function scopes(): readonly DropdownOption[] {
    return member<() => readonly DropdownOption[]>('scopeOptions')();
  }

  /**
   * Gets the labels of the scopes that cannot be chosen.
   * @returns Returns the labels.
   */
  function disabledScopes(): string[] {
    return scopes()
      .filter((option: DropdownOption): boolean => option.disabled === true)
      .map((option: DropdownOption): string => option.label);
  }

  /**
   * Sends the panel a find request, as an editor's ⌘F does through its workspace.
   * @param request The request.
   * @param fromDiff Whether it came from a diff.
   */
  function ask(request: FindRequest, fromDiff: boolean = false): void {
    TestBed.inject(SearchPanelRequests).post(request, fromDiff);
    fixture.detectChanges();
  }

  /**
   * Opens "/ws/open.ts" as the well's active document, open with unsaved edits.
   */
  function openTheFile(): void {
    unsaved = [{ id: 'open', filePath: (): string => '/ws/open.ts', dirty: (): boolean => true }];
    activeDocumentId.set('open');
  }

  it('theScopeDropdown_offersEveryScope_inOrder_withWholeWorkspaceChosen', () => {
    expect(scopes().map((option: DropdownOption): string => option.label)).toEqual([
      'Whole Workspace',
      'Current Project',
      'Open Files',
      'Current File',
      'Current Selection',
    ]);
    expect(adapterOf(component).scope()).toBe('workspace');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.search-view__form app-dropdown'),
    ).not.toBeNull();
  });

  it('theScopeDropdown_disablesScopesWithNothingToSearch', () => {
    // No active file: no project, no file, no selection.
    expect(disabledScopes()).toEqual(['Current Project', 'Current File', 'Current Selection']);

    openTheFile();
    owner = { name: 'App', path: '/ws/app/app.csproj', directory: '/ws/app' };
    // The owner is read through the active file, which has just changed.
    activeDocumentId.set(null);
    activeDocumentId.set('open');
    // The panel hands the view its disabled scopes as an input, bound on the next check.
    fixture.detectChanges();

    expect(disabledScopes()).toEqual(['Current Selection']);
  });

  it('aRequest_choosesTheFormAndScope_seedsTheQuery_andSearchesTheEditors', () => {
    openTheFile();

    ask({ mode: 'replace', scope: 'file', seed: 'todo', filePath: '/ws/open.ts' });

    expect(member<() => string>('mode')()).toBe('replace');
    expect(adapterOf(component).scope()).toBe('file');
    expect(member<() => string>('draft')()).toBe('todo');
    // The open editor's text, unsaved edit and all — not the disk.
    expect(search.requests).toHaveLength(0);
    expect(adapterOf(component).matches()[0]).toEqual(
      expect.objectContaining({ file: 'open.ts', after: ', unsaved' }),
    );
  });

  it('aRequestForTheSelection_withASelection_enablesAndSearchesIt', () => {
    openTheFile();

    ask({
      mode: 'find',
      scope: 'selection',
      seed: 'unsaved',
      filePath: '/ws/open.ts',
      selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 },
    });

    // "unsaved" lies outside the selected "todo".
    expect(disabledScopes()).not.toContain('Current Selection');
    expect(adapterOf(component).scope()).toBe('selection');
    expect(adapterOf(component).matches()).toEqual([]);
  });

  it('aRequest_forAScopeWithNothingToSearch_fallsBackToTheNearestThatHas', () => {
    ask({ mode: 'find', scope: 'project' });
    expect(adapterOf(component).scope()).toBe('workspace');

    ask({ mode: 'find', scope: 'selection' });
    expect(adapterOf(component).scope()).toBe('open-files');
  });

  it('aRequest_withoutASeed_keepsTheQuery_andSearchesOnlyWhenThereIsOne', async () => {
    vi.useFakeTimers();
    ask({ mode: 'find', scope: 'workspace' });
    await vi.advanceTimersByTimeAsync(300);
    expect(search.requests).toHaveLength(0);

    type('todo');
    ask({ mode: 'find', scope: 'workspace' });
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests).toHaveLength(1);
    expect(search.requests[0].query).toBe('todo');
  });

  it('aRequest_isTakenOnce', () => {
    ask({ mode: 'replace', scope: 'workspace' });

    expect(TestBed.inject(SearchPanelRequests).pending()).toBeNull();
  });

  it('choosingCurrentProject_searchesTheProjectsFolder_andReRunsTheLastSearch', async () => {
    vi.useFakeTimers();
    openTheFile();
    owner = { name: 'App', path: '/ws/app/app.csproj', directory: '/ws/app' };
    activeDocumentId.set(null);
    activeDocumentId.set('open');
    type('todo');
    member<() => void>('find').call(view());
    await vi.advanceTimersByTimeAsync(300);

    member<(value: string) => void>('chooseScope').call(view(), 'project');
    await vi.advanceTimersByTimeAsync(300);

    expect(search.requests.map((request: SearchRequest) => request.paths)).toEqual([
      undefined,
      ['/ws/app'],
    ]);
  });

  it('replaceAll_inTheEditors_editsTheUnsavedFile_ratherThanSkippingIt', async () => {
    openTheFile();
    ask({ mode: 'replace', scope: 'open-files', seed: 'todo' });
    member<WritableSignal<string>>('replacement').set('done');

    await member<() => Promise<void>>('replaceEvery').call(view());

    expect(openModel.text()).toBe('done, unsaved');
    expect(search.replaces).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith({
      severity: 'success',
      title: 'Replaced 1 match in 1 file',
    });
  });
});
