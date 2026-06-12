import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Tabs } from '../../services/tabs/tabs';
import { WelcomeModal } from '../../services/welcome-modal/welcome-modal';
import { ContentHost } from '../content-host/content-host';
import { RibbonStrip } from '../strips/ribbon-strip/ribbon-strip';
import { StatusStrip } from '../strips/status-strip/status-strip';
import { TitleStripContainer } from '../strips/title-strip/title-strip-container/title-strip-container';
import { WelcomeScreen } from '../welcome-screen/welcome-screen';

/**
 * Represents the application root, composing the chrome strips and the content host, or the welcome
 * screen when no tabs are open.
 */
@Component({
  selector: 'app-root',
  imports: [RibbonStrip, StatusStrip, TitleStripContainer, ContentHost, WelcomeScreen],
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
   * Holds the welcome modal state used to summon the welcome screen over the existing content.
   */
  private readonly welcomeModal: WelcomeModal = inject(WelcomeModal);

  /**
   * Gets a value indicating whether any tab is open. When none are, the chrome strips and content
   * host are replaced by the welcome screen.
   */
  protected readonly hasTabs: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length > 0,
  );

  /**
   * Gets a value indicating whether the welcome screen should be shown. It shows at a cold start
   * (no tabs) and whenever it is explicitly summoned as a modal over the content.
   */
  protected readonly showWelcome: Signal<boolean> = computed(
    (): boolean => !this.hasTabs() || this.welcomeModal.isOpen(),
  );

  /**
   * Gets a value indicating whether the active tab is the settings tab, which is shown full-bleed
   * without the ribbon and status strips.
   */
  protected readonly isSettingsActive: Signal<boolean> = computed(
    (): boolean => this.tabsService.activeTab()?.type === 'settings',
  );
}
