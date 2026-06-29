import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ContentHost } from '../content-host/content-host';
import { RibbonStripContainer } from '../strips/ribbon-strip/ribbon-strip-container/ribbon-strip-container';
import { StatusStripContainer } from '../strips/status-strip/status-strip-container/status-strip-container';
import { TitleStripContainer } from '../strips/title-strip/title-strip-container/title-strip-container';
import { WelcomeScreen } from '../welcome-screen/welcome-screen';

/**
 * Represents the application root, composing the chrome strips and the content host, or the welcome
 * screen when no tabs are open.
 */
@Component({
  selector: 'app-root',
  imports: [RibbonStripContainer, StatusStripContainer, TitleStripContainer, ContentHost, WelcomeScreen],
  templateUrl: './root.html',
  styleUrl: './root.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Root {
  /**
   * Holds the tab registry used to adapt the layout to the active tab.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Gets a value indicating whether any tab is open. When none are, the chrome strips and content
   * host are replaced by the welcome screen.
   */
  protected readonly hasTabs: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length > 0,
  );

  /**
   * Gets a value indicating whether the active tab is the settings tab, which is shown full-bleed
   * without the ribbon and status strips.
   */
  protected readonly isSettingsActive: Signal<boolean> = computed(
    (): boolean => this.tabsService.activeTab()?.type === 'settings',
  );
}
