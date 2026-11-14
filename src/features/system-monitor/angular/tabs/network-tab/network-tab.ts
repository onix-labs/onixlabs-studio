import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { InterfaceMetric } from '@shared/api/system-monitor-channels';
import { MetricTile } from '../../metric-tile/metric-tile';
import { formatRate } from '../../readings/format';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';

/**
 * Describes one interface's row.
 */
interface InterfaceRow {
  /**
   * Gets the interface's name.
   */
  readonly name: string;

  /**
   * Gets the received throughput, formatted.
   */
  readonly received: string;

  /**
   * Gets the sent throughput, formatted.
   */
  readonly sent: string;

  /**
   * Gets whether the interface is idle, so its row can recede.
   */
  readonly idle: boolean;
}

/**
 * Represents the System Monitor's Network tab: received and sent throughput across every interface,
 * and each interface's own, busiest first.
 */
@Component({
  selector: 'app-system-monitor-network-tab',
  imports: [MetricTile],
  templateUrl: './network-tab.html',
  styleUrl: './network-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkTab {
  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets one row per interface.
   */
  protected readonly interfaces: Signal<readonly InterfaceRow[]> = computed(
    (): readonly InterfaceRow[] =>
      this.readings.interfaces().map((metric: InterfaceMetric): InterfaceRow => ({
        name: metric.name,
        received: formatRate(metric.rxBytesPerSec),
        sent: formatRate(metric.txBytesPerSec),
        idle: metric.rxBytesPerSec === 0 && metric.txBytesPerSec === 0,
      })),
  );
}
