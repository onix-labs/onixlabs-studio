import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { TabType } from '../../../services/tabs/tab';
import { Tabs } from '../../../services/tabs/tabs';

/**
 * Specifies the placeholder ribbon tools shown for each tab type.
 */
const RIBBON_TOOLS: Readonly<Record<TabType, readonly string[]>> = {
  directory: ['Build', 'Run', 'Debug', 'Search'],
  code: ['Save', 'Undo', 'Redo', 'Format'],
  markdown: ['Bold', 'Italic', 'Heading', 'List'],
  terminal: ['Copy', 'Paste', 'Clear', 'New'],
  agent: ['New chat', 'Stop', 'Model'],
  settings: [],
};

/**
 * Represents the contextual ribbon strip, whose tools depend on the active tab type.
 */
@Component({
  selector: 'app-ribbon-strip',
  imports: [],
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
   * Gets the placeholder tools for the active tab type.
   */
  protected readonly tools: Signal<readonly string[]> = computed((): readonly string[] => {
    const type: TabType | undefined = this.tabsService.activeTab()?.type;
    return type === undefined ? [] : RIBBON_TOOLS[type];
  });
}
