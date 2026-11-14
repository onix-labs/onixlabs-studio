import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { SystemInfo } from '@shared/api/system-monitor-channels';
import { MetricTile } from '../../metric-tile/metric-tile';
import { formatBytes } from '../../readings/format';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { SystemMonitorTabId } from '../system-monitor-tab-id';

/**
 * Represents the System Monitor's Overview tab: the machine described in a line, then one graph per
 * resource. Each graph opens its resource's own tab, where it is shown in full.
 */
@Component({
  selector: 'app-system-monitor-overview-tab',
  imports: [MetricTile],
  templateUrl: './overview-tab.html',
  styleUrl: './overview-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewTab {
  /**
   * Gets the tab identities, exposed for the template.
   */
  protected readonly Tab: typeof SystemMonitorTabId = SystemMonitorTabId;

  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the machine described in a line (`Intel Core i9 · 16 cores · 32.0 GB · macOS 26.6`), or null
   * until it has been read.
   */
  protected readonly machine: Signal<string | null> = computed((): string | null => {
    const info: SystemInfo | null = this.readings.info();
    if (info === null) {
      return null;
    }
    return [
      info.cpuModel,
      `${info.logicalCores} cores`,
      formatBytes(info.totalMemoryBytes),
      info.os,
    ]
      .filter((part: string): boolean => part.length > 0)
      .join(' · ');
  });

  /**
   * Emits the tab a graph asks to open.
   */
  public readonly open: OutputEmitterRef<SystemMonitorTabId> = output<SystemMonitorTabId>();
}
