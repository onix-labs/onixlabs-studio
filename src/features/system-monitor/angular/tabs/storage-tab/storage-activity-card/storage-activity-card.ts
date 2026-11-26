import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { STORAGE_SAMPLE_INTERVAL_MS } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../charts/chart-series';
import { LineChart } from '../../../charts/line-chart/line-chart';
import { formatAxisRate, formatRate } from '../../../readings/format';
import { StorageTotals, SystemMonitorStorage } from '../../../readings/system-monitor-storage';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Represents the Storage view's Disk Activity card: the bytes read and written each second across
 * every device, over Graph History.
 */
@Component({
  selector: 'app-system-monitor-storage-activity-card',
  imports: [DashboardCard, DashboardBadge, LineChart],
  templateUrl: './storage-activity-card.html',
  styleUrl: './storage-activity-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageActivityCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings, for Graph History's label.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Holds the view's storage readings.
   */
  private readonly storage: SystemMonitorStorage = inject(SystemMonitorStorage);

  /**
   * Gets the axis's formatting.
   */
  protected readonly format: (value: number) => string = formatAxisRate;

  /**
   * Gets the time between readings, for the graph's timescale.
   */
  protected readonly intervalMs: number = STORAGE_SAMPLE_INTERVAL_MS;

  /**
   * Gets the reads and writes, each named with its latest rate.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => {
      const history: readonly StorageTotals[] = this.storage.totalsHistory();
      const latest: StorageTotals = this.storage.totals();
      return [
        {
          label: `Read ${formatRate(latest.readBytesPerSecond)}`,
          values: history.map((totals: StorageTotals): number => totals.readBytesPerSecond),
          emphasis: 'primary',
        },
        {
          label: `Write ${formatRate(latest.writeBytesPerSecond)}`,
          values: history.map((totals: StorageTotals): number => totals.writeBytesPerSecond),
          emphasis: 'secondary',
        },
      ];
    },
  );
}
