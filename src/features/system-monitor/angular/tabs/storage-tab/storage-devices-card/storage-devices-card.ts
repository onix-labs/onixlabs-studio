import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { StorageDevice } from '@shared/api/system-monitor-channels';
import { formatBytes } from '../../../readings/format';
import { SystemMonitorStorage } from '../../../readings/system-monitor-storage';
import { DashboardCard } from '../../dashboard-card/dashboard-card';
import { storageKindIcon } from '../storage-device-kind';

/**
 * Describes one device in the list.
 */
interface DeviceRow {
  /**
   * Gets the device.
   */
  readonly device: StorageDevice;

  /**
   * Gets its icon.
   */
  readonly icon: Icon;

  /**
   * Gets its size and connection, formatted.
   */
  readonly detail: string;
}

/**
 * Represents the Storage view's Devices card: the machine's drives, one of which is chosen to be
 * described by the cards beside it.
 */
@Component({
  selector: 'app-system-monitor-storage-devices-card',
  imports: [AppIcon, DashboardCard],
  templateUrl: './storage-devices-card.html',
  styleUrl: './storage-devices-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageDevicesCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's storage readings.
   */
  protected readonly storage: SystemMonitorStorage = inject(SystemMonitorStorage);

  /**
   * Gets the devices' rows.
   */
  protected readonly rows: Signal<readonly DeviceRow[]> = computed((): readonly DeviceRow[] =>
    this.storage.devices().map((device: StorageDevice): DeviceRow => ({
      device,
      icon: storageKindIcon(device.kind),
      detail: [formatBytes(device.sizeBytes), device.connection]
        .filter((part: string | undefined): boolean => part !== undefined)
        .join(' • '),
    })),
  );

  /**
   * Gets whether the devices have been read.
   */
  protected readonly read: Signal<boolean> = computed((): boolean => this.storage.info() !== null);
}
