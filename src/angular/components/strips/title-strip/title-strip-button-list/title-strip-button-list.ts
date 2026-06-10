import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import {
  CREATABLE_TAB_TYPES,
  TAB_TYPE_METADATA,
  TabType,
  TabTypeMetadata,
} from '../../../../services/tabs/tab';
import { Tabs } from '../../../../services/tabs/tabs';
import { TitleStripButton } from '../title-strip-button/title-strip-button';

/**
 * Represents the action buttons in the title strip (settings, open, and new-tab).
 */
@Component({
  selector: 'app-title-strip-button-list',
  imports: [TitleStripButton, CdkMenuTrigger, CdkMenu, CdkMenuItem],
  templateUrl: './title-strip-button-list.html',
  styleUrl: './title-strip-button-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripButtonList {
  /**
   * Holds the tab registry the buttons operate on.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Gets a value indicating whether the settings tab is currently open.
   */
  protected readonly isSettingsOpen: Signal<boolean> = this.tabsService.isSettingsOpen;

  /**
   * Gets the tab types offered by the new-tab menu.
   */
  protected readonly creatableTypes: readonly TabType[] = CREATABLE_TAB_TYPES;

  /**
   * Gets the display metadata for every tab type.
   */
  protected readonly metadata: Readonly<Record<TabType, TabTypeMetadata>> = TAB_TYPE_METADATA;

  /**
   * Opens, or re-activates, the singleton settings tab.
   */
  protected openSettings(): void {
    this.tabsService.open('settings');
  }

  /**
   * Opens files and directories.
   *
   * TODO: Wire this to an Electron open dialog and route the selection into tabs.
   */
  protected openFiles(): void {
    // Intentionally left as a placeholder until the file/directory open flow is implemented.
  }

  /**
   * Opens a new tab of the given type.
   * @param type The type of tab to open.
   */
  protected open(type: TabType): void {
    this.tabsService.open(type);
  }
}
