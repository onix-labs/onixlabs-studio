import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import {
  STORAGE_SAMPLE_INTERVAL_MS,
  StorageDeviceReading,
} from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../charts/chart-series';
import { LineChart } from '../../../charts/line-chart/line-chart';
import { formatCount, formatPercent, formatRate, formatShare } from '../../../readings/format';
import { SystemMonitorStorage } from '../../../readings/system-monitor-storage';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one live figure under the graph.
 */
interface UtilisationStat {
  /**
   * Gets the figure's icon.
   */
  readonly icon: Icon;

  /**
   * Gets the figure's label.
   */
  readonly label: string;

  /**
   * Gets the figure's value.
   */
  readonly value: string;
}

/**
 * Represents the Storage view's Device Utilisation card: how busy the chosen drive has been over Graph
 * History, then its live figures — temperature where the platform reports it, reads, writes and
 * operations.
 */
@Component({
  selector: 'app-system-monitor-storage-utilisation-card',
  imports: [AppIcon, DashboardBadge, DashboardCard, LineChart],
  templateUrl: './storage-utilisation-card.html',
  styleUrl: './storage-utilisation-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageUtilisationCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the view's storage readings.
   */
  private readonly storage: SystemMonitorStorage = inject(SystemMonitorStorage);

  /**
   * Gets the axis's formatting.
   */
  protected readonly percent: (value: number) => string = formatPercent;

  /**
   * Gets the time between readings, for the graph's timescale.
   */
  protected readonly intervalMs: number = STORAGE_SAMPLE_INTERVAL_MS;

  /**
   * Gets the chosen drive's utilisation now, or a dash before it is known.
   */
  protected readonly value: Signal<string> = computed((): string => {
    const utilisation: number | undefined = this.storage.selectedReading()?.utilisationPercent;
    return utilisation === undefined ? '—' : formatShare(utilisation);
  });

  /**
   * Gets whether the platform reports how busy the drive is.
   */
  protected readonly reported: Signal<boolean> = computed(
    (): boolean => this.storage.utilisationHistory().length > 0,
  );

  /**
   * Gets the utilisation graph's one series.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      {
        label: 'Utilisation',
        values: this.storage.utilisationHistory(),
        emphasis: 'primary',
      },
    ],
  );

  /**
   * Gets the live figures under the graph.
   */
  protected readonly stats: Signal<readonly UtilisationStat[]> = computed(
    (): readonly UtilisationStat[] => {
      const reading: StorageDeviceReading | null = this.storage.selectedReading();
      const stats: UtilisationStat[] = [];
      if (reading?.temperatureC !== undefined) {
        stats.push({
          icon: Icon.MONITOR_TEMPERATURE,
          label: 'Temperature',
          value: `${Math.round(reading.temperatureC)} °C`,
        });
      }
      stats.push(
        {
          icon: Icon.MONITOR_IN,
          label: 'Read (Live)',
          value: reading === null ? '—' : formatRate(reading.readBytesPerSecond),
        },
        {
          icon: Icon.MONITOR_OUT,
          label: 'Write (Live)',
          value: reading === null ? '—' : formatRate(reading.writeBytesPerSecond),
        },
        {
          icon: Icon.MONITOR_IOPS,
          label: 'IOPS (R/W)',
          value:
            reading === null
              ? '—'
              : `${formatCount(reading.readOpsPerSecond)} / ${formatCount(reading.writeOpsPerSecond)}`,
        },
      );
      return stats;
    },
  );
}
