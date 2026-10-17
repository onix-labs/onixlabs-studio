import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import {
  SystemMonitorSummary,
  SystemMonitorView,
} from '../system-monitor-view/system-monitor-view';

/**
 * Formats a count with the reader's digit grouping.
 */
const COUNT: Intl.NumberFormat = new Intl.NumberFormat();

/**
 * The System Monitor tab's status-strip readout (#882), for the log: on the left the session being
 * read; at the end how many of its records the filters show, its errors and warnings and the selection
 * (each while there are any), then Studio's own CPU and memory — last, so a narrow strip drops them
 * first, since the tiles above show them too.
 *
 * Mounted by the status strip through the System Monitor view's own injector, from which it reads the
 * view itself.
 */
@Component({
  selector: 'app-system-monitor-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemMonitorStatusStrip {
  /**
   * Holds the view whose log and readings are reported.
   */
  private readonly view: SystemMonitorView = inject(SystemMonitorView);

  /**
   * Gets the start-aligned segments: the log session being read.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => [
      { id: 'monitor-session', text: this.view.summary().session, shrink: 'end' },
    ],
  );

  /**
   * Gets the end-aligned segments: the record count, the errors, warnings and selection while there
   * are any, then Studio's own CPU and memory.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const summary: SystemMonitorSummary = this.view.summary();
      const records: string =
        summary.records === 1 ? '1 record' : `${COUNT.format(summary.records)} records`;
      const segments: StatusSegment[] = [
        {
          id: 'monitor-records',
          text:
            summary.shown === summary.records
              ? records
              : `Showing ${COUNT.format(summary.shown)} of ${records}`,
        },
      ];
      if (summary.errors > 0) {
        segments.push({
          id: 'monitor-errors',
          text: summary.errors === 1 ? '1 error' : `${COUNT.format(summary.errors)} errors`,
        });
      }
      if (summary.warnings > 0) {
        segments.push({
          id: 'monitor-warnings',
          text: summary.warnings === 1 ? '1 warning' : `${COUNT.format(summary.warnings)} warnings`,
        });
      }
      if (summary.selected > 0) {
        segments.push({
          id: 'monitor-selected',
          text: `${COUNT.format(summary.selected)} selected`,
        });
      }
      if (summary.appCpu !== null) {
        segments.push({
          id: 'monitor-cpu',
          text: `Studio CPU ${summary.appCpu}`,
          title: "Studio's own share of the CPU",
        });
      }
      if (summary.appMemory !== null) {
        segments.push({
          id: 'monitor-memory',
          text: `Studio memory ${summary.appMemory}`,
          title: "Studio's own memory",
        });
      }
      return segments;
    },
  );
}
