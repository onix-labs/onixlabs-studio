import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { RibbonAlignment, Settings } from '../../../services/settings/settings';
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
  host: {
    '[class.ribbon-strip--align-center]': "alignment() === 'center'",
    '[class.ribbon-strip--align-right]': "alignment() === 'right'",
  },
})
export class RibbonStrip {
  /**
   * Holds the tab registry used to resolve the active tab type.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the settings service supplying the ribbon alignment.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the type of the active tab, or `undefined` when no tab is active.
   */
  protected readonly activeType: Signal<TabType | undefined> = computed(
    (): TabType | undefined => this.tabsService.activeTab()?.type,
  );

  /**
   * Gets the alignment of the ribbon's controls within the strip.
   */
  protected readonly alignment: Signal<RibbonAlignment> = this.settings.ribbonAlignment;
}
