import { describe, expect, it, vi } from 'vitest';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { FindScope } from '@shared/angular/components/find-panel/find-request';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import { ReplaceResponse, SearchRequest, SearchResponse } from '@shared/api/search-channels';
import { EditorSearchTarget } from '@shared/angular/components/search-view/open-editors-find-adapter';
import { ScopedSearchAdapter, searchesDisk } from './scoped-search-adapter';
import {
  FakeCodeEditor,
  FakeTextModel,
} from '@shared/angular/components/search-view/testing/fake-text-model';

/**
 * A plain query for "todo".
 */
const TODO: FindQuery = { text: 'todo', caseSensitive: false, wholeWord: false, regexp: false };

/**
 * Builds an adapter whose disk search finds one match and whose open editors are one model.
 * @param projectDirectory The current project's folder, or null.
 * @returns Returns the adapter, the disk requests, the scopes the editors were asked for, and the
 * model.
 */
function build(projectDirectory: string | null = '/ws/app'): {
  readonly adapter: ScopedSearchAdapter;
  readonly requests: SearchRequest[];
  readonly asked: FindScope[];
  readonly model: FakeTextModel;
} {
  const requests: SearchRequest[] = [];
  const asked: FindScope[] = [];
  const model: FakeTextModel = new FakeTextModel(['todo in memory']);
  const editor: FakeCodeEditor = new FakeCodeEditor(model);
  const search: Search = {
    run: (request: SearchRequest): Promise<SearchResponse> => {
      requests.push(request);
      return Promise.resolve({
        files: [
          {
            path: '/ws/app/a.ts',
            relativePath: 'app/a.ts',
            matches: [{ line: 1, column: 1, before: '', text: 'todo', after: ' on disk' }],
          },
        ],
        total: 1,
        capped: false,
      });
    },
  } as unknown as Search;
  const adapter: ScopedSearchAdapter = new ScopedSearchAdapter({
    search,
    fileOpener: {} as FileOpener,
    editors: {} as Editors,
    rootOf: (): string => '/ws',
    projectDirectoryOf: (): string | null => projectDirectory,
    editorTargetsOf: (scope: FindScope): readonly EditorSearchTarget[] => {
      asked.push(scope);
      return [
        {
          model: model.asModel(),
          editor: () => editor.asEditor(),
          path: '/ws/b.ts',
          label: 'b.ts',
        },
      ];
    },
  });
  return { adapter, requests, asked, model };
}

describe('ScopedSearchAdapter (#1007)', () => {
  it('searchesDisk_isTheWorkspaceAndProjectScopes', () => {
    expect(
      (['workspace', 'project', 'open-files', 'file', 'selection'] as const).filter(searchesDisk),
    ).toEqual(['workspace', 'project']);
  });

  it('theWorkspaceScope_searchesTheWholeRootOnDisk', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, requests, asked } = build();

      adapter.setQuery(TODO);
      await vi.runAllTimersAsync();

      expect(adapter.onDisk()).toBe(true);
      expect(requests[0].paths).toBeUndefined();
      expect(asked).toEqual([]);
      expect(
        adapter.matches().map((item: FindResultItem): string | undefined => item.file),
      ).toEqual(['app/a.ts']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('theProjectScope_searchesTheProjectFolderOnDisk', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, requests } = build();
      adapter.setScope('project');

      adapter.setQuery(TODO);
      await vi.runAllTimersAsync();

      expect(requests[0].paths).toEqual(['/ws/app']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('anEditorScope_searchesTheOpenEditors_andChangingScopeClearsTheLastScopesResults', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, requests, asked, model } = build();
      adapter.setQuery(TODO);
      await vi.runAllTimersAsync();
      expect(adapter.matches()).toHaveLength(1);

      adapter.setScope('open-files');
      expect(adapter.matches()).toEqual([]);
      adapter.setQuery(TODO);

      expect(adapter.onDisk()).toBe(false);
      expect(asked).toEqual(['open-files']);
      expect(requests).toHaveLength(1);
      expect(adapter.matches()[0]).toEqual(
        expect.objectContaining({ file: 'b.ts', after: ' in memory' }),
      );
      expect(model.highlights()).toHaveLength(1);

      adapter.setScope('workspace');

      expect(model.highlights()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaceFiles_inAnEditorScope_editsTheModel_withNoSkipping', async () => {
    const { adapter, model } = build();
    adapter.setScope('file');
    adapter.setQuery(TODO);

    const response: ReplaceResponse | null = await adapter.replaceFiles(
      'done',
      new Set<string>(['/ws/b.ts']),
    );

    expect(response).toEqual({ replaced: 1, files: 1, failed: [] });
    expect(model.text()).toBe('done in memory');
    expect(adapter.canUndo()).toBe(true);
  });
});
