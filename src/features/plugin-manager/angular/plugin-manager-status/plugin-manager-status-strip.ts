import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { canUpdate } from '@shared/angular/components/plugin-action/plugin-action-rules';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { PluginSummary } from '@shared/api/plugin-channels';
import { PluginBrowse } from '../plugin-browse/plugin-browse';

/**
 * Shows the Plugin Manager's status (#882), all at the end of the strip: first how much of the
 * catalogue is installed — "9 of 24 installed", counted over the whole catalogue whatever the list is
 * filtered to, and the last to drop out of a narrow strip — then, each only while it applies, plugins
 * being installed or removed, installed plugins with an update, and how many of the catalogue a search
 * or filter is showing, so a short list explains itself.
 */
@Component({
  selector: 'app-plugin-manager-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays its segment groups out in its own flex row.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginManagerStatusStrip {
  /**
   * Holds the browsing state, which owns the catalogue and its filters.
   */
  private readonly browse: PluginBrowse = inject(PluginBrowse);

  /**
   * Gets the end-aligned segments: the installed count, then work in progress, updates available, and
   * the filtered count, each while it applies.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const all: readonly PluginSummary[] = this.browse.all();
      const segments: StatusSegment[] = [
        {
          id: 'plugins-installed',
          text: `${this.browse.installedCount()} of ${all.length} installed`,
        },
      ];
      const busy: number = all.filter(
        (plugin: PluginSummary): boolean => plugin.state === 'busy',
      ).length;
      if (busy > 0) {
        segments.push({ id: 'plugins-busy', text: `Installing ${busy}` });
      }
      // The same rule the rows' Update buttons follow, so the count cannot disagree with them.
      const updates: number = all.filter(canUpdate).length;
      if (updates > 0) {
        segments.push({
          id: 'plugins-updates',
          text: updates === 1 ? '1 update available' : `${updates} updates available`,
        });
      }
      if (this.browse.narrowed()) {
        segments.push({
          id: 'plugins-showing',
          text: `Showing ${this.browse.visible().length} of ${all.length}`,
        });
      }
      return segments;
    },
  );
}
