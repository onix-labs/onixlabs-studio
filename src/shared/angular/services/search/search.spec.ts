import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import {
  SearchChannel,
  SearchRequest,
  SearchResponse,
  TextEditsRequest,
  TextEditsResponse,
} from '@shared/api/search-channels';
import { Search } from './search';

/**
 * A recorded bridge invocation.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

/**
 * The request forwarded by the tests.
 */
const REQUEST: SearchRequest = {
  query: 'needle',
  root: '/ws',
  caseSensitive: false,
  wholeWord: true,
  regexp: false,
};

describe('Search', () => {
  let calls: RecordedCall[];

  /**
   * Installs a stub bridge on the window that records invocations and resolves with a fixed response.
   * @param response The response the stubbed invoke resolves with.
   */
  function stubBridge(response: SearchResponse | TextEditsResponse): void {
    calls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        return Promise.resolve(response as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('run_whenTheBridgeIsPresent_forwardsTheRequestAndReturnsTheResponse', async () => {
    const response: SearchResponse = {
      files: [
        {
          path: '/ws/a.ts',
          relativePath: 'a.ts',
          matches: [{ line: 1, column: 2, before: 'a ', text: 'needle', after: ' z' }],
        },
      ],
      total: 1,
      capped: false,
    };
    stubBridge(response);
    const search: Search = TestBed.inject(Search);

    const result: SearchResponse = await search.run(REQUEST);

    expect(calls).toEqual([{ channel: SearchChannel.Run, args: [REQUEST] }]);
    expect(result).toEqual(response);
  });

  it('run_whenTheBridgeIsAbsent_resolvesEmptyWithoutInvoking', async () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const search: Search = TestBed.inject(Search);

    const result: SearchResponse = await search.run(REQUEST);

    expect(result).toEqual({ files: [], total: 0, capped: false });
  });

  it('applyTextEdits_forwardsTheFilesToTheMainProcess (#1015)', async () => {
    const request: TextEditsRequest = {
      files: [
        {
          path: '/ws/a.ts',
          edits: [
            { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5, text: 'id' },
          ],
        },
      ],
    };
    const response: TextEditsResponse = { written: [{ path: '/ws/a.ts', edits: 1 }], failed: [] };
    stubBridge(response);

    const result: TextEditsResponse = await TestBed.inject(Search).applyTextEdits(request);

    expect(calls).toEqual([{ channel: SearchChannel.ApplyTextEdits, args: [request] }]);
    expect(result).toEqual(response);
  });

  it('applyTextEdits_whenTheBridgeIsAbsent_refusesEveryFile (#1015)', async () => {
    const result: TextEditsResponse = await TestBed.inject(Search).applyTextEdits({
      files: [{ path: '/ws/a.ts', edits: [] }],
    });

    expect(result.written).toEqual([]);
    expect(result.failed.map((failure: { path: string }): string => failure.path)).toEqual([
      '/ws/a.ts',
    ]);
  });
});
