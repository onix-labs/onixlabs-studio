import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusBar, StatusSegment } from '@shared/angular/services/status-bar/status-bar';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { StatusStripLspMenu } from '../status-strip-lsp-menu/status-strip-lsp-menu';
import { StatusStripNotificationsMenu } from '../status-strip-notifications-menu/status-strip-notifications-menu';

/**
 * Represents the status strip, which shows contextual segments published by the active view and
 * falls back to the active tab (or a ready indicator) when nothing has been published. The language
 * servers running for the active workspace and the notification centre are surfaced by the embedded
 * drop-up menus.
 */
@Component({
  selector: 'app-status-strip-container',
  imports: [AppIcon, StatusStripLspMenu, StatusStripNotificationsMenu],
  templateUrl: './status-strip-container.html',
  styleUrl: './status-strip-container.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStripContainer {
  /**
   * Holds the status bar content registry.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the tab registry, used to derive a default leading segment.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Gets the leading status segments, defaulting to the active tab (or a ready indicator) when
   * nothing has been published.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const published: readonly StatusSegment[] = this.statusBar.leading();
      if (published.length > 0) {
        return published;
      }

      const activeTab: Tab | undefined = this.tabsService.activeTab();
      if (activeTab === undefined) {
        return [{ id: 'ready', text: 'Ready' }];
      }

      return [{ id: 'active-tab', text: activeTab.title, icon: activeTab.icon }];
    },
  );

  /**
   * Gets the trailing status segments.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = this.statusBar.trailing;
}
