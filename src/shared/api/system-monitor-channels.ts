/**
 * Names the System Monitor's metrics IPC channels and their payload contracts — the metrics slice of
 * the contribution's IPC surface, over the generic {@link import('./bridge').Bridge} transport. The
 * renderer starts and stops sampling as its view shows and hides (so nothing is sampled when the tab
 * is not visible), and the main-process contribution pushes one {@link MetricsSample} per tick while
 * any consumer is active.
 */
export enum SystemMonitorChannel {
  /**
   * Asks the backend to begin sampling (renderer→main, fire-and-forget). Ref-counted: sampling runs
   * while at least one consumer has started and stops when the last stops.
   */
  Start = 'system-monitor:start',

  /**
   * Asks the backend to stop sampling for this consumer (renderer→main, fire-and-forget).
   */
  Stop = 'system-monitor:stop',

  /**
   * Pushes one metrics sample to the renderer (main→renderer).
   */
  Sample = 'system-monitor:sample',

  /**
   * Sets how often samples are taken (renderer→main, fire-and-forget), carrying a
   * {@link SamplingRate}. Shared by every consumer, like the loop itself: the last rate set wins,
   * and a loop already running is re-timed at once.
   */
  Rate = 'system-monitor:rate',

  /**
   * Renderer → main (send): a Processes view became visible and wants process snapshots. Ref-counted
   * separately from {@link Start}, because a process listing is far costlier than a metrics sample.
   */
  ProcessesStart = 'system-monitor:processes-start',

  /**
   * Renderer → main (send): a Processes view is no longer visible.
   */
  ProcessesStop = 'system-monitor:processes-stop',

  /**
   * Main → renderer (send): one {@link ProcessesSnapshot}.
   */
  Processes = 'system-monitor:processes',

  /**
   * Renderer → main (invoke): the machine's static description, a {@link SystemInfo}.
   */
  Info = 'system-monitor:info',

  /**
   * Renderer → main (send): a GPU view became visible and wants GPU readings. Ref-counted.
   */
  GpuStart = 'system-monitor:gpu-start',

  /**
   * Renderer → main (send): a GPU view is no longer visible.
   */
  GpuStop = 'system-monitor:gpu-stop',

  /**
   * Main → renderer (send): one {@link GpuReading}.
   */
  Gpu = 'system-monitor:gpu',

  /**
   * Renderer → main (invoke): the GPU's history over a span, a {@link GpuHistory}, from the readings
   * the main process keeps in the background while GPU Monitoring is on.
   */
  GpuHistory = 'system-monitor:gpu-history',

  /**
   * Renderer → main (invoke): the icon of the app a process belongs to, by the folder its executable
   * is in ({@link ProcessSample.location}) and its name, as a PNG data URL, or null when it has none of
   * its own.
   */
  ProcessIcon = 'system-monitor:process-icon',

  /**
   * Renderer → main (send): a Storage view became visible and wants storage readings. Ref-counted.
   */
  StorageStart = 'system-monitor:storage-start',

  /**
   * Renderer → main (send): a Storage view is no longer visible.
   */
  StorageStop = 'system-monitor:storage-stop',

  /**
   * Main → renderer (send): one {@link StorageReading}.
   */
  Storage = 'system-monitor:storage',

  /**
   * Renderer → main (invoke): the machine's storage devices and the device each volume is on, a
   * {@link StorageInfo}.
   */
  StorageInfo = 'system-monitor:storage-info',

  /**
   * Renderer → main (send): a Network view became visible and wants network readings. Ref-counted.
   */
  NetworkStart = 'system-monitor:network-start',

  /**
   * Renderer → main (send): a Network view is no longer visible.
   */
  NetworkStop = 'system-monitor:network-stop',

  /**
   * Main → renderer (send): one {@link NetworkReading}.
   */
  Network = 'system-monitor:network',

  /**
   * Renderer → main (invoke): the machine's network interfaces, DNS servers and default gateway, a
   * {@link NetworkInfo}.
   */
  NetworkInfo = 'system-monitor:network-info',

  /**
   * Renderer → main (invoke): one listing of the processes now, a {@link ProcessesSnapshot}, whatever
   * view is showing. For the monitor's agent, which can be asked about processes from any view.
   */
  ProcessesRead = 'system-monitor:processes-read',

  /**
   * Renderer → main (invoke): one detailed GPU reading now, a {@link GpuReading} (two readings a moment
   * apart, so per-process shares have something to compare with), or null where it cannot be read.
   */
  GpuRead = 'system-monitor:gpu-read',

  /**
   * Renderer → main (invoke): the storage devices and their activity now, a {@link StorageSnapshot}.
   */
  StorageRead = 'system-monitor:storage-read',

  /**
   * Renderer → main (invoke): the network interfaces, their activity, the connections and the DNS
   * server's latency now, a {@link NetworkSnapshot}.
   */
  NetworkRead = 'system-monitor:network-read',
}

/**
 * Describes the machine's storage at one moment, for the monitor's agent: the devices, and their
 * activity over a moment's reading.
 */
export interface StorageSnapshot {
  /**
   * Gets the devices and the device each volume is on.
   */
  readonly info: StorageInfo;

  /**
   * Gets the devices' activity, or null where it could not be read.
   */
  readonly reading: StorageReading | null;
}

/**
 * Describes the machine's network at one moment, for the monitor's agent: the interfaces, and their
 * activity, connections and DNS latency over a moment's reading.
 */
export interface NetworkSnapshot {
  /**
   * Gets the interfaces, DNS servers and gateway.
   */
  readonly info: NetworkInfo;

  /**
   * Gets the interfaces' activity, the connections and the DNS server's latency.
   */
  readonly reading: NetworkReading;
}

/**
 * The interval between network readings while a Network view is open, in milliseconds.
 */
export const NETWORK_SAMPLE_INTERVAL_MS: number = 2_000;

/**
 * Identifies the kind of a network interface.
 */
export type NetworkInterfaceKind =
  'ethernet' | 'wifi' | 'loopback' | 'vpn' | 'bridge' | 'virtual' | 'other';

/**
 * Describes one network interface.
 */
export interface NetworkInterfaceInfo {
  /**
   * Gets the interface's identifier, as the OS names it (`en0`, `eth0`, `Ethernet`).
   */
  readonly id: string;

  /**
   * Gets the interface's friendly name (`Wi-Fi`, `Ethernet 1`), or its id where it has none.
   */
  readonly name: string;

  /**
   * Gets the kind of interface.
   */
  readonly kind: NetworkInterfaceKind;

  /**
   * Gets whether the interface is up.
   */
  readonly up: boolean;

  /**
   * Gets whether the interface carries the default route.
   */
  readonly isDefault: boolean;

  /**
   * Gets the interface's hardware (MAC) address, where it has one.
   */
  readonly mac?: string;

  /**
   * Gets the interface's IPv4 address, where it has one.
   */
  readonly ipv4?: string;

  /**
   * Gets the interface's IPv6 address, a global one where it has one, where it has any.
   */
  readonly ipv6?: string;

  /**
   * Gets the interface's link speed, in megabits per second, where reported.
   */
  readonly speedMbps?: number;

  /**
   * Gets the interface's MTU, in bytes, where reported.
   */
  readonly mtu?: number;
}

/**
 * Describes the machine's networking: its interfaces, the default interface first, and how it
 * resolves names and reaches other networks.
 */
export interface NetworkInfo {
  /**
   * Gets the interfaces.
   */
  readonly interfaces: readonly NetworkInterfaceInfo[];

  /**
   * Gets the DNS servers the system resolves names through.
   */
  readonly dnsServers: readonly string[];

  /**
   * Gets the default gateway's address, where there is one.
   */
  readonly gateway?: string;
}

/**
 * Describes one interface's activity in a {@link NetworkReading}.
 */
export interface NetworkInterfaceReading {
  /**
   * Gets the interface's id ({@link NetworkInterfaceInfo.id}).
   */
  readonly id: string;

  /**
   * Gets the bytes received per second since the last reading.
   */
  readonly rxBytesPerSecond: number;

  /**
   * Gets the bytes sent per second since the last reading.
   */
  readonly txBytesPerSecond: number;

  /**
   * Gets the packets received per second since the last reading.
   */
  readonly rxPacketsPerSecond: number;

  /**
   * Gets the packets sent per second since the last reading.
   */
  readonly txPacketsPerSecond: number;

  /**
   * Gets the bytes received since the interface's counters started (usually boot).
   */
  readonly totalRxBytes: number;

  /**
   * Gets the bytes sent since the interface's counters started.
   */
  readonly totalTxBytes: number;

  /**
   * Gets the packets received since the interface's counters started.
   */
  readonly totalRxPackets: number;

  /**
   * Gets the packets sent since the interface's counters started.
   */
  readonly totalTxPackets: number;

  /**
   * Gets the packets received with errors since the counters started.
   */
  readonly rxErrors: number;

  /**
   * Gets the packets that failed to send since the counters started.
   */
  readonly txErrors: number;

  /**
   * Gets the packets dropped, in either direction, since the counters started.
   */
  readonly dropped: number;
}

/**
 * Describes one network connection (or listening socket).
 */
export interface NetworkConnection {
  /**
   * Gets the protocol (`TCP`, `UDP`).
   */
  readonly protocol: string;

  /**
   * Gets the local address and port (`192.168.1.42:52138`).
   */
  readonly local: string;

  /**
   * Gets the remote address and port, or the empty string for a socket with no peer.
   */
  readonly remote: string;

  /**
   * Gets the connection's state (`ESTABLISHED`, `LISTEN`), or the empty string where it has none.
   */
  readonly state: string;

  /**
   * Gets the owning process's pid, where known.
   */
  readonly pid?: number;

  /**
   * Gets the owning process's name, where known.
   */
  readonly process?: string;

  /**
   * Gets the folder the owning process's executable is in, where known; the key its icon is looked up
   * by ({@link SystemMonitorChannel.ProcessIcon}).
   */
  readonly location?: string;
}

/**
 * Describes one reading of the machine's network.
 */
export interface NetworkReading {
  /**
   * Gets when the reading was taken, as an ISO-8601 string.
   */
  readonly timestamp: string;

  /**
   * Gets each interface's activity.
   */
  readonly interfaces: readonly NetworkInterfaceReading[];

  /**
   * Gets the connections, when they were read with this reading; they are read less often than the
   * interfaces, and a reading without them leaves the last ones standing.
   */
  readonly connections?: readonly NetworkConnection[];

  /**
   * Gets how long the system's DNS server took to answer, in milliseconds, when it was measured with
   * this reading.
   */
  readonly dnsLatencyMs?: number;
}

/**
 * The interval between storage readings while a Storage view is open, in milliseconds.
 */
export const STORAGE_SAMPLE_INTERVAL_MS: number = 2_000;

/**
 * Identifies the kind of a storage device.
 */
export type StorageDeviceKind = 'nvme' | 'ssd' | 'hdd' | 'usb' | 'virtual' | 'other';

/**
 * Describes one physical storage device (a drive, not a volume on it).
 */
export interface StorageDevice {
  /**
   * Gets the device's identifier: its BSD name on macOS (`disk0`), its kernel name on Linux
   * (`nvme0n1`), its physical-disk number on Windows (`0`).
   */
  readonly id: string;

  /**
   * Gets the device's model name.
   */
  readonly name: string;

  /**
   * Gets the device's vendor, where reported.
   */
  readonly vendor?: string;

  /**
   * Gets the kind of device.
   */
  readonly kind: StorageDeviceKind;

  /**
   * Gets how the device is connected (`PCIe 3.0 x4`, `SATA`, `USB`), where reported.
   */
  readonly connection?: string;

  /**
   * Gets the device's capacity, in bytes.
   */
  readonly sizeBytes: number;

  /**
   * Gets the device's serial number, where reported.
   */
  readonly serial?: string;

  /**
   * Gets the device's firmware revision, where reported.
   */
  readonly firmware?: string;

  /**
   * Gets the device's self-reported (S.M.A.R.T.) health, where the platform reports it.
   */
  readonly health?: 'ok' | 'failing';
}

/**
 * Describes the device a volume is on.
 */
export interface StorageVolumeDevice {
  /**
   * Gets the volume's mount point.
   */
  readonly mount: string;

  /**
   * Gets the id of the device it is on, or undefined when it could not be worked out.
   */
  readonly deviceId?: string;

  /**
   * Gets the volume's name (its label), where it has one.
   */
  readonly name?: string;
}

/**
 * Describes the machine's storage: its devices, and the device each volume is on.
 */
export interface StorageInfo {
  /**
   * Gets the physical storage devices, the one the system runs from first where known.
   */
  readonly devices: readonly StorageDevice[];

  /**
   * Gets the device each mounted volume is on.
   */
  readonly volumes: readonly StorageVolumeDevice[];
}

/**
 * Describes one device's activity in a {@link StorageReading}.
 */
export interface StorageDeviceReading {
  /**
   * Gets the device's id ({@link StorageDevice.id}).
   */
  readonly id: string;

  /**
   * Gets the bytes read per second since the last reading.
   */
  readonly readBytesPerSecond: number;

  /**
   * Gets the bytes written per second since the last reading.
   */
  readonly writeBytesPerSecond: number;

  /**
   * Gets the read operations per second since the last reading.
   */
  readonly readOpsPerSecond: number;

  /**
   * Gets the write operations per second since the last reading.
   */
  readonly writeOpsPerSecond: number;

  /**
   * Gets the share of the time since the last reading the device was busy, 0–100, where reported.
   */
  readonly utilisationPercent?: number;

  /**
   * Gets the device's temperature, in °C, where reported.
   */
  readonly temperatureC?: number;

  /**
   * Gets the bytes read since the device's counters started (usually boot).
   */
  readonly totalReadBytes: number;

  /**
   * Gets the bytes written since the device's counters started.
   */
  readonly totalWriteBytes: number;

  /**
   * Gets the read operations since the device's counters started.
   */
  readonly totalReadOps: number;

  /**
   * Gets the write operations since the device's counters started.
   */
  readonly totalWriteOps: number;
}

/**
 * Describes one reading of the machine's storage devices.
 */
export interface StorageReading {
  /**
   * Gets when the reading was taken, as an ISO-8601 string.
   */
  readonly timestamp: string;

  /**
   * Gets each device's activity.
   */
  readonly devices: readonly StorageDeviceReading[];
}

/**
 * The time between GPU readings while a GPU view is visible, in milliseconds.
 */
export const GPU_SAMPLE_INTERVAL_MS: number = 2_000;

/**
 * The time between the background GPU readings kept for the GPU's history, in milliseconds.
 */
export const GPU_HISTORY_INTERVAL_MS: number = 10_000;

/**
 * The longest span of GPU history kept, in milliseconds: a day.
 */
export const GPU_HISTORY_SPAN_MS: number = 24 * 60 * 60 * 1000;

/**
 * Identifies what a GPU engine does.
 */
export type GpuEngineKind = '3d' | 'decode' | 'encode' | 'copy' | 'compute' | 'other';

/**
 * Describes one GPU engine's activity.
 */
export interface GpuEngineReading {
  /**
   * Gets what the engine does.
   */
  readonly kind: GpuEngineKind;

  /**
   * Gets the engine's name as the view shows it (`3D / Graphics`, `Video Decode`).
   */
  readonly label: string;

  /**
   * Gets the engine's activity, in {@link unit}.
   */
  readonly value: number;

  /**
   * Gets what the activity is measured in: a percentage busy (Windows, NVIDIA, Apple silicon), or the
   * commands submitted each second (AMD on macOS, which reports no busy share per engine).
   */
  readonly unit: 'percent' | 'commands';
}

/**
 * Describes one process's use of the GPU.
 */
export interface GpuProcessReading {
  /**
   * Gets the process's pid.
   */
  readonly pid: number;

  /**
   * Gets the process's name, where the reading carries one.
   */
  readonly name?: string;

  /**
   * Gets the process's share of the GPU, 0–100, where reported.
   */
  readonly gpuPercent?: number;

  /**
   * Gets the GPU memory the process holds, in bytes, where reported.
   */
  readonly memoryBytes?: number;

  /**
   * Gets the process's share of the video encoder, 0–100, where reported.
   */
  readonly encoderPercent?: number;

  /**
   * Gets the process's share of the video decoder, 0–100, where reported.
   */
  readonly decoderPercent?: number;
}

/**
 * Describes one reading of the GPU, as far as the platform reports it.
 */
export interface GpuReading {
  /**
   * Gets when the reading was taken, as an ISO-8601 string.
   */
  readonly timestamp: string;

  /**
   * Gets the GPU's utilisation, 0–100.
   */
  readonly utilisationPercent?: number;

  /**
   * Gets the video memory in use, in bytes.
   */
  readonly memoryUsedBytes?: number;

  /**
   * Gets the video memory there is, in bytes.
   */
  readonly memoryTotalBytes?: number;

  /**
   * Gets the video memory the driver reserves, in bytes.
   */
  readonly memoryReservedBytes?: number;

  /**
   * Gets the GPU's temperature, in °C.
   */
  readonly temperatureC?: number;

  /**
   * Gets the GPU's power draw, in watts.
   */
  readonly powerWatts?: number;

  /**
   * Gets the GPU's power limit, in watts.
   */
  readonly powerLimitWatts?: number;

  /**
   * Gets the fan's speed, in revolutions a minute.
   */
  readonly fanRpm?: number;

  /**
   * Gets the fan's speed as a share of its maximum, 0–100.
   */
  readonly fanPercent?: number;

  /**
   * Gets the core clock, in MHz.
   */
  readonly coreClockMhz?: number;

  /**
   * Gets the memory clock, in MHz.
   */
  readonly memoryClockMhz?: number;

  /**
   * Gets each engine's activity, those the platform reports.
   */
  readonly engines: readonly GpuEngineReading[];

  /**
   * Gets each process's use of the GPU, those the platform reports, busiest first.
   */
  readonly processes: readonly GpuProcessReading[];
}

/**
 * Describes one point of the GPU's history.
 */
export interface GpuHistoryPoint {
  /**
   * Gets when the point was read, in milliseconds since the epoch.
   */
  readonly time: number;

  /**
   * Gets the GPU's utilisation, 0–100, or undefined where not read.
   */
  readonly utilisationPercent?: number;

  /**
   * Gets the video memory in use, in bytes, or undefined where not read.
   */
  readonly memoryUsedBytes?: number;
}

/**
 * Describes the GPU's history over a span, evened out to at most a few hundred points.
 */
export interface GpuHistory {
  /**
   * Gets the points, oldest first.
   */
  readonly points: readonly GpuHistoryPoint[];

  /**
   * Gets the time each point stands for, in milliseconds.
   */
  readonly intervalMs: number;
}

/**
 * The time between process snapshots, in milliseconds. Fixed rather than following the refresh rate:
 * listing every process is a `ps` (or WMI query) each time, too costly to run at a metrics sample's
 * pace.
 */
export const PROCESS_SAMPLE_INTERVAL_MS: number = 2_000;

/**
 * The most processes a snapshot carries: the busiest by CPU, then by memory.
 */
export const PROCESS_SNAPSHOT_LIMIT: number = 200;

/**
 * The number of samples the agent's capabilities keep to answer from.
 */
export const METRICS_HISTORY: number = 60;

/**
 * Works out how many samples hold a span of time, so a graph's history is the same length of time at
 * every Refresh Rate.
 * @param minutes The span of time, in minutes.
 * @param intervalMs The time between samples, in milliseconds; 0 while paused.
 * @returns Returns the number of samples.
 */
export function historySamples(minutes: number, intervalMs: number): number {
  const interval: number = intervalMs > 0 ? intervalMs : DEFAULT_SAMPLE_INTERVAL_MS;
  return Math.ceil((minutes * 60_000) / interval);
}

/**
 * How often samples are taken unless the user chose otherwise, in milliseconds: once a second, the
 * rate the sparklines were drawn for.
 */
export const DEFAULT_SAMPLE_INTERVAL_MS: number = 1_000;

/**
 * The shortest and longest sampling interval the backend accepts, in milliseconds. A rate outside
 * this range is clamped to it, so a stray value cannot make the backend spin or go quiet for good.
 */
export const SAMPLE_INTERVAL_RANGE_MS: { readonly min: number; readonly max: number } = {
  min: 250,
  max: 10_000,
};

/**
 * Describes how often the backend should sample.
 */
export interface SamplingRate {
  /**
   * Gets the time between samples, in milliseconds.
   */
  readonly intervalMs: number;

  /**
   * Gets whether the GPU is read; absent means it is.
   */
  readonly gpu?: boolean;
}

/**
 * Describes machine memory use at a moment.
 */
export interface MemoryMetric {
  /**
   * Gets the bytes of physical memory in use.
   */
  readonly usedBytes: number;

  /**
   * Gets the total bytes of physical memory.
   */
  readonly totalBytes: number;

  /**
   * Gets the percentage of physical memory in use, 0–100.
   */
  readonly percent: number;
}

/**
 * Describes network throughput at a moment, summed across interfaces. Network is a rate, not a
 * percentage — the tile shows bytes/second, not a fabricated "%".
 */
export interface NetworkMetric {
  /**
   * Gets the inbound throughput in bytes per second.
   */
  readonly rxBytesPerSec: number;

  /**
   * Gets the outbound throughput in bytes per second.
   */
  readonly txBytesPerSec: number;
}

/**
 * Describes disk I/O throughput at a moment. Disk is a rate, not a percentage — the tile shows
 * bytes/second read and written.
 */
export interface DiskMetric {
  /**
   * Gets the read throughput in bytes per second.
   */
  readonly readBytesPerSec: number;

  /**
   * Gets the write throughput in bytes per second.
   */
  readonly writeBytesPerSec: number;
}

/**
 * Describes GPU utilisation at a moment. GPU load is best-effort and platform-dependent (commonly
 * unavailable on macOS), so {@link available} states whether a real reading was obtained rather than
 * reporting a misleading zero.
 */
export interface GpuMetric {
  /**
   * Gets a value indicating whether a real GPU utilisation reading was obtained.
   */
  readonly available: boolean;

  /**
   * Gets the GPU utilisation, 0–100; meaningful only when {@link available} is true.
   */
  readonly percent: number;

  /**
   * Gets where the reading came from, or undefined when none was obtained.
   */
  readonly source?: GpuSource;

  /**
   * Gets the video memory in use, in bytes, where the source reports it.
   */
  readonly memoryUsedBytes?: number;

  /**
   * Gets the video memory there is, in bytes, where the source reports it.
   */
  readonly memoryTotalBytes?: number;
}

/**
 * Identifies where a GPU reading came from.
 * - `ioreg`: macOS's IOAccelerator statistics.
 * - `nvidia-smi`: NVIDIA's driver tool, which systeminformation reads on Windows and Linux.
 */
export type GpuSource = 'ioreg' | 'nvidia-smi';

/**
 * Describes one graphics controller.
 */
export interface GpuInfo {
  /**
   * Gets the controller's model (for example `AMD Radeon Pro W5700X`).
   */
  readonly model: string;

  /**
   * Gets the controller's vendor, or the empty string when unknown.
   */
  readonly vendor: string;

  /**
   * Gets the controller's dedicated memory in bytes, or undefined when it has none or it is unknown.
   */
  readonly memoryBytes?: number;

  /**
   * Gets the driver and its version (`AMDRadeonX6000 7.0.1`, `560.35.03`), or undefined when unknown.
   */
  readonly driver?: string;

  /**
   * Gets the GPU's architecture (`RDNA 2`, `Ada Lovelace`), or undefined when unknown.
   */
  readonly architecture?: string;

  /**
   * Gets the bus it sits on (`PCIe Gen 4 ×16`, `PCIe ×16`), or undefined when unknown.
   */
  readonly bus?: string;
}

/**
 * Describes this application's own share of resource use at a moment, summed across its whole process
 * tree (the Electron main, every renderer window, the GPU and any utility processes). Only CPU and
 * memory can be attributed to the app portably; network, disk and GPU utilisation have no per-process
 * source, so they are reported machine-wide only.
 */
export interface AppUsageMetric {
  /**
   * Gets the app's CPU use as a share of total machine capacity, 0–100 — normalised by the logical
   * core count so it is directly comparable to the machine-wide {@link MetricsSample.cpu}.
   */
  readonly cpuPercent: number;

  /**
   * Gets the bytes of physical memory the app's processes hold (summed working sets).
   */
  readonly memoryBytes: number;

  /**
   * Gets the app's memory use as a percentage of total physical memory, 0–100.
   */
  readonly memoryPercent: number;
}

/**
 * Describes one sampled snapshot of machine metrics. CPU and memory are always present; network, disk
 * and GPU are present when the platform provides them (GPU is best-effort); the app's own share is
 * present when it could be read.
 */
export interface MetricsSample {
  /**
   * Gets the time the sample was taken, as an ISO-8601 string.
   */
  readonly timestamp: string;

  /**
   * Gets the machine-wide CPU utilisation, 0–100.
   */
  readonly cpu: number;

  /**
   * Gets the machine memory use.
   */
  readonly memory: MemoryMetric;

  /**
   * Gets the network throughput, or undefined when unavailable.
   */
  readonly network?: NetworkMetric;

  /**
   * Gets the disk I/O throughput, or undefined when unavailable.
   */
  readonly disk?: DiskMetric;

  /**
   * Gets the GPU utilisation reading, or undefined when unavailable.
   */
  readonly gpu?: GpuMetric;

  /**
   * Gets this application's own share of CPU and memory, or undefined when it could not be read (for
   * example outside the Electron runtime).
   */
  readonly app?: AppUsageMetric;

  /**
   * Gets each logical core's utilisation, 0–100, in the order the OS lists them, or undefined before
   * the first delta.
   */
  readonly cores?: readonly number[];

  /**
   * Gets the memory breakdown beyond used and total, or undefined when unavailable.
   */
  readonly memoryDetail?: MemoryDetailMetric;

  /**
   * Gets each network interface's throughput, or undefined when unavailable.
   */
  readonly interfaces?: readonly InterfaceMetric[];

  /**
   * Gets each mounted volume's space, or undefined when unavailable.
   */
  readonly volumes?: readonly VolumeMetric[];
}

/**
 * Describes memory beyond used and total.
 */
export interface MemoryDetailMetric {
  /**
   * Gets the memory available to start new work without swapping, in bytes. On macOS and Linux this is
   * more than the free memory, since cached file data is given up on demand.
   */
  readonly availableBytes: number;

  /**
   * Gets the swap space in use, in bytes.
   */
  readonly swapUsedBytes: number;

  /**
   * Gets the swap space configured, in bytes.
   */
  readonly swapTotalBytes: number;

  /**
   * Gets the memory apps hold (anonymous memory, less what macOS may purge), in bytes, where the
   * platform reports it.
   */
  readonly appBytes?: number;

  /**
   * Gets the memory the kernel has wired down and cannot page out, in bytes, where the platform reports
   * it (macOS's wired memory; Windows' non-paged pool).
   */
  readonly wiredBytes?: number;

  /**
   * Gets the memory the compressor occupies, in bytes, where the platform compresses memory and reports
   * it (macOS's compressor, Windows' Memory Compression, Linux's zswap).
   */
  readonly compressedBytes?: number;

  /**
   * Gets the memory caching files, which the system gives up on demand, in bytes, where reported.
   */
  readonly cachedBytes?: number;

  /**
   * Gets the memory holding nothing at all, in bytes, where reported.
   */
  readonly freeBytes?: number;

  /**
   * Gets the pages read in from disk since boot, where reported.
   */
  readonly pageIns?: number;

  /**
   * Gets the pages written out to disk since boot, where reported.
   */
  readonly pageOuts?: number;

  /**
   * Gets how hard pressed memory is, where the platform says or it can be worked out.
   */
  readonly pressure?: MemoryPressure;
}

/**
 * Describes how hard pressed memory is.
 */
export interface MemoryPressure {
  /**
   * Gets the pressure's level: `normal` (plenty available), `warning` (in demand: compressing and
   * swapping), or `critical` (short: apps may slow or be ended).
   */
  readonly level: 'normal' | 'warning' | 'critical';

  /**
   * Gets the pressure as a percentage, 0–100, for its graph and bar: on macOS how much of the memory
   * the system wants free is not; on Linux the share of time tasks stalled for memory; on Windows the
   * share not available.
   */
  readonly percent: number;
}

/**
 * Describes one memory module (DIMM).
 */
export interface MemoryModule {
  /**
   * Gets the slot the module sits in (`DIMM 1`, `Slot 3 (Channel E / DIMM 1)`).
   */
  readonly slot: string;

  /**
   * Gets the module's size, in bytes.
   */
  readonly sizeBytes: number;

  /**
   * Gets the module's type (`DDR4 R-DIMM`), or the empty string when unknown.
   */
  readonly type: string;

  /**
   * Gets the module's data rate in MT/s, or undefined when unknown.
   */
  readonly speedMts?: number;

  /**
   * Gets the module's status as the platform reports it (`OK`), or undefined when it reports none.
   */
  readonly status?: string;

  /**
   * Gets the module's manufacturer, or the empty string when unknown.
   */
  readonly manufacturer: string;

  /**
   * Gets the module's part number, or the empty string when unknown.
   */
  readonly partNumber: string;
}

/**
 * Describes one network interface's throughput.
 */
export interface InterfaceMetric {
  /**
   * Gets the interface's name (for example `en0`).
   */
  readonly name: string;

  /**
   * Gets the received throughput, in bytes per second.
   */
  readonly rxBytesPerSec: number;

  /**
   * Gets the sent throughput, in bytes per second.
   */
  readonly txBytesPerSec: number;
}

/**
 * Describes one mounted volume's space.
 */
export interface VolumeMetric {
  /**
   * Gets where the volume is mounted (for example `/` or `C:`).
   */
  readonly mount: string;

  /**
   * Gets the file system type (for example `apfs` or `NTFS`).
   */
  readonly type: string;

  /**
   * Gets the volume's size, in bytes.
   */
  readonly sizeBytes: number;

  /**
   * Gets the space in use, in bytes.
   */
  readonly usedBytes: number;
}

/**
 * Identifies which of Studio's own processes a process is.
 * - `main`: Electron's main (browser) process.
 * - `renderer`: a window's renderer.
 * - `gpu`: Electron's GPU process.
 * - `utility`: another Electron helper (network service, utility process).
 * - `child`: a process Studio started, or one started by one of those (shells, language servers,
 *   agents, builds).
 */
export type StudioProcessKind = 'main' | 'renderer' | 'gpu' | 'utility' | 'child';

/**
 * Describes one process in a {@link ProcessesSnapshot}.
 */
export interface ProcessSample {
  /**
   * Gets the process identifier.
   */
  readonly pid: number;

  /**
   * Gets the parent's process identifier, or 0 when unknown.
   */
  readonly parentPid: number;

  /**
   * Gets the process's name.
   */
  readonly name: string;

  /**
   * Gets the process's command line, or its name when the OS does not report one.
   */
  readonly command: string;

  /**
   * Gets the user the process runs as, or the empty string when unknown.
   */
  readonly user: string;

  /**
   * Gets the process's share of the whole machine's CPU, 0–100, comparable to the machine reading.
   */
  readonly cpuPercent: number;

  /**
   * Gets the process's resident memory, in bytes.
   */
  readonly memoryBytes: number;

  /**
   * Gets the process's resident memory as a share of physical memory, 0–100.
   */
  readonly memoryPercent: number;

  /**
   * Gets which of Studio's own processes this is, or undefined when it is not Studio's.
   */
  readonly studio?: StudioProcessKind;

  /**
   * Gets the number of threads the process runs, or undefined when it could not be read.
   */
  readonly threads?: number;

  /**
   * Gets the CPU time the process has used since it started (user and system), in seconds, or
   * undefined when it could not be read.
   */
  readonly cpuTimeSeconds?: number;

  /**
   * Gets when the process started, in milliseconds since the epoch, or undefined when unknown.
   */
  readonly startedAt?: number;

  /**
   * Gets the folder the process's executable is in, or undefined when unknown; the key its icon is
   * looked up by ({@link SystemMonitorChannel.ProcessIcon}).
   */
  readonly location?: string;
}

/**
 * Describes one level of the CPU's cache.
 */
export interface CacheInfo {
  /**
   * Gets the cache level (`L1`, `L2`, `L3`). L1 counts its data and instruction caches together.
   */
  readonly level: 'L1' | 'L2' | 'L3';

  /**
   * Gets the cache's size across the whole processor, in bytes.
   */
  readonly totalBytes: number;

  /**
   * Gets each core's own share, in bytes, where the cache is per core and the platform says so;
   * undefined for a shared cache, or where the platform reports only the total.
   */
  readonly perCoreBytes?: number;
}

/**
 * Describes one listing of the machine's processes.
 */
export interface ProcessesSnapshot {
  /**
   * Gets the time the listing was taken, as an ISO-8601 string.
   */
  readonly timestamp: string;

  /**
   * Gets the processes listed: every one of Studio's, and the busiest of the rest up to
   * {@link PROCESS_SNAPSHOT_LIMIT} in all.
   */
  readonly processes: readonly ProcessSample[];

  /**
   * Gets the number of processes running, listed or not.
   */
  readonly total: number;

  /**
   * Gets the account Studio runs as, which the user's own processes run as too; the empty string when
   * unknown.
   */
  readonly user: string;
}

/**
 * Describes the machine: what does not change while Studio runs.
 */
export interface SystemInfo {
  /**
   * Gets the CPU's model name.
   */
  readonly cpuModel: string;

  /**
   * Gets the number of logical cores (hardware threads).
   */
  readonly logicalCores: number;

  /**
   * Gets the number of physical cores, or undefined when unknown.
   */
  readonly physicalCores?: number;

  /**
   * Gets the number of performance cores on a hybrid CPU, or undefined when not hybrid or unknown.
   */
  readonly performanceCores?: number;

  /**
   * Gets the number of efficiency cores on a hybrid CPU, or undefined when not hybrid or unknown.
   */
  readonly efficiencyCores?: number;

  /**
   * Gets the CPU's base speed in GHz, or undefined when unknown.
   */
  readonly speedGhz?: number;

  /**
   * Gets the CPU's maximum (turbo) speed in GHz, or undefined unless the OS reports one above the base.
   */
  readonly maxSpeedGhz?: number;

  /**
   * Gets the CPU's architecture (`x86_64`, `arm64`).
   */
  readonly architecture: string;

  /**
   * Gets the CPU's caches, smallest level first, those the OS reports.
   */
  readonly caches: readonly CacheInfo[];

  /**
   * Gets the total physical memory, in bytes.
   */
  readonly totalMemoryBytes: number;

  /**
   * Gets the operating system's name and version (for example `macOS 26.6`).
   */
  readonly os: string;

  /**
   * Gets when the machine started, in milliseconds since the epoch, for its uptime; undefined where the
   * OS will not say (a sandboxed process can be refused it).
   */
  readonly bootTime?: number;

  /**
   * Gets the machine's graphics controllers, or an empty list when they could not be read.
   */
  readonly gpus: readonly GpuInfo[];

  /**
   * Gets the installed memory modules, or an empty list where the platform will not say (Linux needs
   * administrator rights to read them).
   */
  readonly memoryModules: readonly MemoryModule[];

  /**
   * Gets the number of memory slots, filled or not, or undefined when unknown.
   */
  readonly memorySlots?: number;

  /**
   * Gets whether the memory corrects errors (ECC), or undefined when unknown.
   */
  readonly memoryEcc?: boolean;
}
