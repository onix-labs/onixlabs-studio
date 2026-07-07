import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  SearchChannel,
  SearchClient,
  SearchRequest,
  SearchResponse,
} from '@shared/api/search-channels';

/**
 * Represents the renderer-side workspace-search client. It forwards a query and workspace root to the
 * main-process search manager over the generic bridge and returns the grouped matches. Outside
 * Electron the bridge is absent and every search resolves empty, so callers need no environment check.
 */
@Service()
export class Search implements SearchClient {
  /**
   * Holds the IPC bridge to the main-process search manager, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Runs a workspace search.
   * @param request The search request.
   * @returns Returns the grouped matches, or an empty response when the bridge is absent.
   */
  public async run(request: SearchRequest): Promise<SearchResponse> {
    if (this.bridge === undefined) {
      return { files: [], total: 0, capped: false };
    }
    return this.bridge.invoke<SearchResponse>(SearchChannel.Run, request);
  }
}
