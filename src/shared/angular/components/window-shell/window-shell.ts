import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { ContentHost } from '@shared/angular/components/content-host/content-host';
import { RibbonStripContainer } from '@shared/angular/components/strips/ribbon-strip/ribbon-strip-container/ribbon-strip-container';
import { StatusStripContainer } from '@shared/angular/components/strips/status-strip/status-strip-container/status-strip-container';
import { TitleStripContainer } from '@shared/angular/components/strips/title-strip/title-strip-container/title-strip-container';
import { FeatureChrome, FeatureRegistry } from '@shared/angular/services/feature-registry';
import { Tab } from '@shared/angular/services/tabs/tab';
import { SHELL_WINDOW, Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Lays out one Studio window's frame: its title strip, the ribbon and status strip of its active tab,
 * and its tabs' content (#1587). Every window shows one — the first inside the root shell, every other
 * in a window of its own — each bound to its own window through {@link SHELL_WINDOW}.
 */
@Component({
  selector: 'app-window-shell',
  imports: [TitleStripContainer, RibbonStripContainer, ContentHost, StatusStripContainer],
  templateUrl: './window-shell.html',
  styleUrl: './window-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WindowShell {
  /**
   * Holds the tab registry.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the registry of features, which says which strips a tab type shows.
   */
  private readonly registry: FeatureRegistry = inject(FeatureRegistry);

  /**
   * Holds the window this frame belongs to.
   */
  private readonly windowId: string = inject(SHELL_WINDOW);

  /**
   * Gets a value indicating whether the window has any tabs, which is when it shows its frame.
   */
  protected readonly hasTabs: Signal<boolean> = computed(
    (): boolean => this.tabs.tabsIn(this.windowId)().length > 0,
  );

  /**
   * Gets which strips the window's active tab shows.
   */
  protected readonly activeChrome: Signal<FeatureChrome> = computed((): FeatureChrome => {
    const id: string | undefined = this.tabs.activeTabIdIn(this.windowId)();
    const tab: Tab | undefined = id === undefined ? undefined : this.tabs.get(id);
    return this.registry.chromeFor(tab?.type);
  });
}
