import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { app, IpcMainEvent, nativeImage } from 'electron';
import * as si from 'systeminformation';
import {
  AppUsageMetric,
  DEFAULT_SAMPLE_INTERVAL_MS,
  DiskMetric,
  GpuMetric,
  InterfaceMetric,
  MemoryDetailMetric,
  MetricsSample,
  NetworkMetric,
  GPU_HISTORY_INTERVAL_MS,
  GPU_HISTORY_SPAN_MS,
  GPU_SAMPLE_INTERVAL_MS,
  GpuHistory,
  GpuHistoryPoint,
  GpuInfo,
  GpuReading,
  PROCESS_SAMPLE_INTERVAL_MS,
  PROCESS_SNAPSHOT_LIMIT,
  ProcessesSnapshot,
  ProcessSample,
  SamplingRate,
  STORAGE_SAMPLE_INTERVAL_MS,
  StorageInfo,
  StorageReading,
  StorageVolumeDevice,
  SystemInfo,
  SystemMonitorChannel,
  VolumeMetric,
} from '@shared/api/system-monitor-channels';
import { logger } from '../../logger';
import { ContributionContext, MainContribution } from '../main-contribution';
import {
  architectureName,
  NetworkStat,
  parseIoregGpu,
  readCaches,
  readGpus,
  pickGpu,
  readAppUsage,
  readDisk,
  readInterfaces,
  readMemoryDetail,
  readVolumes,
  sumNetwork,
} from './metrics-readers';
import {
  darwinMemory,
  darwinMemoryModules,
  layoutMemoryModules,
  linuxMemory,
  MemoryBreakdown,
  MemoryModules,
  SystemProfilerMemory,
  windowsMemory,
  WindowsMemory,
} from './memory-readers';
import {
  joinDarwinExtras,
  parseDarwinThreads,
  parseDarwinTimes,
  parseProcStat,
  parseWindowsProcesses,
  ProcessExtras,
  WindowsProcess,
} from './process-extras';
import { ElectronProcess, readProcesses } from './process-readers';
import { iconTarget } from './process-icons';
import { architectureOf, parseIoregStatistics } from './gpu-readers';
import { GpuSampler, GpuSources } from './gpu-sampler';
import { MetricsSampler } from './metrics-sampler';
import {
  deviceOfVolume,
  parseApfsContainers,
  parseProfiledDisks,
  ProfiledDisk,
  readStorageDevices,
  StorageCounters,
  WindowsDisks,
} from './storage-readers';
import { StorageSampler } from './storage-sampler';
import { HeavyCadence, normaliseSamplingInterval } from './sampling-cadence';

/**
 * The costly readings, carried forward between the ticks they are taken on.
 */
interface HeavyReadings {
  readonly network: NetworkMetric | undefined;
  readonly interfaces: readonly InterfaceMetric[] | undefined;
  readonly disk: DiskMetric | undefined;
  readonly gpu: GpuMetric | undefined;
  readonly memoryDetail: MemoryDetailMetric | undefined;
}

/**
 * The least time between volume readings, in milliseconds. Volume space changes slowly and reading it
 * is a `df` (or WMI query), so it is taken far less often than the other costly readings.
 */
const VOLUME_SAMPLE_INTERVAL_MS: number = 15_000;

/**
 * The least time between readings of each process's threads and CPU time, in milliseconds. They
 * change slowly, and on Windows reading them is a PowerShell WMI query, so they are read far less
 * often than the listing itself and carried forward between.
 */
const EXTRAS_SAMPLE_INTERVAL_MS: number = 6_000;

/**
 * The PowerShell that lists each Windows process's threads and CPU time as JSON.
 */
const WINDOWS_EXTRAS_COMMAND: string =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ThreadCount,UserModeTime,KernelModeTime | ConvertTo-Json -Compress';

/**
 * The least time between readings of Windows' memory counters, in milliseconds: each is a PowerShell
 * query, so they are read far less often than the rest of the memory breakdown and carried forward.
 */
const WINDOWS_MEMORY_SAMPLE_INTERVAL_MS: number = 15_000;

/**
 * The PowerShell that reads Windows' memory counters and Memory Compression's working set as JSON.
 */
const WINDOWS_MEMORY_COMMAND: string = [
  '$m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory | Select-Object PagesInputPersec,PagesOutputPersec,CacheBytes,StandbyCacheNormalPriorityBytes,StandbyCacheReserveBytes,StandbyCacheCoreBytes,ModifiedPageListBytes,PoolNonpagedBytes,FreeAndZeroPageListBytes',
  "$c = (Get-Process -Name 'Memory Compression' -ErrorAction SilentlyContinue).WorkingSet64",
  '[pscustomobject]@{ memory = $m; compressed = $c } | ConvertTo-Json -Compress',
].join('; ');

/**
 * The most points a span of GPU history is evened out to.
 */
const GPU_HISTORY_POINTS: number = 360;

/**
 * How much slower the background GPU history is read where a reading is costly (Windows' counters, a
 * PowerShell query of a second or more): every third tick.
 */
const COSTLY_GPU_HISTORY_EVERY: number = 3;

/**
 * The size a macOS app's icon is read at, in pixels: a list row draws it at 20 CSS pixels, so this is
 * sharp at twice that.
 */
const PROCESS_ICON_PX: number = 40;

/**
 * The platforms whose process listing reports CPU per core (`ps`'s `%cpu`) rather than as a share of
 * the whole machine.
 */
const PER_CORE_CPU_PLATFORMS: ReadonlySet<string> = new Set<string>([
  'darwin',
  'freebsd',
  'openbsd',
  'netbsd',
  'sunos',
]);

/**
 * The heavy readings before any has been taken.
 */
const NO_HEAVY_READINGS: HeavyReadings = {
  network: undefined,
  interfaces: undefined,
  disk: undefined,
  gpu: undefined,
  memoryDetail: undefined,
};

/**
 * Runs a command and resolves with its stdout, promisified from {@link execFile}.
 */
const run: (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }> = promisify(execFile);

/**
 * The System Monitor's metrics backend contribution. It samples machine CPU, memory, network, disk and
 * (best-effort) GPU on an interval and pushes each {@link MetricsSample} to the renderer, but only
 * while a view has asked it to: the
 * renderer starts sampling when its tab shows and stops when it hides, so nothing is sampled when the
 * monitor is not on screen (the performance-audit posture). Requests are ref-counted, so several open
 * monitors share one sampling loop. It declares no permissions — reading OS metrics needs none.
 *
 * The rate is the user's (audit P3): the renderer sends the refresh rate it was configured with, and
 * a loop already running is re-timed at once. Whatever the rate, the costly readings — network, disk
 * and GPU, each a process on macOS — are taken at most every few seconds and carried forward between,
 * and a GPU source that reports nothing is not asked again until sampling next starts.
 */
export class SystemMonitorContribution implements MainContribution {
  /**
   * The stable contribution id and IPC channel namespace.
   */
  public readonly id: string = 'system-monitor';

  /**
   * The metrics sampler, reset each time sampling starts so the first CPU delta is fresh.
   */
  private sampler: MetricsSampler = new MetricsSampler();

  /**
   * The active sampling interval, or null when idle.
   */
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * The number of renderer consumers currently asking for samples.
   */
  private consumers: number = 0;

  /**
   * The contribution context, held so ticks can push to the renderer. Null until activated.
   */
  private context: ContributionContext | null = null;

  /**
   * Whether a sample is currently being gathered, so a slow read cannot let ticks overlap.
   */
  private sampling: boolean = false;

  /**
   * The time between samples, in milliseconds, as last set by a renderer.
   */
  private intervalMs: number = DEFAULT_SAMPLE_INTERVAL_MS;

  /**
   * Decides the ticks the costly readings are taken on, reset each time sampling starts.
   */
  private heavyCadence: HeavyCadence = new HeavyCadence();

  /**
   * The costly readings last taken, carried forward on the ticks between.
   */
  private heavy: HeavyReadings = NO_HEAVY_READINGS;

  /**
   * Decides the ticks the volumes are read on, reset each time sampling starts.
   */
  private volumeCadence: HeavyCadence = new HeavyCadence(VOLUME_SAMPLE_INTERVAL_MS);

  /**
   * Decides the ticks Windows' memory counters are read on, reset each time sampling starts.
   */
  private windowsMemoryCadence: HeavyCadence = new HeavyCadence(WINDOWS_MEMORY_SAMPLE_INTERVAL_MS);

  /**
   * Windows' memory counters as last read, carried forward between their readings.
   */
  private windowsMemoryReading: WindowsMemory | undefined = undefined;

  /**
   * The volumes last read, carried forward on the ticks between.
   */
  private volumes: readonly VolumeMetric[] | undefined = undefined;

  /**
   * The number of renderer consumers currently asking for process snapshots.
   */
  private processConsumers: number = 0;

  /**
   * The process snapshot interval, or null when no consumer wants snapshots.
   */
  private processTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Whether a process snapshot is being taken, so a slow listing cannot let ticks overlap.
   */
  private listing: boolean = false;

  /**
   * The number of renderer consumers currently asking for GPU readings.
   */
  private gpuConsumers: number = 0;

  /**
   * The GPU reading interval, or null when no consumer wants readings.
   */
  private gpuTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Reads the GPU for the GPU view, with its engines and processes; replaced each time readings start,
   * so its rates begin afresh.
   */
  private gpuSampler: GpuSampler = new GpuSampler(gpuSources(), true);

  /**
   * Whether a GPU reading is being taken, so a slow read cannot let ticks overlap.
   */
  private readingGpu: boolean = false;

  /**
   * The number of Storage views that want storage readings.
   */
  private storageConsumers: number = 0;

  /**
   * The timer taking storage readings, or null while none are wanted.
   */
  private storageTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Reads the storage devices' activity; replaced each time readings start, so the first reading
   * compares with nothing stale.
   */
  private storageSampler: StorageSampler = new StorageSampler(gpuSources());

  /**
   * Whether a storage reading is under way, so a slow one is not stacked on.
   */
  private readingStorage: boolean = false;

  /**
   * The background GPU history interval, or null while GPU Monitoring is off.
   */
  private gpuHistoryTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Reads the GPU for its history: its figures alone, on a sampler of its own.
   */
  private gpuHistorySampler: GpuSampler = new GpuSampler(gpuSources(), false);

  /**
   * The background ticks since the history was last read, for slowing down where reading is costly.
   */
  private gpuHistoryTicks: number = 0;

  /**
   * The GPU's history, oldest first, held to {@link GPU_HISTORY_SPAN_MS}.
   */
  private gpuHistory: GpuHistoryPoint[] = [];

  /**
   * Decides the listings each process's threads and CPU time are read on, reset when listing starts.
   */
  private extrasCadence: HeavyCadence = new HeavyCadence(EXTRAS_SAMPLE_INTERVAL_MS);

  /**
   * Each process's threads and CPU time as last read, by pid, carried forward between readings.
   */
  private extras: ReadonlyMap<number, ProcessExtras> = new Map<number, ProcessExtras>();

  /**
   * Each app's icon as looked up, by the file it was taken from, so a page of processes does not ask
   * the OS again on every listing. Null for a file with no icon to give.
   */
  private readonly icons: Map<string, Promise<string | null>> = new Map<
    string,
    Promise<string | null>
  >();

  /**
   * The account Studio runs as, read once; the empty string when it could not be read.
   */
  private readonly account: string = currentAccount();

  /**
   * Whether every GPU source reported nothing this sampling run, so none is asked again until the
   * next: on a machine without a readable GPU the fallback is `system_profiler`, hundreds of
   * milliseconds, and it would otherwise run on every costly tick for good.
   */
  private gpuUnavailable: boolean = false;

  /**
   * Holds whether the GPU is read at all, as the user's GPU Monitoring setting says.
   */
  private readsGpu: boolean = true;

  /**
   * Wires the start/stop requests. Sampling itself does not begin until a consumer starts it.
   * @param context The contribution context.
   */
  public activate(context: ContributionContext): void {
    this.context = context;
    context.on(SystemMonitorChannel.Start, (): void => this.addConsumer());
    context.on(SystemMonitorChannel.Stop, (): void => this.removeConsumer());
    context.on(SystemMonitorChannel.Rate, (_event: IpcMainEvent, payload: unknown): void => {
      this.readsGpu = (payload as Partial<SamplingRate> | null | undefined)?.gpu !== false;
      this.setRate(normaliseSamplingInterval(payload));
    });
    context.on(SystemMonitorChannel.ProcessesStart, (): void => this.addProcessConsumer());
    context.on(SystemMonitorChannel.ProcessesStop, (): void => this.removeProcessConsumer());
    context.handle(SystemMonitorChannel.Info, (): Promise<SystemInfo> => this.readInfo());
    context.on(SystemMonitorChannel.StorageStart, (): void => this.addStorageConsumer());
    context.on(SystemMonitorChannel.StorageStop, (): void => this.removeStorageConsumer());
    context.handle(SystemMonitorChannel.StorageInfo, (): Promise<StorageInfo> =>
      this.readStorageInfo(),
    );
    context.on(SystemMonitorChannel.GpuStart, (): void => this.addGpuConsumer());
    context.on(SystemMonitorChannel.GpuStop, (): void => this.removeGpuConsumer());
    context.handle(SystemMonitorChannel.GpuHistory, (_event: unknown, span: unknown): GpuHistory =>
      this.readGpuHistory(span),
    );
    context.handle(
      SystemMonitorChannel.ProcessIcon,
      (_event: unknown, location: unknown, name: unknown): Promise<string | null> =>
        this.readProcessIcon(location, name),
    );
    logger.info('SystemMonitorContribution', 'Activated; awaiting sampling consumers');
  }

  /**
   * Stops sampling and drops the context. The IPC listeners are removed automatically by the registry.
   */
  public dispose(): void {
    logger.info('SystemMonitorContribution', 'Disposing; stopping sampling');
    this.stopSampling();
    this.stopListing();
    this.stopGpu();
    this.stopStorage();
    this.setGpuHistory(false);
    this.context = null;
    this.consumers = 0;
    this.processConsumers = 0;
  }

  /**
   * Adds a consumer, starting the sampling loop when it is the first.
   */
  private addConsumer(): void {
    this.consumers += 1;
    logger.trace('SystemMonitorContribution', `Consumer added (now ${this.consumers})`);
    if (this.timer === null) {
      this.startSampling();
    }
  }

  /**
   * Removes a consumer, stopping the sampling loop when it was the last.
   */
  private removeConsumer(): void {
    this.consumers = Math.max(0, this.consumers - 1);
    logger.trace('SystemMonitorContribution', `Consumer removed (now ${this.consumers})`);
    if (this.consumers === 0) {
      this.stopSampling();
    }
  }

  /**
   * Sets the time between samples, re-timing a running loop at once.
   * @param intervalMs The time between samples, in milliseconds.
   */
  private setRate(intervalMs: number): void {
    if (intervalMs === this.intervalMs) {
      return;
    }
    logger.debug('SystemMonitorContribution', `Sampling rate set to ${intervalMs}ms`);
    this.intervalMs = intervalMs;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = setInterval((): void => this.tick(), this.intervalMs);
    }
  }

  /**
   * Starts the sampling loop, priming the CPU baseline so the first pushed sample carries a real delta.
   */
  private startSampling(): void {
    logger.debug('SystemMonitorContribution', `Starting sampling loop (${this.intervalMs}ms)`);
    this.sampler = new MetricsSampler();
    this.heavyCadence = new HeavyCadence();
    this.heavy = NO_HEAVY_READINGS;
    this.volumeCadence = new HeavyCadence(VOLUME_SAMPLE_INTERVAL_MS);
    this.volumes = undefined;
    this.windowsMemoryCadence = new HeavyCadence(WINDOWS_MEMORY_SAMPLE_INTERVAL_MS);
    this.windowsMemoryReading = undefined;
    this.gpuUnavailable = false;
    // Prime the CPU and network/disk baselines so the first pushed sample carries real deltas.
    void this.readSample();
    this.timer = setInterval((): void => this.tick(), this.intervalMs);
  }

  /**
   * Stops the sampling loop.
   */
  private stopSampling(): void {
    if (this.timer !== null) {
      logger.debug('SystemMonitorContribution', 'Stopping sampling loop');
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Samples and pushes one snapshot to the renderer. Skips the tick when the previous sample is still
   * being gathered, so a slow read never lets ticks pile up.
   */
  private tick(): void {
    if (this.sampling) {
      return;
    }
    this.sampling = true;
    void this.readSample()
      .then((sample: MetricsSample): void =>
        this.context?.send(SystemMonitorChannel.Sample, sample),
      )
      .finally((): void => {
        this.sampling = false;
      });
  }

  /**
   * Reads one sample: CPU and memory from the OS (synchronous) on every tick, and network, disk and
   * best-effort GPU (asynchronous, each a process on macOS) on the ticks the cadence makes them due,
   * carried forward on the others. Each optional reading degrades to undefined on failure so a single
   * unavailable metric never sinks the sample.
   * @returns Returns the sample.
   */
  private async readSample(): Promise<MetricsSample> {
    const base: MetricsSample = this.sampler.sample(
      os.cpus(),
      os.totalmem(),
      os.freemem(),
      new Date().toISOString(),
    );
    const now: number = Date.now();
    if (this.heavyCadence.due(now)) {
      const [network, disk, gpu, memoryDetail, volumes]: [
        readonly NetworkStat[] | undefined,
        DiskMetric | undefined,
        GpuMetric | undefined,
        MemoryDetailMetric | undefined,
        readonly VolumeMetric[] | undefined,
      ] = await Promise.all([
        this.readNetwork(),
        this.readDisk(),
        this.readsGpu ? this.readGpu() : undefined,
        this.readMemoryDetail(),
        this.volumeCadence.due(now) ? this.readVolumes() : Promise.resolve(this.volumes),
      ]);
      this.volumes = volumes;
      this.heavy = {
        network: network === undefined ? undefined : sumNetwork(network),
        interfaces: network === undefined ? undefined : readInterfaces(network),
        disk,
        gpu,
        memoryDetail,
      };
    }
    return {
      ...base,
      memory: this.inUse(base.memory, this.heavy.memoryDetail),
      ...definedOnly({ ...this.heavy, volumes: this.volumes }),
      app: this.readApp(),
    };
  }

  /**
   * Works out the memory in use as the memory not available, where the available memory is known: the
   * definition Activity Monitor, Task Manager and Linux's MemAvailable share. The free memory the OS
   * reports on every tick leaves out what the system holds only as cache and gives up on demand, so on
   * macOS it reads tens of gigabytes higher than Activity Monitor's Memory Used.
   * @param memory The memory reading from the free memory.
   * @param detail The memory breakdown, or undefined before it has been read.
   * @returns Returns the memory reading, its use measured from what is available where known.
   */
  private inUse(
    memory: MetricsSample['memory'],
    detail: MemoryDetailMetric | undefined,
  ): MetricsSample['memory'] {
    if (detail === undefined || memory.totalBytes <= 0) {
      return memory;
    }
    const usedBytes: number = Math.max(0, memory.totalBytes - detail.availableBytes);
    return {
      usedBytes,
      totalBytes: memory.totalBytes,
      percent: Math.round((usedBytes / memory.totalBytes) * 1000) / 10,
    };
  }

  /**
   * Reads this application's own CPU and memory share across its whole process tree, or undefined when
   * it could not be read (for example before the Electron runtime is usable).
   * @returns Returns the app-usage metric, or undefined.
   */
  private readApp(): AppUsageMetric | undefined {
    try {
      return readAppUsage(app.getAppMetrics(), os.cpus().length, os.totalmem());
    } catch {
      return undefined;
    }
  }

  /**
   * Reads each network interface's stats, or undefined when unavailable.
   * @returns Returns the per-interface stats, or undefined.
   */
  private async readNetwork(): Promise<readonly NetworkStat[] | undefined> {
    try {
      return await si.networkStats('*');
    } catch {
      return undefined;
    }
  }

  /**
   * Reads the memory breakdown beyond used and total, or undefined when unavailable.
   * @returns Returns the memory breakdown, or undefined.
   */
  private async readMemoryDetail(): Promise<MemoryDetailMetric | undefined> {
    try {
      const detail: MemoryDetailMetric = readMemoryDetail(await si.mem());
      return { ...detail, ...(await this.readMemoryBreakdown(detail.availableBytes)) };
    } catch {
      return undefined;
    }
  }

  /**
   * Reads the memory breakdown the platform's own tools give beyond systeminformation: `vm_stat` and the
   * kernel's pressure readings on macOS, `/proc` on Linux, the memory counters on Windows (every
   * fifteen seconds, carried between). Best-effort: what cannot be read is left out.
   * @param availableBytes The memory available, which Windows' pressure is worked out from.
   * @returns Returns the breakdown.
   */
  private async readMemoryBreakdown(availableBytes: number): Promise<MemoryBreakdown> {
    const options: { timeout: number; maxBuffer: number } = {
      timeout: 4_000,
      maxBuffer: 4 * 1024 * 1024,
    };
    const text: (path: string) => Promise<string> = async (path: string): Promise<string> =>
      readFile(path, 'utf8').catch((): string => '');
    try {
      switch (process.platform) {
        case 'darwin': {
          const [vmStat, pressure]: [{ stdout: string }, { stdout: string }] = await Promise.all([
            run('vm_stat', [], options),
            run(
              'sysctl',
              ['-n', 'kern.memorystatus_vm_pressure_level', 'kern.memorystatus_level'],
              options,
            ),
          ]);
          return darwinMemory(vmStat.stdout, pressure.stdout);
        }
        case 'linux': {
          const [meminfo, vmstat, psi]: [string, string, string] = await Promise.all([
            text('/proc/meminfo'),
            text('/proc/vmstat'),
            text('/proc/pressure/memory'),
          ]);
          return linuxMemory(meminfo, vmstat, psi);
        }
        case 'win32': {
          if (this.windowsMemoryCadence.due(Date.now())) {
            const { stdout }: { stdout: string } = await run(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_MEMORY_COMMAND],
              options,
            );
            this.windowsMemoryReading = JSON.parse(stdout) as WindowsMemory;
          }
          return windowsMemory(this.windowsMemoryReading ?? {}, os.totalmem(), availableBytes);
        }
        default:
          return {};
      }
    } catch (error: unknown) {
      logger.debug('SystemMonitorContribution', 'Could not read the memory breakdown', error);
      return {};
    }
  }

  /**
   * Reads the installed memory modules: from `system_profiler` on macOS (systeminformation reports none
   * there), from systeminformation elsewhere (Windows' WMI; Linux's dmidecode, which needs
   * administrator rights, so usually none). Best-effort: an empty list when they cannot be read.
   * @returns Returns the modules.
   */
  private async readMemoryModules(): Promise<MemoryModules> {
    try {
      if (process.platform === 'darwin') {
        const { stdout }: { stdout: string } = await run(
          'system_profiler',
          ['-json', 'SPMemoryDataType'],
          { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
        );
        return darwinMemoryModules(JSON.parse(stdout) as SystemProfilerMemory);
      }
      return layoutMemoryModules(await si.memLayout());
    } catch (error: unknown) {
      logger.debug('SystemMonitorContribution', 'Could not read the memory modules', error);
      return { modules: [] };
    }
  }

  /**
   * Reads the mounted volumes' space, or undefined when unavailable.
   * @returns Returns the volumes, or undefined.
   */
  private async readVolumes(): Promise<readonly VolumeMetric[] | undefined> {
    try {
      return readVolumes(await si.fsSize());
    } catch {
      return undefined;
    }
  }

  /**
   * Adds a process-snapshot consumer, starting the listing loop when it is the first. The first
   * snapshot is taken at once, so the view does not wait a whole interval for its first rows.
   */
  private addProcessConsumer(): void {
    this.processConsumers += 1;
    logger.trace(
      'SystemMonitorContribution',
      `Process consumer added (now ${this.processConsumers})`,
    );
    if (this.processTimer === null) {
      logger.debug('SystemMonitorContribution', 'Starting process listing loop');
      this.extrasCadence = new HeavyCadence(EXTRAS_SAMPLE_INTERVAL_MS);
      this.extras = new Map<number, ProcessExtras>();
      this.listProcesses();
      this.processTimer = setInterval((): void => this.listProcesses(), PROCESS_SAMPLE_INTERVAL_MS);
    }
  }

  /**
   * Removes a process-snapshot consumer, stopping the listing loop when it was the last.
   */
  private removeProcessConsumer(): void {
    this.processConsumers = Math.max(0, this.processConsumers - 1);
    logger.trace(
      'SystemMonitorContribution',
      `Process consumer removed (now ${this.processConsumers})`,
    );
    if (this.processConsumers === 0) {
      this.stopListing();
    }
  }

  /**
   * Stops the process listing loop.
   */
  private stopListing(): void {
    if (this.processTimer !== null) {
      logger.debug('SystemMonitorContribution', 'Stopping process listing loop');
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
  }

  /**
   * Lists the machine's processes and pushes the snapshot to the renderer. Skips the tick when the
   * previous listing is still running; a listing that fails is logged and skipped.
   */
  private listProcesses(): void {
    if (this.listing) {
      return;
    }
    this.listing = true;
    void this.readProcesses()
      .then((snapshot: ProcessesSnapshot | undefined): void => {
        if (snapshot !== undefined && this.processTimer !== null) {
          this.context?.send(SystemMonitorChannel.Processes, snapshot);
        }
      })
      .finally((): void => {
        this.listing = false;
      });
  }

  /**
   * Reads the icon of the app a process belongs to, once per app.
   * @param location The folder the process's executable is in.
   * @param name The process's name.
   * @returns Returns the icon as a PNG data URL, or null when the process has none of its own.
   */
  private readProcessIcon(location: unknown, name: unknown): Promise<string | null> {
    if (typeof location !== 'string' || typeof name !== 'string') {
      return Promise.resolve(null);
    }
    const target: string | null = iconTarget(location, name, process.platform);
    if (target === null) {
      return Promise.resolve(null);
    }
    let icon: Promise<string | null> | undefined = this.icons.get(target);
    if (icon === undefined) {
      // On macOS `getFileIcon` gives an app bundle the generic folder's icon; Quick Look's thumbnail of
      // the bundle is the app's own. Windows reads the icon embedded in the executable.
      const image: Promise<Electron.NativeImage> =
        process.platform === 'darwin'
          ? nativeImage.createThumbnailFromPath(target, {
              width: PROCESS_ICON_PX,
              height: PROCESS_ICON_PX,
            })
          : app.getFileIcon(target, { size: 'normal' });
      icon = image
        .then((read: Electron.NativeImage): string | null =>
          read.isEmpty() ? null : read.toDataURL(),
        )
        .catch((): null => null);
      this.icons.set(target, icon);
    }
    return icon;
  }

  /**
   * Reads one process snapshot, or undefined when the listing failed.
   * @returns Returns the snapshot, or undefined.
   */
  private async readProcesses(): Promise<ProcessesSnapshot | undefined> {
    try {
      const listing: si.Systeminformation.ProcessesData = await si.processes();
      let electron: readonly ElectronProcess[] = [];
      try {
        electron = app.getAppMetrics();
      } catch {
        // Outside the Electron runtime Studio's own processes are still found by descent from main.
      }
      const processes: readonly ProcessSample[] = readProcesses(
        listing.list,
        electron,
        {
          mainPid: process.pid,
          coreCount: os.cpus().length,
          totalBytes: os.totalmem(),
          cpuIsPerCore: PER_CORE_CPU_PLATFORMS.has(process.platform),
        },
        PROCESS_SNAPSHOT_LIMIT,
      );
      if (this.extrasCadence.due(Date.now())) {
        this.extras = await this.readExtras(
          processes.map((sample: ProcessSample): number => sample.pid),
        );
      }
      return {
        timestamp: new Date().toISOString(),
        processes: processes.map((sample: ProcessSample): ProcessSample => ({
          ...sample,
          ...this.extras.get(sample.pid),
        })),
        total: listing.all,
        user: this.account,
      };
    } catch (error: unknown) {
      logger.debug('SystemMonitorContribution', 'Could not list processes', error);
      return undefined;
    }
  }

  /**
   * Starts or stops keeping the GPU's history in the background, as GPU Monitoring says. Studio follows
   * the setting from launch, so the history's longer spans have readings whether or not the monitor
   * has been opened. Turning it off forgets the history.
   * @param enabled Whether GPU Monitoring is on.
   */
  public setGpuHistory(enabled: boolean): void {
    if (enabled === (this.gpuHistoryTimer !== null)) {
      return;
    }
    if (enabled) {
      logger.debug('SystemMonitorContribution', 'Keeping the GPU history');
      this.gpuHistorySampler = new GpuSampler(gpuSources(), false);
      this.gpuHistoryTicks = 0;
      void this.recordGpuHistory();
      this.gpuHistoryTimer = setInterval((): void => {
        this.gpuHistoryTicks += 1;
        if (
          !this.gpuHistorySampler.costly ||
          this.gpuHistoryTicks % COSTLY_GPU_HISTORY_EVERY === 0
        ) {
          void this.recordGpuHistory();
        }
      }, GPU_HISTORY_INTERVAL_MS);
    } else {
      logger.debug('SystemMonitorContribution', 'No longer keeping the GPU history');
      if (this.gpuHistoryTimer !== null) {
        clearInterval(this.gpuHistoryTimer);
      }
      this.gpuHistoryTimer = null;
      this.gpuHistory = [];
    }
  }

  /**
   * Reads the GPU once for its history, dropping what is older than the history keeps.
   */
  private async recordGpuHistory(): Promise<void> {
    try {
      const reading: GpuReading | undefined = await this.gpuHistorySampler.read();
      if (reading === undefined || this.gpuHistoryTimer === null) {
        return;
      }
      const time: number = Date.parse(reading.timestamp);
      this.gpuHistory.push({
        time,
        ...definedOnly({
          utilisationPercent: reading.utilisationPercent,
          memoryUsedBytes: reading.memoryUsedBytes,
        }),
      });
      const oldest: number = time - GPU_HISTORY_SPAN_MS;
      const stale: number = this.gpuHistory.findIndex(
        (point: GpuHistoryPoint): boolean => point.time >= oldest,
      );
      if (stale > 0) {
        this.gpuHistory.splice(0, stale);
      }
    } catch (error: unknown) {
      logger.debug('SystemMonitorContribution', 'Could not read the GPU for its history', error);
    }
  }

  /**
   * Answers the GPU's history over a span, evened out to at most a few hundred points: each point the
   * average of the readings in its slice of the span.
   * @param span The span, in milliseconds (clamped to what is kept).
   * @returns Returns the history.
   */
  private readGpuHistory(span: unknown): GpuHistory {
    const spanMs: number = Math.min(
      GPU_HISTORY_SPAN_MS,
      Math.max(
        GPU_HISTORY_INTERVAL_MS,
        typeof span === 'number' && Number.isFinite(span) ? span : 0,
      ),
    );
    const now: number = Date.now();
    const from: number = now - spanMs;
    const intervalMs: number = Math.max(
      GPU_HISTORY_INTERVAL_MS,
      Math.ceil(spanMs / GPU_HISTORY_POINTS),
    );
    const buckets: Map<number, GpuHistoryPoint[]> = new Map<number, GpuHistoryPoint[]>();
    for (const point of this.gpuHistory) {
      if (point.time >= from) {
        const slot: number = Math.floor((point.time - from) / intervalMs);
        buckets.set(slot, [...(buckets.get(slot) ?? []), point]);
      }
    }
    const average: (
      points: readonly GpuHistoryPoint[],
      pick: (point: GpuHistoryPoint) => number | undefined,
    ) => number | undefined = (
      points: readonly GpuHistoryPoint[],
      pick: (point: GpuHistoryPoint) => number | undefined,
    ): number | undefined => {
      const values: number[] = points
        .map(pick)
        .filter((value: number | undefined): value is number => value !== undefined);
      return values.length === 0
        ? undefined
        : values.reduce((sum: number, value: number): number => sum + value, 0) / values.length;
    };
    const points: GpuHistoryPoint[] = [...buckets.entries()]
      .sort(([a]: [number, GpuHistoryPoint[]], [b]: [number, GpuHistoryPoint[]]): number => a - b)
      .map(([slot, slice]: [number, GpuHistoryPoint[]]): GpuHistoryPoint => ({
        time: from + slot * intervalMs,
        ...definedOnly({
          utilisationPercent: average(
            slice,
            (point: GpuHistoryPoint): number | undefined => point.utilisationPercent,
          ),
          memoryUsedBytes: average(
            slice,
            (point: GpuHistoryPoint): number | undefined => point.memoryUsedBytes,
          ),
        }),
      }));
    return { points, intervalMs };
  }

  /**
   * Adds a storage-reading consumer, starting the readings when it is the first. The first reading is
   * taken at once, so the next has something to compare with.
   */
  private addStorageConsumer(): void {
    this.storageConsumers += 1;
    if (this.storageTimer === null) {
      logger.debug('SystemMonitorContribution', 'Starting storage readings');
      this.storageSampler = new StorageSampler(gpuSources());
      this.readStorageOnce();
      this.storageTimer = setInterval(
        (): void => this.readStorageOnce(),
        STORAGE_SAMPLE_INTERVAL_MS,
      );
    }
  }

  /**
   * Removes a storage-reading consumer, stopping the readings when it was the last.
   */
  private removeStorageConsumer(): void {
    this.storageConsumers = Math.max(0, this.storageConsumers - 1);
    if (this.storageConsumers === 0) {
      this.stopStorage();
    }
  }

  /**
   * Stops the storage readings.
   */
  private stopStorage(): void {
    if (this.storageTimer !== null) {
      logger.debug('SystemMonitorContribution', 'Stopping storage readings');
      clearInterval(this.storageTimer);
      this.storageTimer = null;
    }
  }

  /**
   * Reads the storage devices and pushes the reading to the renderer, skipping a tick while one is
   * still running.
   */
  private readStorageOnce(): void {
    if (this.readingStorage) {
      return;
    }
    this.readingStorage = true;
    void this.storageSampler
      .read()
      .then((reading: StorageReading | undefined): void => {
        if (reading !== undefined && this.storageTimer !== null) {
          this.context?.send(SystemMonitorChannel.Storage, reading);
        }
      })
      .catch((error: unknown): void => {
        logger.debug('SystemMonitorContribution', 'Could not read storage', error);
      })
      .finally((): void => {
        this.readingStorage = false;
      });
  }

  /**
   * Reads the machine's storage devices and the device each volume is on. The devices are those the
   * platform counts activity for, described by systeminformation and, on macOS, System Information
   * (how each is connected, its S.M.A.R.T. status); APFS volumes are traced through their container to
   * the drive it lives on, and Windows drive letters through the disk counters' names.
   * @returns Returns the storage, empty where it cannot be read.
   */
  private async readStorageInfo(): Promise<StorageInfo> {
    const platform: string = process.platform;
    const sampler: StorageSampler = new StorageSampler(gpuSources());
    const [layout, sizes, blocks, windows, counted, profiled, containers]: [
      si.Systeminformation.DiskLayoutData[],
      si.Systeminformation.FsSizeData[],
      si.Systeminformation.BlockDevicesData[],
      WindowsDisks | undefined,
      ReadonlyMap<string, StorageCounters>,
      ReadonlyMap<string, ProfiledDisk>,
      ReadonlyMap<string, string>,
    ] = await Promise.all([
      si.diskLayout().catch((): si.Systeminformation.DiskLayoutData[] => []),
      si.fsSize().catch((): si.Systeminformation.FsSizeData[] => []),
      si.blockDevices().catch((): si.Systeminformation.BlockDevicesData[] => []),
      platform === 'win32' ? sampler.windowsDisks() : Promise.resolve(undefined),
      platform === 'win32'
        ? Promise.resolve(new Map<string, StorageCounters>())
        : sampler.counters(),
      platform === 'darwin'
        ? run('system_profiler', ['SPNVMeDataType', 'SPSerialATADataType', '-json'], {
            timeout: 15_000,
            maxBuffer: 16 * 1024 * 1024,
          })
            .then((output: { stdout: string }): ReadonlyMap<string, ProfiledDisk> =>
              parseProfiledDisks(JSON.parse(output.stdout)),
            )
            .catch((): ReadonlyMap<string, ProfiledDisk> => new Map<string, ProfiledDisk>())
        : Promise.resolve(new Map<string, ProfiledDisk>()),
      platform === 'darwin'
        ? run('diskutil', ['apfs', 'list'], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })
            .then((output: { stdout: string }): ReadonlyMap<string, string> =>
              parseApfsContainers(output.stdout),
            )
            .catch((): ReadonlyMap<string, string> => new Map<string, string>())
        : Promise.resolve(new Map<string, string>()),
    ]);
    const map: ReadonlyMap<string, string> = windows?.letters ?? containers;
    const volumes: readonly StorageVolumeDevice[] = readVolumes(sizes).map(
      (volume: VolumeMetric): StorageVolumeDevice => {
        const fs: string =
          sizes.find(
            (size: si.Systeminformation.FsSizeData): boolean => size.mount === volume.mount,
          )?.fs ?? '';
        const deviceId: string | undefined = deviceOfVolume(fs, platform, map);
        const label: string =
          blocks
            .find(
              (block: si.Systeminformation.BlockDevicesData): boolean =>
                block.mount === volume.mount,
            )
            ?.label.trim() ?? '';
        return {
          mount: volume.mount,
          ...(deviceId === undefined ? {} : { deviceId }),
          ...(label.length === 0 ? {} : { name: label }),
        };
      },
    );
    const systemId: string | undefined = volumes.find(
      (volume: StorageVolumeDevice): boolean => volume.mount === '/' || /^C:/i.test(volume.mount),
    )?.deviceId;
    return {
      devices: readStorageDevices(
        layout,
        platform,
        new Set<string>((windows?.counters ?? counted).keys()),
        profiled,
        systemId,
      ),
      volumes,
    };
  }

  /**
   * Adds a GPU-reading consumer, starting the readings when it is the first. The first reading is
   * taken at once.
   */
  private addGpuConsumer(): void {
    this.gpuConsumers += 1;
    if (this.gpuTimer === null) {
      logger.debug('SystemMonitorContribution', 'Starting GPU readings');
      this.gpuSampler = new GpuSampler(gpuSources(), true);
      this.readGpuOnce();
      this.gpuTimer = setInterval((): void => this.readGpuOnce(), GPU_SAMPLE_INTERVAL_MS);
    }
  }

  /**
   * Removes a GPU-reading consumer, stopping the readings when it was the last.
   */
  private removeGpuConsumer(): void {
    this.gpuConsumers = Math.max(0, this.gpuConsumers - 1);
    if (this.gpuConsumers === 0) {
      this.stopGpu();
    }
  }

  /**
   * Stops the GPU readings.
   */
  private stopGpu(): void {
    if (this.gpuTimer !== null) {
      logger.debug('SystemMonitorContribution', 'Stopping GPU readings');
      clearInterval(this.gpuTimer);
      this.gpuTimer = null;
    }
  }

  /**
   * Reads the GPU and pushes the reading to the renderer, skipping a tick while one is still running.
   */
  private readGpuOnce(): void {
    if (this.readingGpu) {
      return;
    }
    this.readingGpu = true;
    void this.gpuSampler
      .read()
      .then((reading: GpuReading | undefined): void => {
        if (reading !== undefined && this.gpuTimer !== null) {
          this.context?.send(SystemMonitorChannel.Gpu, reading);
        }
      })
      .catch((error: unknown): void => {
        logger.debug('SystemMonitorContribution', 'Could not read the GPU', error);
      })
      .finally((): void => {
        this.readingGpu = false;
      });
  }

  /**
   * Reads what the platform says of the first GPU beyond systeminformation: on macOS its driver and
   * version (the accelerator's kernel extension), architecture (from its driver class) and PCIe width;
   * with `nvidia-smi`, its driver version and PCIe link. Best-effort: what cannot be read is left out.
   * @param model The GPU's model, which names the architecture where the driver does not.
   * @returns Returns the details.
   */
  private async readGpuDetails(model: string): Promise<Partial<GpuInfo>> {
    const options: { timeout: number; maxBuffer: number } = {
      timeout: 6_000,
      maxBuffer: 16 * 1024 * 1024,
    };
    try {
      if (process.platform === 'darwin') {
        const [statistics, displays]: [{ stdout: string }, { stdout: string }] = await Promise.all([
          run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], options),
          run('system_profiler', ['-json', 'SPDisplaysDataType'], options),
        ]);
        const driverClass: string = parseIoregStatistics(statistics.stdout)?.driverClass ?? '';
        const bundle: string | undefined = /"CFBundleIdentifier" = "([^"]+)"/.exec(
          statistics.stdout,
        )?.[1];
        const version: string | undefined =
          bundle === undefined
            ? undefined
            : /\(([\d.]+)\)/.exec(
                (
                  await run('kmutil', ['showloaded', '--bundle-identifier', bundle], options).catch(
                    (): { stdout: string } => ({ stdout: '' }),
                  )
                ).stdout,
              )?.[1];
        const width: string | undefined = /"spdisplays_pcie_width"\s*:\s*"x?(\d+)"/.exec(
          displays.stdout,
        )?.[1];
        const driverName: string | undefined = bundle?.split('.').pop();
        return definedOnly({
          driver:
            driverName === undefined ? undefined : [driverName, version].filter(Boolean).join(' '),
          architecture: architectureOf(driverClass, model),
          bus: width === undefined ? undefined : `PCIe ×${width}`,
        });
      }
      const { stdout }: { stdout: string } = await run(
        'nvidia-smi',
        [
          '--query-gpu=driver_version,pcie.link.gen.max,pcie.link.width.max',
          '--format=csv,noheader,nounits',
        ],
        options,
      );
      const [driver, generation, width]: string[] = (stdout.split('\n')[0] ?? '')
        .split(',')
        .map((part: string): string => part.trim());
      return definedOnly({
        driver: driver === undefined || driver.length === 0 ? undefined : driver,
        architecture: architectureOf(model),
        bus:
          width === undefined || !/^\d+$/.test(width)
            ? undefined
            : /^\d+$/.test(generation ?? '')
              ? `PCIe Gen ${generation} ×${width}`
              : `PCIe ×${width}`,
      });
    } catch {
      return definedOnly({ architecture: architectureOf(model) });
    }
  }

  /**
   * Adds what the platform says beyond systeminformation to the first GPU.
   * @param gpus The GPUs systeminformation describes.
   * @returns Returns the GPUs, the first with its driver, architecture and bus where known.
   */
  private async describeGpus(gpus: readonly GpuInfo[]): Promise<readonly GpuInfo[]> {
    const [first, ...rest]: readonly GpuInfo[] = gpus;
    if (first === undefined) {
      return gpus;
    }
    return [{ ...first, ...(await this.readGpuDetails(first.model)) }, ...rest];
  }

  /**
   * Reads each process's threads and CPU time, the way the platform offers them: two `ps` calls on
   * macOS (one for every process's CPU time, one listing every thread), `/proc/<pid>/stat` for the
   * listed processes on Linux, one WMI query on Windows. Best-effort: a platform or process that cannot
   * be read is simply left without them.
   * @param pids The listed processes' pids.
   * @returns Returns each process's extras, by pid.
   */
  private async readExtras(pids: readonly number[]): Promise<ReadonlyMap<number, ProcessExtras>> {
    const options: { timeout: number; maxBuffer: number } = {
      timeout: 4_000,
      maxBuffer: 32 * 1024 * 1024,
    };
    try {
      switch (process.platform) {
        case 'darwin': {
          const [times, threads]: [{ stdout: string }, { stdout: string }] = await Promise.all([
            run('ps', ['-axo', 'pid=,time='], options),
            run('ps', ['-axM'], options),
          ]);
          return joinDarwinExtras(
            parseDarwinTimes(times.stdout),
            parseDarwinThreads(threads.stdout),
          );
        }
        case 'linux': {
          const extras: Map<number, ProcessExtras> = new Map<number, ProcessExtras>();
          await Promise.all(
            pids.map(async (pid: number): Promise<void> => {
              try {
                const stat: ProcessExtras | undefined = parseProcStat(
                  await readFile(`/proc/${pid}/stat`, 'utf8'),
                );
                if (stat !== undefined) {
                  extras.set(pid, stat);
                }
              } catch {
                // The process ended between the listing and the read.
              }
            }),
          );
          return extras;
        }
        case 'win32': {
          const { stdout }: { stdout: string } = await run(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_EXTRAS_COMMAND],
            options,
          );
          return parseWindowsProcesses(JSON.parse(stdout) as WindowsProcess | WindowsProcess[]);
        }
        default:
          return new Map<number, ProcessExtras>();
      }
    } catch (error: unknown) {
      logger.debug('SystemMonitorContribution', 'Could not read process threads and times', error);
      return new Map<number, ProcessExtras>();
    }
  }

  /**
   * Reads the machine's static description. The core breakdown and OS name are best-effort: when
   * systeminformation cannot read them, the description falls back to what Node reports.
   * @returns Returns the description.
   */
  private async readInfo(): Promise<SystemInfo> {
    const cpus: readonly os.CpuInfo[] = os.cpus();
    // The graphics controllers are read once here, not per sample: on macOS it is `system_profiler`,
    // a second or more.
    const [cpu, osInfo, graphics, cache, memory]: [
      si.Systeminformation.CpuData | null,
      si.Systeminformation.OsData | null,
      si.Systeminformation.GraphicsData | null,
      si.Systeminformation.CpuCacheData | null,
      MemoryModules,
    ] = await Promise.all([
      si.cpu().catch((): null => null),
      si.osInfo().catch((): null => null),
      si.graphics().catch((): null => null),
      si.cpuCache().catch((): null => null),
      this.readMemoryModules(),
    ]);
    const positive: (value: number | undefined) => number | undefined = (
      value: number | undefined,
    ): number | undefined => (typeof value === 'number' && value > 0 ? value : undefined);
    const model: string = cpus[0]?.model.trim() ?? '';
    return {
      cpuModel: model.length > 0 ? model : `${cpu?.manufacturer ?? ''} ${cpu?.brand ?? ''}`.trim(),
      logicalCores: cpus.length,
      physicalCores: positive(cpu?.physicalCores),
      performanceCores:
        positive(cpu?.efficiencyCores) === undefined ? undefined : positive(cpu?.performanceCores),
      efficiencyCores: positive(cpu?.efficiencyCores),
      speedGhz: positive(cpu?.speed),
      // Only a maximum above the base is one: macOS reports the base as the maximum.
      maxSpeedGhz:
        (cpu?.speedMax ?? 0) > (cpu?.speed ?? 0) + 0.05 ? positive(cpu?.speedMax) : undefined,
      architecture: architectureName(os.arch()),
      caches:
        cache === null ? [] : readCaches(cache, process.platform, positive(cpu?.physicalCores)),
      totalMemoryBytes: os.totalmem(),
      os:
        osInfo === null
          ? `${os.type()} ${os.release()}`
          : `${osInfo.distro} ${osInfo.release}`.trim(),
      ...definedOnly({ bootTime: readBootTime() }),
      gpus: await this.describeGpus(readGpus(graphics?.controllers ?? [])),
      memoryModules: memory.modules,
      ...definedOnly({ memorySlots: memory.slots, memoryEcc: memory.ecc }),
    };
  }

  /**
   * Reads disk I/O throughput, or undefined when unavailable.
   * @returns Returns the disk metric, or undefined.
   */
  private async readDisk(): Promise<DiskMetric | undefined> {
    try {
      return readDisk(await si.fsStats());
    } catch {
      return undefined;
    }
  }

  /**
   * Reads best-effort GPU utilisation. On macOS it reads `ioreg` (a no-sudo source that reports real
   * utilisation, which systeminformation does not read there); elsewhere, and if that yields nothing,
   * it falls back to systeminformation. Undefined when no source reports a reading — and once none
   * has, undefined without asking again until sampling next starts.
   * @returns Returns the GPU metric, or undefined.
   */
  private async readGpu(): Promise<GpuMetric | undefined> {
    if (this.gpuUnavailable) {
      return undefined;
    }
    const gpu: GpuMetric | undefined = await this.probeGpu();
    if (gpu === undefined) {
      logger.debug(
        'SystemMonitorContribution',
        'No GPU source reports utilisation; not asking again',
      );
      this.gpuUnavailable = true;
    }
    return gpu;
  }

  /**
   * Asks each GPU source in turn for a reading.
   * @returns Returns the GPU metric, or undefined when no source reports one.
   */
  private async probeGpu(): Promise<GpuMetric | undefined> {
    if (process.platform === 'darwin') {
      const mac: GpuMetric | undefined = await this.readGpuMac();
      if (mac !== undefined) {
        return mac;
      }
    }
    try {
      const gpu: GpuMetric = pickGpu((await si.graphics()).controllers);
      return gpu.available ? { ...gpu, source: 'nvidia-smi' } : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Reads macOS GPU utilisation from `ioreg`'s IOAccelerator statistics (no elevated privileges
   * required). Returns undefined when the command fails or reports no utilisation.
   * @returns Returns the GPU metric, or undefined.
   */
  private async readGpuMac(): Promise<GpuMetric | undefined> {
    try {
      const { stdout }: { stdout: string } = await run(
        'ioreg',
        ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'],
        { timeout: 800, maxBuffer: 16 * 1024 * 1024 },
      );
      const gpu: GpuMetric = parseIoregGpu(stdout);
      return gpu.available ? { ...gpu, source: 'ioreg' } : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * The singleton System Monitor contribution appended to the `mainContributions` manifest.
 */
export const systemMonitorContribution: SystemMonitorContribution = new SystemMonitorContribution();

/**
 * Drops the readings that are undefined, so a sample carries only the optional fields it has.
 * @param readings The readings.
 * @returns Returns the readings that are defined.
 */
function definedOnly<T extends object>(readings: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(readings).filter(([, value]: [string, unknown]): boolean => value !== undefined),
  ) as Partial<T>;
}

/**
 * Reads when the machine started, or undefined where the OS refuses its uptime (a sandboxed process
 * can be denied it).
 * @returns Returns the boot time in milliseconds since the epoch, or undefined.
 */
function readBootTime(): number | undefined {
  try {
    return Date.now() - os.uptime() * 1000;
  } catch {
    return undefined;
  }
}

/**
 * Reads the account Studio runs as: the user's own account, which their processes run as too.
 * @returns Returns the account name, or the empty string where the OS refuses it.
 */
function currentAccount(): string {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

/**
 * Builds what a GPU sampler reads the machine through: commands, files and folders, and the clock.
 * @returns Returns the sources.
 */
function gpuSources(): GpuSources {
  return {
    platform: process.platform,
    run: async (file: string, args: readonly string[]): Promise<string> =>
      (await run(file, args, { timeout: 6_000, maxBuffer: 16 * 1024 * 1024 })).stdout,
    readFile: (path: string): Promise<string> => readFile(path, 'utf8'),
    readdir: (path: string): Promise<readonly string[]> => readdir(path),
    now: (): number => Date.now(),
  };
}
