import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { Tab } from '@shared/angular/services/tabs/tab';
import { SHELL_WINDOW, Tabs } from '@shared/angular/services/tabs/tabs';
import { DocumentConflictModal } from '@shared/angular/components/document-conflict-modal/document-conflict-modal';

/**
 * Represents the content area that hosts the view for every open tab.
 *
 * Every open tab is mounted at once and inactive tabs are hidden rather than destroyed, so that
 * view state (editor undo history, scroll position, terminal sessions) survives tab switches.
 */
@Component({
  selector: 'app-content-host',
  imports: [NgComponentOutlet, DocumentConflictModal],
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
   * Holds the Studio window this belongs to, whose tabs it shows (#1587).
   */
  private readonly windowId: string = inject(SHELL_WINDOW);

  /**
   * Gets this window's open tabs, in order.
   */
  protected readonly tabs: Signal<readonly Tab[]> = this.tabsService.tabsIn(this.windowId);

  /**
   * Gets the identifier of this window's active tab, or undefined when it has none.
   */
  protected readonly activeTabId: Signal<string | undefined> = this.tabsService.activeTabIdIn(
    this.windowId,
  );
}
