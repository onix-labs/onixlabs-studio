import { inject, Service } from '@angular/core';
import {
  API_DOCUMENT_KIND,
  API_DOCUMENT_VERSION,
  ApiDocument,
  ApiEnvironment,
  ApiFolder,
  ApiRequest,
} from '@shared/api/api-client-types';
import { FileInfo } from '@shared/api/file-channels';
import { Log } from '@shared/angular/services/log/log';
import { RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * An API document read from disk, paired with the file it came from.
 */
export interface OpenApiDocument {
  /**
   * Gets the absolute path the document was read from.
   */
  readonly path: string;

  /**
   * Gets the file name, shown as the tab's title.
   */
  readonly fileName: string;

  /**
   * Gets the parsed document.
   */
  readonly document: ApiDocument;
}

/**
 * Bridges opening an API document on disk to the API Explorer tab that hosts it — the direct analog of
 * {@link import('../workspaces/workspaces').Workspaces} for directory tabs, and the same shape: the
 * parsed document is stashed under the new tab's id and the owning view consumes it once on init.
 *
 * The parse lives here rather than in the view because routing depends on it. A `*.api.json` whose
 * contents are not an API document (a truncated file, someone else's schema, a name collision) is not
 * opened as one at all: {@link open} declines it, and the shared file opener falls through to the text
 * editor — which is exactly where a user needs to be to fix it.
 *
 * It names no feature: it opens a tab of a type the shell already knows and hands over a document
 * described by the shared API contract.
 */
@Service()
export class ApiFiles {
  /**
   * Holds the top-level tab registry.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the recent-items registry, so an opened API document is offered on the welcome screen.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the pending document for each API tab, keyed by tab id, until its view consumes it.
   */
  private readonly pending: Map<string, OpenApiDocument> = new Map<string, OpenApiDocument>();

  /**
   * Opens an API document as a tab, activating the tab that already holds the file rather than opening
   * a second one. A file that does not parse as an API document is declined.
   * @param fileInfo The file to open, already read.
   * @returns Returns true when the document was opened or re-activated; otherwise, false.
   */
  public open(fileInfo: FileInfo): boolean {
    const document: ApiDocument | null = this.parse(fileInfo.content);
    if (document === null) {
      this.log.warn(
        'ApiFiles',
        'Not an API document; leaving it to the text editor',
        fileInfo.path,
      );
      return false;
    }
    this.recentItems.record(fileInfo.path, fileInfo.name, 'api');

    const existing: Tab | undefined = this.tabs.findByResource('api-explorer', fileInfo.path);
    if (existing !== undefined) {
      this.tabs.activate(existing.id);
      this.log.debug('ApiFiles', `Reused API tab for '${fileInfo.name}'`, existing.id);
      return true;
    }

    const tab: Tab = this.tabs.open('api-explorer', fileInfo.path);
    this.tabs.rename(tab.id, fileInfo.name);
    this.pending.set(tab.id, { path: fileInfo.path, fileName: fileInfo.name, document });
    this.log.info('ApiFiles', `Opened API document '${fileInfo.name}'`, tab.id, fileInfo.path);
    return true;
  }

  /**
   * Consumes the document an API tab was opened with, if any, clearing it so it is used once.
   * @param tabId The API tab's id.
   * @returns Returns the stashed document, or undefined when the tab was opened empty.
   */
  public takeInitial(tabId: string): OpenApiDocument | undefined {
    const pending: OpenApiDocument | undefined = this.pending.get(tabId);
    this.pending.delete(tabId);
    return pending;
  }

  /**
   * Reads an API document from text, verifying the moniker and that every collection it claims is
   * actually there. Anything else — malformed JSON, a foreign schema, a newer version this build
   * cannot read — is rejected rather than half-loaded.
   * @param text The file's contents.
   * @returns Returns the document, or null when the text is not one this build can open.
   */
  public parse(text: string): ApiDocument | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const candidate: Partial<ApiDocument> = raw;
    if (candidate.kind !== API_DOCUMENT_KIND) {
      return null;
    }
    if (typeof candidate.version !== 'number' || candidate.version > API_DOCUMENT_VERSION) {
      this.log.warn(
        'ApiFiles',
        'API document is from a newer version of Studio',
        candidate.version,
      );
      return null;
    }
    if (
      !Array.isArray(candidate.folders) ||
      !Array.isArray(candidate.requests) ||
      !Array.isArray(candidate.environments)
    ) {
      return null;
    }
    return {
      kind: API_DOCUMENT_KIND,
      version: candidate.version,
      folders: candidate.folders as readonly ApiFolder[],
      requests: candidate.requests as readonly ApiRequest[],
      environments: candidate.environments as readonly ApiEnvironment[],
      activeEnvironmentId: candidate.activeEnvironmentId ?? null,
    };
  }
}
