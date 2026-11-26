import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { MemoryDetailMetric, MetricsSample } from '@shared/api/system-monitor-channels';
import { formatBytes, formatShare } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one statistic.
 */
interface Statistic {
  /**
   * Gets the statistic's label.
   */
  readonly label: string;

  /**
   * Gets the statistic's value.
   */
  readonly value: string;
}

/**
 * Formats a share of the machine's memory beside its size (`49.2 GB (19%)`).
 * @param bytes The size, in bytes.
 * @param total The machine's memory, in bytes.
 * @returns Returns the formatted size and share.
 */
function withShare(bytes: number, total: number): string {
  return total > 0
    ? `${formatBytes(bytes)} (${formatShare((bytes / total) * 100)})`
    : formatBytes(bytes);
}

/**
 * Represents the Memory view's statistics card: the memory figures in full, as far as the platform
 * reports them — what is in use and available, what holds it, swap, and the pages moved to and from
 * disk since boot.
 */
@Component({
  selector: 'app-system-monitor-memory-statistics-card',
  imports: [DashboardCard],
  templateUrl: './memory-statistics-card.html',
  styleUrl: './memory-statistics-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryStatisticsCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the statistics the platform reports.
   */
  protected readonly statistics: Signal<readonly Statistic[]> = computed(
    (): readonly Statistic[] => {
      const sample: MetricsSample | null = this.readings.latest();
      if (sample === null) {
        return [];
      }
      const total: number = sample.memory.totalBytes;
      const detail: MemoryDetailMetric | undefined = sample.memoryDetail;
      const statistics: Statistic[] = [
        { label: 'Total Physical Memory', value: formatBytes(total) },
        { label: 'In Use', value: withShare(sample.memory.usedBytes, total) },
      ];
      const add: (label: string, bytes: number | undefined, share?: boolean) => void = (
        label: string,
        bytes: number | undefined,
        share: boolean = false,
      ): void => {
        if (bytes !== undefined) {
          statistics.push({ label, value: share ? withShare(bytes, total) : formatBytes(bytes) });
        }
      };
      add('Available', detail?.availableBytes, true);
      add('App Memory', detail?.appBytes);
      add('Wired', detail?.wiredBytes);
      add('Compressed', detail?.compressedBytes);
      add('Cached Files', detail?.cachedBytes);
      add('Free', detail?.freeBytes);
      add('Swap Total', detail?.swapTotalBytes);
      add('Swap Used', detail?.swapUsedBytes);
      if (detail?.pageIns !== undefined) {
        statistics.push({ label: 'Page Ins (Since Boot)', value: detail.pageIns.toLocaleString() });
      }
      if (detail?.pageOuts !== undefined) {
        statistics.push({
          label: 'Page Outs (Since Boot)',
          value: detail.pageOuts.toLocaleString(),
        });
      }
      return statistics;
    },
  );
}
