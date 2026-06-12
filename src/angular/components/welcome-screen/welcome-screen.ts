import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { RecentItem, RecentItems } from '../../services/recent-items/recent-items';
import { TabType } from '../../services/tabs/tab';
import { Tabs } from '../../services/tabs/tabs';
import { WelcomeModal } from '../../services/welcome-modal/welcome-modal';

/**
 * Represents the welcome screen: the entry surface that gets the user from a cold start into a tab.
 *
 * It renders full-bleed when no tabs are open, and as a dismissable modal over the existing content
 * when summoned from the title strip's new-tab button. Either way it presents the application
 * identity, the create/open actions, and the list of recent items.
 */
@Component({
  selector: 'app-welcome-screen',
  imports: [],
  templateUrl: './welcome-screen.html',
  styleUrl: './welcome-screen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class WelcomeScreen {
  /**
   * Holds the tab registry the welcome actions open into.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the welcome modal state, dismissed once an action routes the user into a tab.
   */
  private readonly welcomeModal: WelcomeModal = inject(WelcomeModal);

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
   * Opens a directory or file from the file system, then dismisses the welcome screen.
   *
   * For now this simply opens a new directory tab; TODO: wire this to an Electron open dialog and
   * route the selection into tabs.
   */
  protected openFiles(): void {
    this.tabsService.open('directory');
    this.welcomeModal.close();
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
   * Closes the welcome screen when it is shown as a dismissable modal.
   */
  protected close(): void {
    if (this.dismissable()) {
      this.welcomeModal.close();
    }
  }

  /**
   * Handles a click on the backdrop, dismissing the modal when the click falls outside the panel.
   * @param event The originating click event.
   */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  /**
   * Handles the Escape key, dismissing the modal when it can be dismissed.
   */
  protected onEscape(): void {
    this.close();
  }
}
