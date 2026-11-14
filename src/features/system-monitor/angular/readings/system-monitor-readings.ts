import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  historySamples,
  InterfaceMetric,
  MemoryDetailMetric,
  MetricsSample,
  SystemInfo,
  VolumeMetric,
} from '@shared/api/system-monitor-channels';
import { TileChannel } from '../metric-tile/metric-tile';
import { formatBytes, formatPercent, formatRate, formatShare } from './format';
import { MachineHealth } from './machine-health';

/**
 * The share of memory in use at which the machine is under memory pressure.
 */
const MEMORY_PRESSURE_PERCENT: number = 90;

/**
 * The share of a volume in use at which it is nearly full.
 */
const VOLUME_FULL_PERCENT: number = 95;

/**
 * The CPU load, averaged over {@link CPU_BUSY_SAMPLES}, at which the machine is busy. Averaged so a
 * moment's spike does not raise the alarm.
 */
const CPU_BUSY_PERCENT: number = 90;

/**
 * The number of recent samples the CPU load is averaged over.
 */
const CPU_BUSY_SAMPLES: number = 10;

/**
 * Holds one System Monitor view's machine readings: the latest sample, the bounded histories its graphs
 * draw, and the readings formatted for display. Provided by the view, so every tab of one monitor reads
 * the same histories and a second monitor keeps its own; the view feeds it samples through
 * {@link accept} and the machine's description through {@link setInfo}.
 */
@Service({ autoProvided: false })
export class SystemMonitorReadings {
  /**
   * Holds the settings service, read for Graph History, the Refresh Rate and GPU Monitoring.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets whether the GPU is read and its graphs shown.
   */
  public readonly gpuMonitoring: Signal<boolean> = this.settings.value(
    'systemMonitor.gpuMonitoring',
  );

  /**
   * Gets how many samples a graph holds: Graph History's span of time at the Refresh Rate.
   */
  private readonly historyLength: Signal<number> = computed((): number =>
    historySamples(
      this.settings.value('systemMonitor.graphHistoryMinutes')(),
      this.settings.systemMonitorRefreshRate(),
    ),
  );

  /**
   * Gets the time between samples in milliseconds, or the default while sampling is paused, for the
   * graphs' "how long ago".
   */
  public readonly intervalMs: Signal<number> = computed((): number => {
    const rate: number = this.settings.systemMonitorRefreshRate();
    return rate > 0 ? rate : 1000;
  });

  /**
   * Gets the span a graph covers, in words (`Last 5 minutes`), from Graph History.
   */
  public readonly historyLabel: Signal<string> = computed((): string => {
    const minutes: number = this.settings.value('systemMonitor.graphHistoryMinutes')();
    return minutes === 1 ? 'Last 60 seconds' : `Last ${minutes} minutes`;
  });

  /**
   * Holds the most recent sample, or null before the first arrives.
   */
  public readonly latest: WritableSignal<MetricsSample | null> = signal<MetricsSample | null>(null);

  /**
   * Holds the machine's description, or null until it has been read.
   */
  public readonly info: WritableSignal<SystemInfo | null> = signal<SystemInfo | null>(null);

  /**
   * Holds the recent CPU utilisation history (percent), oldest first.
   */
  public readonly cpuHistory: WritableSignal<readonly number[]> = signal<readonly number[]>([]);

  /**
   * Holds each core's recent utilisation history (percent), oldest first, in the OS's core order.
   */
  public readonly coreHistories: WritableSignal<readonly (readonly number[])[]> = signal<
    readonly (readonly number[])[]
  >([]);

  /**
   * Holds the recent memory-use history (percent), oldest first.
   */
  public readonly memoryHistory: WritableSignal<readonly number[]> = signal<readonly number[]>([]);

  /**
   * Holds the recent swap-use history (percent of the swap configured), oldest first.
   */
  public readonly swapHistory: WritableSignal<readonly number[]> = signal<readonly number[]>([]);

  /**
   * Holds the recent app CPU-share history (percent), oldest first, overlaid on the CPU graph.
   */
  public readonly appCpuHistory: WritableSignal<readonly number[]> = signal<readonly number[]>([]);

  /**
   * Holds the recent app memory-share history (percent), oldest first, overlaid on the memory graph.
   */
  public readonly appMemoryHistory: WritableSignal<readonly number[]> = signal<readonly number[]>(
    [],
  );

  /**
   * Holds the recent received network-throughput history (bytes/sec), oldest first.
   */
  public readonly networkRxHistory: WritableSignal<readonly number[]> = signal<readonly number[]>(
    [],
  );

  /**
   * Holds the recent sent network-throughput history (bytes/sec), oldest first.
   */
  public readonly networkTxHistory: WritableSignal<readonly number[]> = signal<readonly number[]>(
    [],
  );

  /**
   * Holds the recent disk read-throughput history (bytes/sec), oldest first.
   */
  public readonly diskReadHistory: WritableSignal<readonly number[]> = signal<readonly number[]>(
    [],
  );

  /**
   * Holds the recent disk write-throughput history (bytes/sec), oldest first.
   */
  public readonly diskWriteHistory: WritableSignal<readonly number[]> = signal<readonly number[]>(
    [],
  );

  /**
   * Holds the recent GPU-utilisation history (percent), oldest first.
   */
  public readonly gpuHistory: WritableSignal<readonly number[]> = signal<readonly number[]>([]);

  /**
   * Gets the machine-wide CPU reading, formatted as a percentage.
   */
  public readonly cpuValue: Signal<string> = computed((): string => {
    const sample: MetricsSample | null = this.latest();
    return sample === null ? '—' : formatPercent(sample.cpu);
  });

  /**
   * Gets the app's CPU share, formatted as a percentage, or null when it was not read. A share below 10%
   * keeps a decimal, so Studio's usual fraction of a large machine does not read as 0%.
   */
  public readonly cpuAppValue: Signal<string | null> = computed((): string | null => {
    const usage: MetricsSample['app'] = this.latest()?.app;
    return usage === undefined ? null : formatShare(usage.cpuPercent);
  });

  /**
   * Gets each core's latest utilisation, or an empty list before the first per-core reading.
   */
  public readonly cores: Signal<readonly number[]> = computed(
    (): readonly number[] => this.latest()?.cores ?? [],
  );

  /**
   * Gets the total physical memory, formatted, or null before the first sample.
   */
  public readonly memoryTotal: Signal<string | null> = computed((): string | null => {
    const sample: MetricsSample | null = this.latest();
    return sample === null ? null : formatBytes(sample.memory.totalBytes);
  });

  /**
   * Gets the machine-wide memory reading: used bytes with the percentage.
   */
  public readonly memoryValue: Signal<string> = computed((): string => {
    const sample: MetricsSample | null = this.latest();
    if (sample === null) {
      return '—';
    }
    const { usedBytes, percent }: MetricsSample['memory'] = sample.memory;
    return `${formatBytes(usedBytes)} (${formatPercent(percent)})`;
  });

  /**
   * Gets the app's memory share, formatted as bytes with the percentage, or null when it was not read.
   * The percentage keeps a decimal below 10%, as the CPU share does.
   */
  public readonly memoryAppValue: Signal<string | null> = computed((): string | null => {
    const usage: MetricsSample['app'] = this.latest()?.app;
    return usage === undefined
      ? null
      : `${formatBytes(usage.memoryBytes)} (${formatShare(usage.memoryPercent)})`;
  });

  /**
   * Gets the latest memory breakdown, or null when it was not read.
   */
  public readonly memoryDetail: Signal<MemoryDetailMetric | null> = computed(
    (): MemoryDetailMetric | null => this.latest()?.memoryDetail ?? null,
  );

  /**
   * Gets the received-throughput reading, or a placeholder when unavailable.
   */
  public readonly networkRxValue: Signal<string> = computed((): string => {
    const network: MetricsSample['network'] = this.latest()?.network;
    return network === undefined ? '—' : formatRate(network.rxBytesPerSec);
  });

  /**
   * Gets the sent-throughput reading, or a placeholder when unavailable.
   */
  public readonly networkTxValue: Signal<string> = computed((): string => {
    const network: MetricsSample['network'] = this.latest()?.network;
    return network === undefined ? '—' : formatRate(network.txBytesPerSec);
  });

  /**
   * Gets each network interface's latest throughput, busiest first.
   */
  public readonly interfaces: Signal<readonly InterfaceMetric[]> = computed(
    (): readonly InterfaceMetric[] => this.latest()?.interfaces ?? [],
  );

  /**
   * Gets the disk read-throughput reading, or a placeholder when unavailable.
   */
  public readonly diskReadValue: Signal<string> = computed((): string => {
    const disk: MetricsSample['disk'] = this.latest()?.disk;
    return disk === undefined ? '—' : formatRate(disk.readBytesPerSec);
  });

  /**
   * Gets the disk write-throughput reading, or a placeholder when unavailable.
   */
  public readonly diskWriteValue: Signal<string> = computed((): string => {
    const disk: MetricsSample['disk'] = this.latest()?.disk;
    return disk === undefined ? '—' : formatRate(disk.writeBytesPerSec);
  });

  /**
   * Gets each mounted volume's latest space.
   */
  public readonly volumes: Signal<readonly VolumeMetric[]> = computed(
    (): readonly VolumeMetric[] => this.latest()?.volumes ?? [],
  );

  /**
   * Gets the GPU reading: its utilisation, or `N/A` where the platform does not report it.
   */
  public readonly gpuValue: Signal<string> = computed((): string => {
    const sample: MetricsSample | null = this.latest();
    if (sample === null) {
      return '—';
    }
    return sample.gpu?.available === true ? formatPercent(sample.gpu.percent) : 'N/A';
  });

  /**
   * Gets the machine's health: healthy, or what is under pressure — memory nearly exhausted, a volume
   * nearly full, or the CPU busy for the last several samples.
   */
  public readonly health: Signal<MachineHealth> = computed((): MachineHealth => {
    const sample: MetricsSample | null = this.latest();
    const reasons: string[] = [];
    if (sample !== null && sample.memory.percent >= MEMORY_PRESSURE_PERCENT) {
      reasons.push('Memory pressure');
    }
    const full: readonly VolumeMetric[] = this.volumes().filter(
      (volume: VolumeMetric): boolean =>
        volume.sizeBytes > 0 && (volume.usedBytes / volume.sizeBytes) * 100 >= VOLUME_FULL_PERCENT,
    );
    if (full.length > 0) {
      reasons.push(full.length === 1 ? `${full[0].mount} nearly full` : 'Volumes nearly full');
    }
    const recent: readonly number[] = this.cpuHistory().slice(-CPU_BUSY_SAMPLES);
    const average: number =
      recent.length === 0
        ? 0
        : recent.reduce((sum: number, cpu: number): number => sum + cpu, 0) / recent.length;
    if (recent.length >= CPU_BUSY_SAMPLES && average >= CPU_BUSY_PERCENT) {
      reasons.push('CPU busy');
    }
    return {
      healthy: reasons.length === 0,
      label:
        reasons.length === 0 ? 'Healthy' : reasons.length === 1 ? reasons[0] : 'Under pressure',
      reasons,
    };
  });

  /**
   * Gets the CPU graph's channel: the machine reading with the app overlaid.
   */
  public readonly cpuChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [
      {
        value: this.cpuValue(),
        values: this.cpuHistory(),
        appValue: this.cpuAppValue(),
        appValues: this.appCpuHistory(),
      },
    ],
  );

  /**
   * Gets the GPU graph's channel: utilisation alone, since no app attribution is possible.
   */
  public readonly gpuChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [{ value: this.gpuValue(), values: this.gpuHistory() }],
  );

  /**
   * Gets the memory graph's channel: the used reading with the app overlaid.
   */
  public readonly memoryChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [
      {
        value: this.memoryValue(),
        values: this.memoryHistory(),
        appValue: this.memoryAppValue(),
        appValues: this.appMemoryHistory(),
      },
    ],
  );

  /**
   * Gets the network graphs' channels: independently scaled Received and Sent.
   */
  public readonly networkChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [
      {
        caption: 'Received',
        value: this.networkRxValue(),
        values: this.networkRxHistory(),
        max: Math.max(1, ...this.networkRxHistory()),
      },
      {
        caption: 'Sent',
        value: this.networkTxValue(),
        values: this.networkTxHistory(),
        max: Math.max(1, ...this.networkTxHistory()),
      },
    ],
  );

  /**
   * Gets the disk graphs' channels: independently scaled Read and Write.
   */
  public readonly diskChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [
      {
        caption: 'Read',
        value: this.diskReadValue(),
        values: this.diskReadHistory(),
        max: Math.max(1, ...this.diskReadHistory()),
      },
      {
        caption: 'Write',
        value: this.diskWriteValue(),
        values: this.diskWriteHistory(),
        max: Math.max(1, ...this.diskWriteHistory()),
      },
    ],
  );

  /**
   * Records one sample: it becomes the latest reading and is appended to the histories, each held to
   * Graph History's length.
   * @param sample The sample to accept.
   */
  public accept(sample: MetricsSample): void {
    this.latest.set(sample);
    this.push(this.cpuHistory, sample.cpu);
    this.push(this.memoryHistory, sample.memory.percent);
    if (sample.cores !== undefined) {
      this.pushCores(sample.cores);
    }
    if (sample.memoryDetail !== undefined && sample.memoryDetail.swapTotalBytes > 0) {
      const { swapUsedBytes, swapTotalBytes }: MemoryDetailMetric = sample.memoryDetail;
      this.push(this.swapHistory, (swapUsedBytes / swapTotalBytes) * 100);
    }
    if (sample.app !== undefined) {
      this.push(this.appCpuHistory, sample.app.cpuPercent);
      this.push(this.appMemoryHistory, sample.app.memoryPercent);
    }
    if (sample.network !== undefined) {
      this.push(this.networkRxHistory, sample.network.rxBytesPerSec);
      this.push(this.networkTxHistory, sample.network.txBytesPerSec);
    }
    if (sample.disk !== undefined) {
      this.push(this.diskReadHistory, sample.disk.readBytesPerSec);
      this.push(this.diskWriteHistory, sample.disk.writeBytesPerSec);
    }
    if (sample.gpu?.available === true && this.gpuMonitoring()) {
      this.push(this.gpuHistory, sample.gpu.percent);
    }
  }

  /**
   * Records the machine's description.
   * @param info The description.
   */
  public setInfo(info: SystemInfo): void {
    this.info.set(info);
  }

  /**
   * Appends one value to a bounded history.
   * @param history The history to append to.
   * @param value The value to append.
   */
  private push(history: WritableSignal<readonly number[]>, value: number): void {
    const length: number = this.historyLength();
    history.update((values: readonly number[]): readonly number[] =>
      [...values, value].slice(-length),
    );
  }

  /**
   * Appends each core's reading to its history. When the core count changes the histories restart,
   * since they would otherwise pair one core's past with another's present.
   * @param cores Each core's utilisation.
   */
  private pushCores(cores: readonly number[]): void {
    const length: number = this.historyLength();
    this.coreHistories.update(
      (histories: readonly (readonly number[])[]): readonly (readonly number[])[] => {
        const fresh: boolean = histories.length !== cores.length;
        return cores.map((value: number, index: number): readonly number[] =>
          [...(fresh ? [] : histories[index]), value].slice(-length),
        );
      },
    );
  }
}
