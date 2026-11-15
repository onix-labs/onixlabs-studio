import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import {
  StorageDevice,
  StorageInfo,
  StorageVolumeDevice,
  VolumeMetric,
} from '@shared/api/system-monitor-channels';
import { formatBytes, formatRate, formatShare } from '../../readings/format';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { StorageTotals, SystemMonitorStorage } from '../../readings/system-monitor-storage';
import { StorageActivityCard } from './storage-activity-card/storage-activity-card';
import { StorageDeviceCard } from './storage-device-card/storage-device-card';
import { StorageDevicesCard } from './storage-devices-card/storage-devices-card';
import { StorageIopsCard } from './storage-iops-card/storage-iops-card';
import { StorageStatisticsCard } from './storage-statistics-card/storage-statistics-card';
import { StorageUtilisationCard } from './storage-utilisation-card/storage-utilisation-card';
import { StorageVolumesCard } from './storage-volumes-card/storage-volumes-card';
import { SummaryItem, ViewSummary } from '../view-summary/view-summary';

/**
 * Represents the System Monitor's Storage view: the machine's drives and volumes. A header counts them
 * and sums their capacity, space and live activity; beneath it, the reads, writes and operations of
 * every drive together over Graph History, the drives (one chosen), what the chosen drive is, how busy
 * it is and what it has done since boot, and every mounted volume's space.
 *
 * Drives are read only while the view is in front of the user.
 */
@Component({
  selector: 'app-system-monitor-storage-tab',
  imports: [
    ViewSummary,
    AppIcon,
    StorageActivityCard,
    StorageDeviceCard,
    StorageDevicesCard,
    StorageIopsCard,
    StorageStatisticsCard,
    StorageUtilisationCard,
    StorageVolumesCard,
  ],
  templateUrl: './storage-tab.html',
  styleUrl: './storage-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageTab {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the view's machine readings, for the volumes.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Holds the view's storage readings.
   */
  private readonly storage: SystemMonitorStorage = inject(SystemMonitorStorage);

  /**
   * Gets the count beside the title: the drives and the volumes.
   */
  protected readonly count: Signal<string> = computed((): string => {
    const devices: number = this.storage.devices().length;
    const volumes: number = this.readings.volumes().length;
    return [
      this.storage.info() === null ? null : `${devices} ${devices === 1 ? 'device' : 'devices'}`,
      `${volumes} ${volumes === 1 ? 'volume' : 'volumes'}`,
    ]
      .filter((part: string | null): part is string => part !== null)
      .join(' • ');
  });

  /**
   * Gets the volumes on the listed drives, so a network share's space is not counted against the
   * machine's own; every volume until the drives are read.
   */
  private readonly localVolumes: Signal<readonly VolumeMetric[]> = computed(
    (): readonly VolumeMetric[] => {
      const info: StorageInfo | null = this.storage.info();
      const volumes: readonly VolumeMetric[] = this.readings.volumes();
      if (info === null) {
        return volumes;
      }
      const listed: ReadonlySet<string> = new Set<string>(
        info.devices.map((device: StorageDevice): string => device.id),
      );
      const local: ReadonlySet<string> = new Set<string>(
        info.volumes
          .filter(
            (volume: StorageVolumeDevice): boolean =>
              volume.deviceId !== undefined && listed.has(volume.deviceId),
          )
          .map((volume: StorageVolumeDevice): string => volume.mount),
      );
      return volumes.filter((volume: VolumeMetric): boolean => local.has(volume.mount));
    },
  );

  /**
   * Gets the header's summary: the drives' capacity, the space used and free on their volumes, and the
   * live reads and writes.
   */
  protected readonly chips: Signal<readonly SummaryItem[]> = computed(
    (): readonly SummaryItem[] => {
      const devices: readonly StorageDevice[] = this.storage.devices();
      const volumes: readonly VolumeMetric[] = this.localVolumes();
      const size: number = volumes.reduce(
        (sum: number, volume: VolumeMetric): number => sum + volume.sizeBytes,
        0,
      );
      const used: number = volumes.reduce(
        (sum: number, volume: VolumeMetric): number => sum + volume.usedBytes,
        0,
      );
      const totals: StorageTotals = this.storage.totals();
      const chips: SummaryItem[] = [];
      if (devices.length > 0) {
        chips.push({
          label: 'Total Capacity',
          value: formatBytes(
            devices.reduce(
              (sum: number, device: StorageDevice): number => sum + device.sizeBytes,
              0,
            ),
          ),
        });
      }
      if (size > 0) {
        chips.push(
          { label: 'Used', value: `${formatBytes(used)} (${formatShare((used / size) * 100)})` },
          { label: 'Free', value: formatBytes(Math.max(0, size - used)) },
        );
      }
      chips.push(
        { label: 'Read (Live)', value: formatRate(totals.readBytesPerSecond) },
        { label: 'Write (Live)', value: formatRate(totals.writeBytesPerSecond) },
      );
      return chips;
    },
  );
}
