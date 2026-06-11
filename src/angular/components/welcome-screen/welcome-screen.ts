import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TabType } from '../../services/tabs/tab';
import { Tabs } from '../../services/tabs/tabs';

/**
 * Represents the welcome screen shown in place of the application chrome when no tabs are open. It
 * presents the application identity and the actions that get the user from a cold start into a tab.
 */
@Component({
  selector: 'app-welcome-screen',
  imports: [],
  templateUrl: './welcome-screen.html',
  styleUrl: './welcome-screen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeScreen {
  /**
   * Holds the tab registry the welcome actions open into.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Opens a directory or file from the file system.
   *
   * For now this simply opens a new directory tab; TODO: wire this to an Electron open dialog and
   * route the selection into tabs.
   */
  protected openFiles(): void {
    this.tabsService.open('directory');
  }

  /**
   * Creates and activates a new tab of the given type, dismissing the welcome screen.
   * @param type The type of tab to create.
   */
  protected create(type: TabType): void {
    this.tabsService.open(type);
  }
}
