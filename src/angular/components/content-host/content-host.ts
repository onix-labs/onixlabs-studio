import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { DocumentConflictModal } from '../shared/document-conflict-modal/document-conflict-modal';
import { DirectoryView } from '../views/directory-view/directory-view';

/**
 * Represents the content area that hosts the view for every open tab.
 *
 * Every open tab is mounted at once and inactive tabs are hidden rather than destroyed, so that
 * view state (editor undo history, scroll position, terminal sessions) survives tab switches.
 */
@Component({
  selector: 'app-content-host',
  imports: [NgComponentOutlet, DirectoryView, DocumentConflictModal],
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
   * Gets the ordered list of open tabs.
   */
  protected readonly tabs: Signal<readonly Tab[]> = this.tabsService.tabs;

  /**
   * Gets the identifier of the active tab, or undefined when no tab is open.
   */
  protected readonly activeTabId: Signal<string | undefined> = this.tabsService.activeTabId;
}
