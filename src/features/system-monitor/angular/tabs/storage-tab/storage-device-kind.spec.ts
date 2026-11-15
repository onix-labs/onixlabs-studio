import { describe, expect, it } from 'vitest';
import { Icon } from '@shared/angular/icons/icon';
import { STORAGE_KIND_LABELS, storageKindIcon } from './storage-device-kind';

describe('storage device kinds', () => {
  it('namesEachKind_andGivesAUsbDriveItsOwnIcon', () => {
    expect(STORAGE_KIND_LABELS.nvme).toBe('NVMe (SSD)');
    expect(STORAGE_KIND_LABELS.hdd).toBe('Hard Disk');
    expect(storageKindIcon('usb')).toBe(Icon.MONITOR_DRIVE_USB);
    expect(storageKindIcon('nvme')).toBe(Icon.MONITOR_DRIVE);
  });
});
