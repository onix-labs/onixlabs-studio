import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  STORAGE_SAMPLE_INTERVAL_MS,
  StorageDevice,
  StorageDeviceReading,
  StorageInfo,
  StorageReading,
} from '@shared/api/system-monitor-channels';

/**
 * The most readings kept: five minutes at the Storage view's reading pace, the longest Graph History.
 */
export const STORAGE_LIVE_READINGS: number = Math.ceil((5 * 60_000) / STORAGE_SAMPLE_INTERVAL_MS);

/**
 * Describes the machine's storage activity at one reading, every device together.
 */
export interface StorageTotals {
  /**
   * Gets the bytes read per second.
   */
  readonly readBytesPerSecond: number;

  /**
   * Gets the bytes written per second.
   */
  readonly writeBytesPerSecond: number;

  /**
   * Gets the read operations per second.
   */
  readonly readOpsPerSecond: number;

  /**
   * Gets the write operations per second.
   */
  readonly writeOpsPerSecond: number;
}

/**
 * The activity before the first reading.
 */
const NO_ACTIVITY: StorageTotals = {
  readBytesPerSecond: 0,
  writeBytesPerSecond: 0,
  readOpsPerSecond: 0,
  writeOpsPerSecond: 0,
};

/**
 * Adds up the devices' activity in a reading, counting only the devices the view lists, so a disk
 * image's reads do not swell the machine's.
 * @param reading The reading.
 * @param listed The ids of the devices listed, or null to count every device.
 * @returns Returns the activity together.
 */
function totalsOf(reading: StorageReading, listed: ReadonlySet<string> | null): StorageTotals {
  return reading.devices
    .filter((device: StorageDeviceReading): boolean => listed === null || listed.has(device.id))
    .reduce(
      (sum: StorageTotals, device: StorageDeviceReading): StorageTotals => ({
        readBytesPerSecond: sum.readBytesPerSecond + device.readBytesPerSecond,
        writeBytesPerSecond: sum.writeBytesPerSecond + device.writeBytesPerSecond,
        readOpsPerSecond: sum.readOpsPerSecond + device.readOpsPerSecond,
        writeOpsPerSecond: sum.writeOpsPerSecond + device.writeOpsPerSecond,
      }),
      NO_ACTIVITY,
    );
}

/**
 * Holds one System Monitor view's storage readings: the machine's devices and the device each volume
 * is on, the latest activity and its recent history (kept for five minutes while the Storage view is
 * open), and the device chosen to be described. Provided by the view; it feeds readings through
 * {@link accept} and the devices through {@link setInfo}.
 */
@Service({ autoProvided: false })
export class SystemMonitorStorage {
  /**
   * Holds the settings, read for Graph History.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the devices and the device each volume is on, or null until they are read.
   */
  public readonly info: WritableSignal<StorageInfo | null> = signal<StorageInfo | null>(null);

  /**
   * Holds the latest reading, or null before the first arrives.
   */
  public readonly latest: WritableSignal<StorageReading | null> = signal<StorageReading | null>(
    null,
  );

  /**
   * Holds the recent readings, oldest first, up to {@link STORAGE_LIVE_READINGS}.
   */
  private readonly readings: WritableSignal<readonly StorageReading[]> = signal<
    readonly StorageReading[]
  >([]);

  /**
   * Holds the id of the device chosen, or null to describe the first.
   */
  private readonly chosenId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the devices listed.
   */
  public readonly devices: Signal<readonly StorageDevice[]> = computed(
    (): readonly StorageDevice[] => this.info()?.devices ?? [],
  );

  /**
   * Gets the device described: the one chosen, or the first.
   */
  public readonly selected: Signal<StorageDevice | null> = computed((): StorageDevice | null => {
    const devices: readonly StorageDevice[] = this.devices();
    const id: string | null = this.chosenId();
    return devices.find((device: StorageDevice): boolean => device.id === id) ?? devices[0] ?? null;
  });

  /**
   * Gets the latest reading of the device described, or null before one arrives.
   */
  public readonly selectedReading: Signal<StorageDeviceReading | null> = computed(
    (): StorageDeviceReading | null => {
      const id: string | undefined = this.selected()?.id;
      return (
        this.latest()?.devices.find((device: StorageDeviceReading): boolean => device.id === id) ??
        null
      );
    },
  );

  /**
   * Gets the ids of the devices listed, or null before they are read (when every device counts).
   */
  private readonly listed: Signal<ReadonlySet<string> | null> = computed(
    (): ReadonlySet<string> | null => {
      const info: StorageInfo | null = this.info();
      return info === null
        ? null
        : new Set<string>(info.devices.map((device: StorageDevice): string => device.id));
    },
  );

  /**
   * Gets the readings a graph over Graph History draws.
   */
  private readonly graphed: Signal<readonly StorageReading[]> = computed(
    (): readonly StorageReading[] => {
      const length: number = Math.min(
        STORAGE_LIVE_READINGS,
        Math.ceil(
          (this.settings.value('systemMonitor.graphHistoryMinutes')() * 60_000) /
            STORAGE_SAMPLE_INTERVAL_MS,
        ),
      );
      return this.readings().slice(-length);
    },
  );

  /**
   * Gets the machine's latest activity, every listed device together.
   */
  public readonly totals: Signal<StorageTotals> = computed((): StorageTotals => {
    const latest: StorageReading | null = this.latest();
    return latest === null ? NO_ACTIVITY : totalsOf(latest, this.listed());
  });

  /**
   * Gets the machine's recent activity, oldest first, over Graph History.
   */
  public readonly totalsHistory: Signal<readonly StorageTotals[]> = computed(
    (): readonly StorageTotals[] => {
      const listed: ReadonlySet<string> | null = this.listed();
      return this.graphed().map((reading: StorageReading): StorageTotals =>
        totalsOf(reading, listed),
      );
    },
  );

  /**
   * Gets the described device's recent utilisation, oldest first, over Graph History.
   */
  public readonly utilisationHistory: Signal<readonly number[]> = computed(
    (): readonly number[] => {
      const id: string | undefined = this.selected()?.id;
      return this.graphed()
        .map(
          (reading: StorageReading): number | undefined =>
            reading.devices.find((device: StorageDeviceReading): boolean => device.id === id)
              ?.utilisationPercent,
        )
        .filter((value: number | undefined): value is number => value !== undefined);
    },
  );

  /**
   * Records the devices and the device each volume is on.
   * @param info The storage.
   */
  public setInfo(info: StorageInfo): void {
    this.info.set(info);
  }

  /**
   * Records one reading.
   * @param reading The reading.
   */
  public accept(reading: StorageReading): void {
    this.latest.set(reading);
    this.readings.update((readings: readonly StorageReading[]): readonly StorageReading[] =>
      [...readings, reading].slice(-STORAGE_LIVE_READINGS),
    );
  }

  /**
   * Chooses the device to describe.
   * @param id The device's id.
   */
  public select(id: string): void {
    this.chosenId.set(id);
  }
}
