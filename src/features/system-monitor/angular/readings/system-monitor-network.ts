import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  NETWORK_SAMPLE_INTERVAL_MS,
  NetworkConnection,
  NetworkInfo,
  NetworkInterfaceInfo,
  NetworkInterfaceReading,
  NetworkReading,
} from '@shared/api/system-monitor-channels';

/**
 * The most readings kept: five minutes at the Network view's reading pace, the longest Graph History.
 */
export const NETWORK_LIVE_READINGS: number = Math.ceil((5 * 60_000) / NETWORK_SAMPLE_INTERVAL_MS);

/**
 * Describes the machine's network activity at one reading, every interface but the loopback together.
 */
export interface NetworkTotals {
  /**
   * Gets the bytes received per second.
   */
  readonly rxBytesPerSecond: number;

  /**
   * Gets the bytes sent per second.
   */
  readonly txBytesPerSecond: number;

  /**
   * Gets the packets received per second.
   */
  readonly rxPacketsPerSecond: number;

  /**
   * Gets the packets sent per second.
   */
  readonly txPacketsPerSecond: number;

  /**
   * Gets the bytes received since the counters started.
   */
  readonly totalRxBytes: number;

  /**
   * Gets the bytes sent since the counters started.
   */
  readonly totalTxBytes: number;
}

/**
 * The activity before the first reading.
 */
const NO_ACTIVITY: NetworkTotals = {
  rxBytesPerSecond: 0,
  txBytesPerSecond: 0,
  rxPacketsPerSecond: 0,
  txPacketsPerSecond: 0,
  totalRxBytes: 0,
  totalTxBytes: 0,
};

/**
 * Adds up the interfaces' activity in a reading, leaving out the loopback, whose traffic never leaves
 * the machine (and is counted once received and again sent).
 * @param reading The reading.
 * @param loopback The ids of the loopback interfaces.
 * @returns Returns the activity together.
 */
function totalsOf(reading: NetworkReading, loopback: ReadonlySet<string>): NetworkTotals {
  return reading.interfaces
    .filter((item: NetworkInterfaceReading): boolean => !loopback.has(item.id))
    .reduce(
      (sum: NetworkTotals, item: NetworkInterfaceReading): NetworkTotals => ({
        rxBytesPerSecond: sum.rxBytesPerSecond + item.rxBytesPerSecond,
        txBytesPerSecond: sum.txBytesPerSecond + item.txBytesPerSecond,
        rxPacketsPerSecond: sum.rxPacketsPerSecond + item.rxPacketsPerSecond,
        txPacketsPerSecond: sum.txPacketsPerSecond + item.txPacketsPerSecond,
        totalRxBytes: sum.totalRxBytes + item.totalRxBytes,
        totalTxBytes: sum.totalTxBytes + item.totalTxBytes,
      }),
      NO_ACTIVITY,
    );
}

/**
 * Holds one System Monitor view's network readings: the interfaces, DNS servers and gateway, the
 * latest activity and its recent history (kept for five minutes while the Network view is open), the
 * connections and DNS latency as last read, and the interface chosen to be described. Provided by the
 * view; it feeds readings through {@link accept} and the interfaces through {@link setInfo}.
 */
@Service({ autoProvided: false })
export class SystemMonitorNetwork {
  /**
   * Holds the settings, read for Graph History.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the interfaces, DNS servers and gateway, or null until they are read.
   */
  public readonly info: WritableSignal<NetworkInfo | null> = signal<NetworkInfo | null>(null);

  /**
   * Holds the latest reading, or null before the first arrives.
   */
  public readonly latest: WritableSignal<NetworkReading | null> = signal<NetworkReading | null>(
    null,
  );

  /**
   * Holds the connections as last read, or null before they are.
   */
  public readonly connections: WritableSignal<readonly NetworkConnection[] | null> = signal<
    readonly NetworkConnection[] | null
  >(null);

  /**
   * Holds the DNS server's latency as last measured, in milliseconds, or null before it is (or when it
   * did not answer).
   */
  public readonly dnsLatencyMs: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds the recent readings, oldest first, up to {@link NETWORK_LIVE_READINGS}.
   */
  private readonly readings: WritableSignal<readonly NetworkReading[]> = signal<
    readonly NetworkReading[]
  >([]);

  /**
   * Holds the id of the interface chosen, or null to describe the first.
   */
  private readonly chosenId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the interfaces listed, the default first.
   */
  public readonly interfaces: Signal<readonly NetworkInterfaceInfo[]> = computed(
    (): readonly NetworkInterfaceInfo[] => this.info()?.interfaces ?? [],
  );

  /**
   * Gets the interface described: the one chosen, or the first (the default).
   */
  public readonly selected: Signal<NetworkInterfaceInfo | null> = computed(
    (): NetworkInterfaceInfo | null => {
      const interfaces: readonly NetworkInterfaceInfo[] = this.interfaces();
      const id: string | null = this.chosenId();
      return (
        interfaces.find((item: NetworkInterfaceInfo): boolean => item.id === id) ??
        interfaces[0] ??
        null
      );
    },
  );

  /**
   * Gets each interface's latest reading, by id.
   */
  public readonly latestById: Signal<ReadonlyMap<string, NetworkInterfaceReading>> = computed(
    (): ReadonlyMap<string, NetworkInterfaceReading> =>
      new Map<string, NetworkInterfaceReading>(
        (this.latest()?.interfaces ?? []).map(
          (item: NetworkInterfaceReading): [string, NetworkInterfaceReading] => [item.id, item],
        ),
      ),
  );

  /**
   * Gets the latest reading of the interface described, or null before one arrives.
   */
  public readonly selectedReading: Signal<NetworkInterfaceReading | null> = computed(
    (): NetworkInterfaceReading | null => {
      const id: string | undefined = this.selected()?.id;
      return id === undefined ? null : (this.latestById().get(id) ?? null);
    },
  );

  /**
   * Gets the ids of the loopback interfaces, left out of the machine's totals.
   */
  private readonly loopback: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> =>
      new Set<string>(
        this.interfaces()
          .filter((item: NetworkInterfaceInfo): boolean => item.kind === 'loopback')
          .map((item: NetworkInterfaceInfo): string => item.id),
      ),
  );

  /**
   * Gets the readings a graph over Graph History draws.
   */
  private readonly graphed: Signal<readonly NetworkReading[]> = computed(
    (): readonly NetworkReading[] => {
      const length: number = Math.min(
        NETWORK_LIVE_READINGS,
        Math.ceil(
          (this.settings.value('systemMonitor.graphHistoryMinutes')() * 60_000) /
            NETWORK_SAMPLE_INTERVAL_MS,
        ),
      );
      return this.readings().slice(-length);
    },
  );

  /**
   * Gets the machine's latest activity, every interface but the loopback together.
   */
  public readonly totals: Signal<NetworkTotals> = computed((): NetworkTotals => {
    const latest: NetworkReading | null = this.latest();
    return latest === null ? NO_ACTIVITY : totalsOf(latest, this.loopback());
  });

  /**
   * Gets the machine's recent activity, oldest first, over Graph History.
   */
  public readonly totalsHistory: Signal<readonly NetworkTotals[]> = computed(
    (): readonly NetworkTotals[] => {
      const loopback: ReadonlySet<string> = this.loopback();
      return this.graphed().map((reading: NetworkReading): NetworkTotals =>
        totalsOf(reading, loopback),
      );
    },
  );

  /**
   * Gets the described interface's recent readings, oldest first, over Graph History.
   */
  public readonly selectedHistory: Signal<readonly NetworkInterfaceReading[]> = computed(
    (): readonly NetworkInterfaceReading[] => {
      const id: string | undefined = this.selected()?.id;
      return this.graphed()
        .map((reading: NetworkReading): NetworkInterfaceReading | undefined =>
          reading.interfaces.find((item: NetworkInterfaceReading): boolean => item.id === id),
        )
        .filter(
          (item: NetworkInterfaceReading | undefined): item is NetworkInterfaceReading =>
            item !== undefined,
        );
    },
  );

  /**
   * Records the interfaces, DNS servers and gateway.
   * @param info The network.
   */
  public setInfo(info: NetworkInfo): void {
    this.info.set(info);
  }

  /**
   * Records one reading, and the connections and DNS latency it carries.
   * @param reading The reading.
   */
  public accept(reading: NetworkReading): void {
    this.latest.set(reading);
    this.readings.update((readings: readonly NetworkReading[]): readonly NetworkReading[] =>
      [...readings, reading].slice(-NETWORK_LIVE_READINGS),
    );
    if (reading.connections !== undefined) {
      this.connections.set(reading.connections);
    }
    if (reading.dnsLatencyMs !== undefined) {
      this.dnsLatencyMs.set(reading.dnsLatencyMs);
    }
  }

  /**
   * Chooses the interface to describe.
   * @param id The interface's id.
   */
  public select(id: string): void {
    this.chosenId.set(id);
  }
}
