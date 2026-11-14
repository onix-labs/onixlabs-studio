import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { InterfaceMetric } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../../charts/chart-series';
import { LineChart } from '../../../../charts/line-chart/line-chart';
import { formatAxisRate, formatRate } from '../../../../readings/format';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * The number of interfaces the card lists.
 */
const SHOWN: number = 3;

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
}

/**
 * Represents the Overview's Network card: received and sent throughput over time on one axis (the same
 * unit), named by its badges in the lines' colours (Received in the accent, Sent in grey), and the three
 * busiest interfaces at its foot.
 */
@Component({
  selector: 'app-system-monitor-network-card',
  imports: [DashboardCard, DashboardBadge, LineChart],
  templateUrl: './network-card.html',
  styleUrl: './network-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets how a throughput is written, on the axis and in the readout.
   */
  protected readonly rate: (value: number) => string = formatAxisRate;

  /**
   * Gets the graph's series: received, emphasised, and sent beside it.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      { label: 'Received', values: this.readings.networkRxHistory(), emphasis: 'primary' },
      { label: 'Sent', values: this.readings.networkTxHistory(), emphasis: 'secondary' },
    ],
  );

  /**
   * Gets the busiest interfaces' rows; the readings already come busiest first.
   */
  protected readonly interfaces: Signal<readonly InterfaceRow[]> = computed(
    (): readonly InterfaceRow[] =>
      this.readings
        .interfaces()
        .slice(0, SHOWN)
        .map((metric: InterfaceMetric): InterfaceRow => ({
          name: metric.name,
          received: formatRate(metric.rxBytesPerSec),
          sent: formatRate(metric.txBytesPerSec),
        })),
  );
}
