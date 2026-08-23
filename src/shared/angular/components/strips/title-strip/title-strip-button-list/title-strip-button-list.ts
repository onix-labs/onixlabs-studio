import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { WelcomeModal } from '@shared/angular/services/welcome-modal/welcome-modal';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Icon } from '@shared/angular/icons/icon';
import { TitleStripButton } from '../title-strip-button/title-strip-button';
import { TitleStripMenu } from '../title-strip-menu/title-strip-menu';
import { TitleStripTabMenu } from '../title-strip-tab-menu/title-strip-tab-menu';

/**
 * Represents the action buttons in the title strip: the application menu, the settings button, the
 * welcome button that summons the welcome screen for creating a new tab, then the Mission Control
 * button that opens the all-agents management view.
 */
@Component({
  selector: 'app-title-strip-button-list',
  imports: [TitleStripButton, TitleStripMenu, TitleStripTabMenu],
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
   * Opens, or re-activates, the singleton Mission Control tab that manages every open tab's agent from
   * one view.
   */
  protected openMissionControl(): void {
    this.tabsService.open('mission-control');
  }

  /**
   * Summons the welcome screen as a modal, from which a new tab can be created.
   */
  protected openNewTab(): void {
    this.welcomeModal.open();
  }
}
