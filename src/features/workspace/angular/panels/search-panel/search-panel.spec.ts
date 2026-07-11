import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkspaceSearchAdapter } from '@features/workspace/angular/find/workspace-search-adapter';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import { SearchRequest, SearchResponse } from '@shared/api/search-channels';

import { SearchPanel } from './search-panel';

/**
 * A search client that records each request and resolves a single canned match.
 */
class FakeSearch {
  /**
   * Holds the requests the panel's adapter has run.
   */
  public readonly requests: SearchRequest[] = [];

  /**
   * Records the request and resolves the canned response.
   * @param request The search request.
   * @returns Returns the canned response.
   */
  public run(request: SearchRequest): Promise<SearchResponse> {
    this.requests.push(request);
    return Promise.resolve({
      files: [
        {
          path: '/ws/src/main.ts',
          relativePath: 'src/main.ts',
          matches: [{ line: 3, column: 7, before: 'const ', text: 'todo', after: ' = 1;' }],
        },
      ],
      total: 1,
      capped: false,
    });
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

  beforeEach(async () => {
    search = new FakeSearch();
    rootPath = signal<string | null>('/ws');

    await TestBed.configureTestingModule({
      imports: [SearchPanel],
      providers: [
        { provide: Search, useValue: search },
        { provide: FileOpener, useValue: {} },
        { provide: Editors, useValue: {} },
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

  it('render_hostsTheSharedFindPanelWithoutAHeader', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-find-panel')).not.toBeNull();
    expect(element.querySelector('.find-panel__header')).toBeNull();
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
