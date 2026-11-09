import { inject, Service } from '@angular/core';
import { DatabaseDocument, parseDatabaseDocument } from '@shared/api/database-document';
import { FileInfo } from '@shared/api/file-channels';
import { Log } from '@shared/angular/services/log/log';
import { RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { OpenOptions, Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * A database document read from disk, paired with the file it came from.
 */
export interface OpenDatabaseDocument {
  /**
   * Gets the absolute path the document was read from.
   */
  readonly path: string;

  /**
   * Gets the parsed document.
   */
  readonly document: DatabaseDocument;
}

/**
 * Bridges opening a `*.database.json` on disk to the Database Explorer tab that hosts it — the same
 * shape as {@link import('../api-files/api-files').ApiFiles}: the parsed document is stashed under the
 * new tab's id and the view takes it once on init. A file that does not parse as a database document is
 * declined, and falls through to the text editor where it can be fixed.
 */
@Service()
export class DatabaseFiles {
  /**
   * Holds the top-level tab registry.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the recent-items registry, so an opened document is offered on the welcome screen.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the pending document for each tab, keyed by tab id, until its view takes it.
   */
  private readonly pending: Map<string, OpenDatabaseDocument> = new Map<
    string,
    OpenDatabaseDocument
  >();

  /**
   * Opens a database document as a tab, activating the tab that already holds the file.
   * @param fileInfo The file, already read.
   * @param options How to open it.
   * @returns Returns true when the document was opened or re-activated; otherwise, false.
   */
  public open(fileInfo: FileInfo, options?: OpenOptions): boolean {
    const document: DatabaseDocument | null = parseDatabaseDocument(fileInfo.content);
    if (document === null) {
      this.log.warn(
        'DatabaseFiles',
        'Not a database document; leaving it to the text editor',
        fileInfo.path,
      );
      return false;
    }
    this.recentItems.record(fileInfo.path, fileInfo.name, 'database');
    const existing: Tab | undefined = this.tabs.findByResource('database-explorer', fileInfo.path);
    if (existing !== undefined) {
      if (options?.background !== true) {
        this.tabs.activate(existing.id);
      }
      return true;
    }
    const tab: Tab = this.tabs.open('database-explorer', fileInfo.path, options);
    this.tabs.rename(tab.id, fileInfo.name);
    this.pending.set(tab.id, { path: fileInfo.path, document });
    this.log.info('DatabaseFiles', `Opened database document '${fileInfo.name}'`, tab.id);
    return true;
  }

  /**
   * Takes the document a tab was opened with, if any, clearing it so it is used once.
   * @param tabId The tab's id.
   * @returns Returns the document, or undefined when the tab was opened empty.
   */
  public takeInitial(tabId: string): OpenDatabaseDocument | undefined {
    const pending: OpenDatabaseDocument | undefined = this.pending.get(tabId);
    this.pending.delete(tabId);
    return pending;
  }
}
