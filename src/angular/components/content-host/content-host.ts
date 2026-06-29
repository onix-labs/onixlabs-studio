import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { Documents } from '../../services/documents/documents';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { DocumentConflictModal } from '../shared/document-conflict-modal/document-conflict-modal';
import { CodeView } from '../views/code-view/code-view';
import { DirectoryView } from '../views/directory-view/directory-view';
import { MarkdownView } from '../views/markdown-view/markdown-view';
import { SourceControlView } from '../views/source-control-view/source-control-view';

/**
 * Represents the content area that hosts the view for every open tab.
 *
 * Every open tab is mounted at once and inactive tabs are hidden rather than destroyed, so that
 * view state (editor undo history, scroll position, terminal sessions) survives tab switches.
 */
@Component({
  selector: 'app-content-host',
  imports: [
    NgComponentOutlet,
    DirectoryView,
    CodeView,
    MarkdownView,
    SourceControlView,
    DocumentConflictModal,
  ],
  templateUrl: './content-host.html',
  styleUrl: './content-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentHost {
  /**
   * Holds the registry of feature views, consulted first so a migrated feature's view is mounted
   * from its own descriptor. Tab types with no registered feature fall back to the static switch
   * until they are migrated.
   */
  protected readonly registry: FeatureRegistry = inject(FeatureRegistry);

  /**
   * Holds the tab registry whose views are rendered.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the document model that backs code and markdown tabs.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Gets the ordered list of open tabs.
   */
  protected readonly tabs: Signal<readonly Tab[]> = this.tabsService.tabs;

  /**
   * Gets the identifier of the active tab, or undefined when no tab is open.
   */
  protected readonly activeTabId: Signal<string | undefined> = this.tabsService.activeTabId;

  /**
   * Gets the initial markdown content a markdown tab opens with, seeded from its document when the
   * tab was opened from a file. The markdown editor manages its own content thereafter.
   * @param id The identifier of the tab.
   * @returns Returns the document's initial content, or an empty string for a blank tab.
   */
  protected markdownContent(id: string): string {
    return this.documents.initialContentOf(id);
  }

  /**
   * Records an edit to a markdown tab's content so its dirty state and saves track the changes.
   * @param id The identifier of the tab.
   * @param content The new markdown content.
   */
  protected onMarkdownChange(id: string, content: string): void {
    this.documents.setContent(id, content);
  }
}
