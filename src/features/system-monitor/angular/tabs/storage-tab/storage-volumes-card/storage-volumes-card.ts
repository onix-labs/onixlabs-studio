import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { StorageVolumeDevice, VolumeMetric } from '@shared/api/system-monitor-channels';
import { formatBytes, formatShare } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { SystemMonitorStorage } from '../../../readings/system-monitor-storage';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one volume's row, its figures formatted.
 */
interface VolumeRow {
  /**
   * Gets the volume's mount point.
   */
  readonly mount: string;

  /**
   * Gets the volume's name: its label, or its mount point.
   */
  readonly name: string;

  /**
   * Gets the volume's file system.
   */
  readonly type: string;

  /**
   * Gets the volume's capacity, formatted.
   */
  readonly capacity: string;

  /**
   * Gets the space used, formatted.
   */
  readonly used: string;

  /**
   * Gets the space free, formatted.
   */
  readonly free: string;

  /**
   * Gets the share used, 0–100.
   */
  readonly percent: number;

  /**
   * Gets the share used, formatted.
   */
  readonly share: string;

  /**
   * Gets whether the volume is on the drive described beside it.
   */
  readonly onSelected: boolean;
}

/**
 * Represents the Storage view's Volumes card: each mounted volume's file system, mount point, capacity
 * and space used, those on the chosen drive marked.
 */
@Component({
  selector: 'app-system-monitor-storage-volumes-card',
  imports: [AppIcon, DashboardCard],
  templateUrl: './storage-volumes-card.html',
  styleUrl: './storage-volumes-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageVolumesCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the view's machine readings, for the volumes' space.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Holds the view's storage readings, for each volume's name and drive.
   */
  private readonly storage: SystemMonitorStorage = inject(SystemMonitorStorage);

  /**
   * Gets the volumes' rows.
   */
  protected readonly rows: Signal<readonly VolumeRow[]> = computed((): readonly VolumeRow[] => {
    const devices: readonly StorageVolumeDevice[] = this.storage.info()?.volumes ?? [];
    const selected: string | undefined = this.storage.selected()?.id;
    return this.readings.volumes().map((volume: VolumeMetric): VolumeRow => {
      const device: StorageVolumeDevice | undefined = devices.find(
        (candidate: StorageVolumeDevice): boolean => candidate.mount === volume.mount,
      );
      const percent: number =
        volume.sizeBytes > 0 ? (volume.usedBytes / volume.sizeBytes) * 100 : 0;
      return {
        mount: volume.mount,
        name: device?.name ?? volume.mount,
        type: volume.type,
        capacity: formatBytes(volume.sizeBytes),
        used: formatBytes(volume.usedBytes),
        free: formatBytes(Math.max(0, volume.sizeBytes - volume.usedBytes)),
        percent,
        share: formatShare(percent),
        onSelected: selected !== undefined && device?.deviceId === selected,
      };
    });
  });
}
