import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { StorageDeviceReading } from '@shared/api/system-monitor-channels';
import { formatBytes, formatCount, formatDuration } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { SystemMonitorStorage } from '../../../readings/system-monitor-storage';
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
 * Represents the Storage view's Disk Statistics card: what the chosen drive has read and written since
 * its counters started (at boot), in bytes and operations, and the average size of each.
 */
@Component({
  selector: 'app-system-monitor-storage-statistics-card',
  imports: [DashboardCard],
  templateUrl: './storage-statistics-card.html',
  styleUrl: './storage-statistics-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageStatisticsCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the view's machine readings, for when the machine started.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Holds the view's storage readings.
   */
  private readonly storage: SystemMonitorStorage = inject(SystemMonitorStorage);

  /**
   * Gets the card's heading, naming the drive.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const name: string | undefined = this.storage.selected()?.name;
    return name === undefined ? 'Disk Statistics' : `Disk Statistics (${name})`;
  });

  /**
   * Gets the drive's statistics, or none before it is read.
   */
  protected readonly statistics: Signal<readonly Statistic[]> = computed(
    (): readonly Statistic[] => {
      const reading: StorageDeviceReading | null = this.storage.selectedReading();
      if (reading === null) {
        return [];
      }
      const average: (bytes: number, operations: number) => string = (
        bytes: number,
        operations: number,
      ): string => (operations > 0 ? formatBytes(bytes / operations) : '—');
      const statistics: Statistic[] = [
        { label: 'Total Reads', value: formatBytes(reading.totalReadBytes) },
        { label: 'Total Writes', value: formatBytes(reading.totalWriteBytes) },
        { label: 'Read Operations', value: formatCount(reading.totalReadOps) },
        { label: 'Write Operations', value: formatCount(reading.totalWriteOps) },
        {
          label: 'Average Read Size',
          value: average(reading.totalReadBytes, reading.totalReadOps),
        },
        {
          label: 'Average Write Size',
          value: average(reading.totalWriteBytes, reading.totalWriteOps),
        },
      ];
      const bootTime: number | undefined = this.readings.info()?.bootTime;
      const at: number = Date.parse(this.storage.latest()?.timestamp ?? '');
      if (bootTime !== undefined && Number.isFinite(at)) {
        statistics.push({
          label: 'Counted Since Boot',
          value: formatDuration((at - bootTime) / 1000),
        });
      }
      return statistics;
    },
  );
}
