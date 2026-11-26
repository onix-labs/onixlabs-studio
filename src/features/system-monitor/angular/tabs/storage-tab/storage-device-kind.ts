import { Icon } from '@shared/angular/icons/icon';
import { StorageDeviceKind } from '@shared/api/system-monitor-channels';

/**
 * How each kind of storage device is described.
 */
export const STORAGE_KIND_LABELS: Readonly<Record<StorageDeviceKind, string>> = {
  nvme: 'NVMe (SSD)',
  ssd: 'SSD',
  hdd: 'Hard Disk',
  usb: 'USB',
  virtual: 'Virtual Disk',
  other: 'Disk',
};

/**
 * Gets the icon a kind of storage device wears.
 * @param kind The kind.
 * @returns Returns a USB device's icon for a USB device, otherwise a drive's.
 */
export function storageKindIcon(kind: StorageDeviceKind): Icon {
  return kind === 'usb' ? Icon.MONITOR_DRIVE_USB : Icon.MONITOR_DRIVE;
}
