import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { Icon } from '@shared/angular/icons/icon';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { PluginBrowse } from '../plugin-browse/plugin-browse';

/**
 * Shows the Plugin Manager's counts: how many plugins exist, how many are installed, and how many are
 * not.
 *
 * ⚠️ The counts are of the **catalogue**, not of the filtered list. A count that moved as you typed
 * would be answering a different question from the one the strip appears to ask — how much is there —
 * and the list already says how many rows it is showing.
 */
@Component({
  selector: 'app-plugin-manager-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" />`,
  // The host must add no box of its own: the strip lays its segment groups out in its own flex row.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginManagerStatusStrip {
  /**
   * Holds the browsing state, which owns the catalogue counts.
   */
  private readonly browse: PluginBrowse = inject(PluginBrowse);

  /**
   * Gets the start-aligned segments: available, installed, and not installed.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const total: number = this.browse.all().length;
      const installed: number = this.browse.installedCount();
      return [
        {
          id: 'plugins-available',
          text: `${total} ${total === 1 ? 'plugin' : 'plugins'} available`,
          icon: Icon.WELCOME_PLUGINS,
        },
        { id: 'plugins-installed', text: `${installed} installed` },
        { id: 'plugins-not-installed', text: `${this.browse.notInstalledCount()} not installed` },
      ];
    },
  );
}
