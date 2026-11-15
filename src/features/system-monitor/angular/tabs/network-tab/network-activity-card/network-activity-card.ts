import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import {
  NETWORK_SAMPLE_INTERVAL_MS,
  NetworkInterfaceReading,
} from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../charts/chart-series';
import { LineChart } from '../../../charts/line-chart/line-chart';
import { formatAxisRate, formatRate } from '../../../readings/format';
import { SystemMonitorNetwork } from '../../../readings/system-monitor-network';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Represents the Network view's Interface Activity card: the chosen interface's download and upload
 * over Graph History, on one graph, each named with its latest rate.
 */
@Component({
  selector: 'app-system-monitor-network-activity-card',
  imports: [DashboardBadge, DashboardCard, LineChart],
  templateUrl: './network-activity-card.html',
  styleUrl: './network-activity-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkActivityCard {
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
  protected readonly format: (value: number) => string = formatAxisRate;

  /**
   * Gets the time between readings, for the graph's timescale.
   */
  protected readonly intervalMs: number = NETWORK_SAMPLE_INTERVAL_MS;

  /**
   * Gets the card's heading, naming the interface.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const id: string | undefined = this.network.selected()?.id;
    return id === undefined ? 'Interface Activity' : `Interface Activity — ${id}`;
  });

  /**
   * Gets the download and upload, each named with its latest rate.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => {
      const history: readonly NetworkInterfaceReading[] = this.network.selectedHistory();
      const latest: NetworkInterfaceReading | null = this.network.selectedReading();
      return [
        {
          label: `Download ${formatRate(latest?.rxBytesPerSecond ?? 0)}`,
          values: history.map(
            (reading: NetworkInterfaceReading): number => reading.rxBytesPerSecond,
          ),
          emphasis: 'primary',
        },
        {
          label: `Upload ${formatRate(latest?.txBytesPerSecond ?? 0)}`,
          values: history.map(
            (reading: NetworkInterfaceReading): number => reading.txBytesPerSecond,
          ),
          emphasis: 'secondary',
        },
      ];
    },
  );
}
