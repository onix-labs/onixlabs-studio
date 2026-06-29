import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AgentRibbon } from '../ribbons/agent-ribbon/agent-ribbon';
import { CodeRibbon } from '../ribbons/code-ribbon/code-ribbon';
import { DirectoryRibbon } from '../ribbons/directory-ribbon/directory-ribbon';
import { MarkdownRibbon } from '../ribbons/markdown-ribbon/markdown-ribbon';
import { SourceControlRibbon } from '../ribbons/source-control-ribbon/source-control-ribbon';

/**
 * Represents the contextual ribbon strip, whose content depends on the active tab type. The
 * settings tab (and the absence of any tab) deliberately shows no ribbon.
 */
@Component({
  selector: 'app-ribbon-strip-container',
  imports: [
    NgComponentOutlet,
    DirectoryRibbon,
    CodeRibbon,
    MarkdownRibbon,
    AgentRibbon,
    SourceControlRibbon,
  ],
  templateUrl: './ribbon-strip-container.html',
  styleUrl: './ribbon-strip-container.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStripContainer {
  /**
   * Holds the registry of feature ribbons, consulted first so a migrated feature's ribbon is shown
   * from its own descriptor. Tab types with no registered ribbon fall back to the static switch
   * until they are migrated.
   */
  protected readonly registry: FeatureRegistry = inject(FeatureRegistry);

  /**
   * Holds the tab registry used to resolve the active tab type.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Gets the type of the active tab, or `undefined` when no tab is active.
   */
  protected readonly activeType: Signal<TabType | undefined> = computed(
    (): TabType | undefined => this.tabsService.activeTab()?.type,
  );
}
