import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Chip } from '@shared/angular/components/chip/chip';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { StorageDevice } from '@shared/api/system-monitor-channels';
import { formatBytes, formatCount } from '../../../readings/format';
import { SystemMonitorStorage } from '../../../readings/system-monitor-storage';
import { DashboardCard } from '../../dashboard-card/dashboard-card';
import { STORAGE_KIND_LABELS, storageKindIcon } from '../storage-device-kind';

/**
 * Describes one fact about the device.
 */
interface DeviceFact {
  /**
   * Gets the fact's label.
   */
  readonly label: string;

  /**
   * Gets the fact's value.
   */
  readonly value: string;
}

/**
 * Represents the Storage view's device card: what the chosen drive is — its kind, connection,
 * capacity, model, serial and firmware — and its self-reported health where the platform reports it.
 */
@Component({
  selector: 'app-system-monitor-storage-device-card',
  imports: [AppIcon, Chip, DashboardCard],
  templateUrl: './storage-device-card.html',
  styleUrl: './storage-device-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageDeviceCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the view's storage readings.
   */
  private readonly storage: SystemMonitorStorage = inject(SystemMonitorStorage);

  /**
   * Gets the chosen drive, or null before the drives are read.
   */
  protected readonly device: Signal<StorageDevice | null> = this.storage.selected;

  /**
   * Gets the drive's icon.
   */
  protected readonly icon: Signal<Icon> = computed((): Icon =>
    storageKindIcon(this.device()?.kind ?? 'other'),
  );

  /**
   * Gets the drive's facts, those reported.
   */
  protected readonly facts: Signal<readonly DeviceFact[]> = computed((): readonly DeviceFact[] => {
    const device: StorageDevice | null = this.device();
    if (device === null) {
      return [];
    }
    const facts: DeviceFact[] = [{ label: 'Type', value: STORAGE_KIND_LABELS[device.kind] }];
    if (device.connection !== undefined) {
      facts.push({ label: 'Interface', value: device.connection });
    }
    facts.push({
      label: 'Capacity',
      value: `${formatBytes(device.sizeBytes)} (${formatCount(device.sizeBytes)} bytes)`,
    });
    facts.push({
      label: 'Model',
      value:
        device.vendor !== undefined && !device.name.startsWith(device.vendor)
          ? `${device.vendor} ${device.name}`
          : device.name,
    });
    if (device.serial !== undefined) {
      facts.push({ label: 'Serial', value: device.serial });
    }
    if (device.firmware !== undefined) {
      facts.push({ label: 'Firmware', value: device.firmware });
    }
    return facts;
  });
}
