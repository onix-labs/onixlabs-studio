import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { VolumeMetric } from '@shared/api/system-monitor-channels';
import { MetricTile } from '../../metric-tile/metric-tile';
import { formatBytes, formatPercent } from '../../readings/format';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';

/**
 * The share of a volume in use at which its bar turns to the warning colour.
 */
const NEARLY_FULL_PERCENT: number = 90;

/**
 * Describes one volume's row.
 */
interface VolumeRow {
  /**
   * Gets where the volume is mounted.
   */
  readonly mount: string;

  /**
   * Gets the file system type.
   */
  readonly type: string;

  /**
   * Gets the space in use, formatted.
   */
  readonly used: string;

  /**
   * Gets the space free, formatted.
   */
  readonly free: string;

  /**
   * Gets the volume's size, formatted.
   */
  readonly size: string;

  /**
   * Gets the share in use, 0–100.
   */
  readonly percent: number;

  /**
   * Gets the share in use, formatted.
   */
  readonly percentLabel: string;

  /**
   * Gets whether the volume is nearly full.
   */
  readonly nearlyFull: boolean;
}

/**
 * Represents the System Monitor's Disk tab: read and write throughput, and each volume's space.
 */
@Component({
  selector: 'app-system-monitor-disk-tab',
  imports: [MetricTile],
  templateUrl: './disk-tab.html',
  styleUrl: './disk-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiskTab {
  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets one row per volume.
   */
  protected readonly volumes: Signal<readonly VolumeRow[]> = computed((): readonly VolumeRow[] =>
    this.readings.volumes().map((volume: VolumeMetric): VolumeRow => {
      const percent: number =
        volume.sizeBytes > 0 ? (volume.usedBytes / volume.sizeBytes) * 100 : 0;
      return {
        mount: volume.mount,
        type: volume.type,
        used: formatBytes(volume.usedBytes),
        free: formatBytes(volume.sizeBytes - volume.usedBytes),
        size: formatBytes(volume.sizeBytes),
        percent,
        percentLabel: formatPercent(percent),
        nearlyFull: percent >= NEARLY_FULL_PERCENT,
      };
    }),
  );
}
