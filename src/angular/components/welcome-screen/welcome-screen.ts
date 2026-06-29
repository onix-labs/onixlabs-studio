import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { FileOpener } from '../../services/file-opener/file-opener';
import { RecentItem, RecentItems } from '../../services/recent-items/recent-items';
import { RepositoryOpener } from '../../services/repositories/repository-opener';
import { TabType } from '../../services/tabs/tab';
import { Tabs } from '../../services/tabs/tabs';
import { WelcomeModal } from '../../services/welcome-modal/welcome-modal';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '../shared/modal/modal';

/**
 * Represents the welcome screen: the entry surface that gets the user from a cold start into a tab.
 *
 * It renders full-bleed when no tabs are open, and as a dismissable modal over the existing content
 * when summoned from the title strip's new-tab button. Either way it presents the application
 * identity, the create/open actions, and the list of recent items. The backdrop, dismissal, and
 * animation are provided by the reusable {@link Modal}; the welcome screen overrides its theming for
 * the frosted panel and projects the drifting orbs behind it.
 */
@Component({
  selector: 'app-welcome-screen',
  imports: [AppIcon, Modal],
  templateUrl: './welcome-screen.html',
  styleUrl: './welcome-screen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeScreen {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the tab registry the welcome actions open into.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the welcome modal state, dismissed once an action routes the user into a tab.
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
   * Holds the recent-items registry surfaced in the right-hand panel.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Gets the recent items shown in the right-hand panel.
   */
  protected readonly recent: Signal<readonly RecentItem[]> = this.recentItems.items;

  /**
   * Gets a value indicating whether the welcome screen can be dismissed. It can only be dismissed
   * when at least one tab is open behind it; at a cold start there is nothing to return to.
   */
  protected readonly dismissable: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length > 0,
  );

  /**
   * Gets a value indicating whether the welcome screen is currently shown. The overlay stays mounted
   * so it can animate in and out; this drives its visible state. It is shown at a cold start (no tabs)
   * and whenever it is explicitly summoned as a modal over the content.
   */
  protected readonly visible: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length === 0 || this.welcomeModal.isOpen(),
  );

  /**
   * Gets a value indicating whether the ambient backdrop (the drifting orbs) is shown. It appears only
   * at a cold start or when no tabs are open — never when the welcome screen is summoned as a modal
   * over existing content.
   */
  protected readonly ambient: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length === 0,
  );

  /**
   * Shows the system open dialog and routes the chosen file or folder: a directory opens in the
   * workspace, a markdown file in a markdown tab, and any other text file in a code tab. The welcome
   * screen is dismissed only when something was opened, so cancelling returns to it.
   */
  protected async openFiles(): Promise<void> {
    if (await this.fileOpener.openInteractive()) {
      this.welcomeModal.close();
    }
  }

  /**
   * Creates and activates a new tab of the given type, dismissing the welcome screen.
   * @param type The type of tab to create.
   */
  protected create(type: TabType): void {
    this.tabsService.open(type);
    this.welcomeModal.close();
  }

  /**
   * Shows the open-repository dialog and opens the chosen git repository in a source-control tab. The
   * welcome screen is dismissed only when a repository was opened, so cancelling returns to it.
   */
  protected async openRepository(): Promise<void> {
    if (await this.repositoryOpener.openInteractive()) {
      this.welcomeModal.close();
    }
  }

  /**
   * Closes the welcome screen when it is shown as a dismissable modal. Invoked by the modal's dismiss
   * output, which only fires when dismissal is permitted; the guard keeps it safe regardless.
   */
  protected close(): void {
    if (this.dismissable()) {
      this.welcomeModal.close();
    }
  }
}
