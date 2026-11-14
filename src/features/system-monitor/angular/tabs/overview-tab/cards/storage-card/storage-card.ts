import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { VolumeMetric } from '@shared/api/system-monitor-channels';
import { formatBytes } from '../../../../readings/format';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../../dashboard-card/dashboard-card';

/**
 * The share of a volume in use at which its bar warns.
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
   * Gets the space used of the total (`182.5 GB / 1.8 TB`).
   */
  readonly space: string;

  /**
   * Gets the share in use, 0–100.
   */
  readonly percent: number;

  /**
   * Gets the share in use, formatted (`<1%` for a sliver, so it does not read as empty).
   */
  readonly percentLabel: string;

  /**
   * Gets whether the volume is nearly full.
   */
  readonly nearlyFull: boolean;
}

/**
 * Represents the Overview's Storage card: disk read and write throughput, and each volume's space.
 */
@Component({
  selector: 'app-system-monitor-storage-card',
  imports: [DashboardCard, DashboardBadge, AppIcon],
  templateUrl: './storage-card.html',
  styleUrl: './storage-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

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
        space: `${formatBytes(volume.usedBytes)} / ${formatBytes(volume.sizeBytes)}`,
        percent,
        percentLabel: percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`,
        nearlyFull: percent >= NEARLY_FULL_PERCENT,
      };
    }),
  );
}
