import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { WelcomeModal } from '../../../../services/welcome-modal/welcome-modal';
import { Tabs } from '../../../../services/tabs/tabs';
import { Icon } from '../../../../icons/icon';
import { TitleStripButton } from '../title-strip-button/title-strip-button';

/**
 * Represents the action buttons in the title strip (settings and new-tab).
 */
@Component({
  selector: 'app-title-strip-button-list',
  imports: [TitleStripButton],
  templateUrl: './title-strip-button-list.html',
  styleUrl: './title-strip-button-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripButtonList {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the tab registry the buttons operate on.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the welcome modal summoned by the new-tab button.
   */
  private readonly welcomeModal: WelcomeModal = inject(WelcomeModal);

  /**
   * Gets a value indicating whether the settings tab is currently open.
   */
  protected readonly isSettingsOpen: Signal<boolean> = this.tabsService.isSettingsOpen;

  /**
   * Opens, or re-activates, the singleton settings tab.
   */
  protected openSettings(): void {
    this.tabsService.open('settings');
  }

  /**
   * Summons the welcome screen as a modal, from which a new tab can be created.
   */
  protected openNewTab(): void {
    this.welcomeModal.open();
  }
}
