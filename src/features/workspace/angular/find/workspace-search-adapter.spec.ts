import { describe, expect, it, vi } from 'vitest';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import { SearchRequest, SearchResponse } from '@shared/api/search-channels';
import { WorkspaceSearchAdapter } from './workspace-search-adapter';

/**
 * Builds an adapter over a search client that records its requests.
 * @param pathsOf What the adapter confines its searches to.
 * @returns Returns the adapter and the requests it made.
 */
function build(pathsOf?: () => readonly string[] | undefined): {
  readonly adapter: WorkspaceSearchAdapter;
  readonly requests: SearchRequest[];
} {
  const requests: SearchRequest[] = [];
  const search: Search = {
    run: (request: SearchRequest): Promise<SearchResponse> => {
      requests.push(request);
      return Promise.resolve({ files: [], total: 0, capped: false });
    },
  } as unknown as Search;
  const adapter: WorkspaceSearchAdapter = new WorkspaceSearchAdapter(
    search,
    {} as FileOpener,
    {} as Editors,
    (): string => '/ws',
    pathsOf,
  );
  return { adapter, requests };
}

describe('WorkspaceSearchAdapter (#1007 paths)', () => {
  it('setQuery_withoutPaths_searchesTheWholeRoot', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, requests } = build();

      adapter.setQuery({ text: 'todo', caseSensitive: false, wholeWord: false, regexp: false });
      await vi.runAllTimersAsync();

      expect(requests).toHaveLength(1);
      expect(requests[0].root).toBe('/ws');
      expect('paths' in requests[0]).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('setQuery_withPaths_confinesTheSearchToThem_asTheyStoodWhenAskedFor', async () => {
    vi.useFakeTimers();
    try {
      let paths: readonly string[] | undefined = ['/ws/app'];
      const { adapter, requests } = build((): readonly string[] | undefined => paths);

      adapter.setQuery({ text: 'todo', caseSensitive: false, wholeWord: false, regexp: false });
      // The scope is read when the search is asked for, not when the debounce lets it run.
      paths = undefined;
      await vi.runAllTimersAsync();

      expect(requests[0].paths).toEqual(['/ws/app']);
    } finally {
      vi.useRealTimers();
    }
  });
});
