import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { NETWORK_SAMPLE_INTERVAL_MS } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../charts/chart-series';
import { LineChart } from '../../../charts/line-chart/line-chart';
import { formatAxisCount, formatCount } from '../../../readings/format';
import { NetworkTotals, SystemMonitorNetwork } from '../../../readings/system-monitor-network';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Represents the Network view's Packets card: the packets received and sent each second across every
 * interface but the loopback, over Graph History.
 */
@Component({
  selector: 'app-system-monitor-network-packets-card',
  imports: [DashboardCard, DashboardBadge, LineChart],
  templateUrl: './network-packets-card.html',
  styleUrl: './network-packets-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkPacketsCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings, for Graph History's label.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Holds the view's network readings.
   */
  private readonly network: SystemMonitorNetwork = inject(SystemMonitorNetwork);

  /**
   * Gets the axis's formatting.
   */
  protected readonly format: (value: number) => string = (value: number): string =>
    `${formatAxisCount(value)}/s`;

  /**
   * Gets the time between readings, for the graph's timescale.
   */
  protected readonly intervalMs: number = NETWORK_SAMPLE_INTERVAL_MS;

  /**
   * Gets the packets received and sent, each named with its latest rate.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => {
      const history: readonly NetworkTotals[] = this.network.totalsHistory();
      const latest: NetworkTotals = this.network.totals();
      return [
        {
          label: `Received ${formatCount(latest.rxPacketsPerSecond)}/s`,
          values: history.map((totals: NetworkTotals): number => totals.rxPacketsPerSecond),
          emphasis: 'primary',
        },
        {
          label: `Sent ${formatCount(latest.txPacketsPerSecond)}/s`,
          values: history.map((totals: NetworkTotals): number => totals.txPacketsPerSecond),
          emphasis: 'secondary',
        },
      ];
    },
  );
}
