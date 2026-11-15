import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { ChartSeries } from '../../../../charts/chart-series';
import { LineChart } from '../../../../charts/line-chart/line-chart';
import { formatAxisRate } from '../../../../readings/format';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../../dashboard-card/dashboard-card';

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
   * Gets the received graph's one line, in the accent, as its badge is.
   */
  protected readonly received: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      { label: 'Received', values: this.readings.networkRxHistory(), emphasis: 'primary' },
    ],
  );

  /**
   * Gets the sent graph's one line, in grey, as its badge is.
   */
  protected readonly sent: Signal<readonly ChartSeries[]> = computed((): readonly ChartSeries[] => [
    { label: 'Sent', values: this.readings.networkTxHistory(), emphasis: 'secondary' },
  ]);
}
