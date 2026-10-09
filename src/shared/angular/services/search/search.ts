import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { Log } from '@shared/angular/services/log/log';
import {
  ReplaceRequest,
  ReplaceResponse,
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Runs a workspace search.
   * @param request The search request.
   * @returns Returns the grouped matches, or an empty response when the bridge is absent.
   */
  public async run(request: SearchRequest): Promise<SearchResponse> {
    if (this.bridge === undefined) {
      return { files: [], total: 0, capped: false };
    }
    this.log.info('Search', `Running workspace search for '${request.query}'`);
    const response: SearchResponse = await this.bridge.invoke<SearchResponse>(
      SearchChannel.Run,
      request,
    );
    this.log.debug(
      'Search',
      `Search returned ${response.total} match(es) across ${response.files.length} file(s)`,
      response.capped ? 'capped' : 'complete',
    );
    return response;
  }

  /**
   * Lists a workspace root's files as gitignore-aware relative paths, capped.
   * @param root The absolute path of the workspace root.
   * @returns Returns the relative paths, or empty when the bridge is absent.
   */
  public async listFiles(root: string): Promise<readonly string[]> {
    if (this.bridge === undefined) {
      return [];
    }
    return this.bridge.invoke<readonly string[]>(SearchChannel.ListFiles, root);
  }

  /**
   * Replaces matches of a query in a workspace's files on disk.
   * @param request The replace request.
   * @returns Returns what was replaced, or nothing when the bridge is absent.
   */
  public async replace(request: ReplaceRequest): Promise<ReplaceResponse> {
    if (this.bridge === undefined) {
      return { replaced: 0, files: 0, failed: [] };
    }
    this.log.info(
      'Search',
      request.target === undefined
        ? `Replacing '${request.query}' in ${request.files.length} file(s)`
        : `Replacing one '${request.query}' in ${request.target.path}`,
    );
    return this.bridge.invoke<ReplaceResponse>(SearchChannel.Replace, request);
  }
}
