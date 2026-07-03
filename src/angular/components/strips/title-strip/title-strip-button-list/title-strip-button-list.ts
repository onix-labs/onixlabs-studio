import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { RepositoryOpener } from '@shared/angular/services/repositories/repository-opener';
import { Settings } from '@shared/angular/services/settings/settings';
import { WelcomeModal } from '@shared/angular/services/welcome-modal/welcome-modal';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Icon } from '@shared/angular/icons/icon';
import { TitleStripButton } from '../title-strip-button/title-strip-button';

/**
 * Represents the action buttons in the title strip: the settings button, followed by either the
 * single welcome button or the quick-action launcher buttons (open, new code/markdown/terminal/agent)
 * depending on the {@link Settings.showLauncherActions} preference.
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
   * Holds the opener that routes a chosen file or folder to the right surface.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the opener that opens a git repository into a source-control tab.
   */
  private readonly repositoryOpener: RepositoryOpener = inject(RepositoryOpener);

  /**
   * Holds the settings service the launcher mode is read from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets a value indicating whether the settings tab is currently open.
   */
  protected readonly isSettingsOpen: Signal<boolean> = this.tabsService.isSettingsOpen;

  /**
   * Gets a value indicating whether the quick-action launcher buttons replace the welcome button.
   */
  protected readonly showLauncherActions: Signal<boolean> = this.settings.showLauncherActions;

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

  /**
   * Shows the system open dialog and routes the chosen file or folder to the right surface.
   */
  protected openFiles(): void {
    void this.fileOpener.openInteractive();
  }

  /**
   * Shows the open-repository dialog and opens the chosen git repository in a source-control tab.
   */
  protected openRepository(): void {
    void this.repositoryOpener.openInteractive();
  }

  /**
   * Opens a new code tab.
   */
  protected newCode(): void {
    this.tabsService.open('code');
  }

  /**
   * Opens a new markdown tab.
   */
  protected newMarkdown(): void {
    this.tabsService.open('markdown');
  }

  /**
   * Opens a new terminal tab.
   */
  protected newTerminal(): void {
    this.tabsService.open('terminal');
  }

  /**
   * Opens a new agent tab.
   */
  protected newAgent(): void {
    this.tabsService.open('agent');
  }
}
