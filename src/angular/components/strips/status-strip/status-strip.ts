import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusBar, StatusSegment } from '../../../services/status-bar/status-bar';
import { Tab } from '../../../services/tabs/tab';
import { Tabs } from '../../../services/tabs/tabs';
import { AppIcon } from '../../shared/icon/app-icon';

/**
 * Represents the status strip, which shows contextual segments published by the active view and
 * falls back to the active tab (or a ready indicator) when nothing has been published.
 */
@Component({
  selector: 'app-status-strip',
  imports: [AppIcon],
  templateUrl: './status-strip.html',
  styleUrl: './status-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStrip {
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
