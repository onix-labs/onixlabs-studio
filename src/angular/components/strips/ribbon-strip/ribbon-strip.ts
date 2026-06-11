import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { TabType } from '../../../services/tabs/tab';
import { Tabs } from '../../../services/tabs/tabs';
import { AgentRibbon } from './ribbons/agent-ribbon/agent-ribbon';
import { CodeRibbon } from './ribbons/code-ribbon/code-ribbon';
import { DirectoryRibbon } from './ribbons/directory-ribbon/directory-ribbon';
import { MarkdownRibbon } from './ribbons/markdown-ribbon/markdown-ribbon';
import { TerminalRibbon } from './ribbons/terminal-ribbon/terminal-ribbon';

/**
 * Represents the contextual ribbon strip, whose content depends on the active tab type. The
 * settings tab (and the absence of any tab) deliberately shows no ribbon.
 */
@Component({
  selector: 'app-ribbon-strip',
  imports: [DirectoryRibbon, CodeRibbon, MarkdownRibbon, TerminalRibbon, AgentRibbon],
  templateUrl: './ribbon-strip.html',
  styleUrl: './ribbon-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStrip {
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
