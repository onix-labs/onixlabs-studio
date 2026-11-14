import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { app, IpcMainEvent } from 'electron';
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
  PROCESS_SAMPLE_INTERVAL_MS,
  PROCESS_SNAPSHOT_LIMIT,
  ProcessesSnapshot,
  ProcessSample,
  SamplingRate,
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
import { MetricsSampler } from './metrics-sampler';
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
   * Decides the listings each process's threads and CPU time are read on, reset when listing starts.
   */
  private extrasCadence: HeavyCadence = new HeavyCadence(EXTRAS_SAMPLE_INTERVAL_MS);

  /**
   * Each process's threads and CPU time as last read, by pid, carried forward between readings.
   */
  private extras: ReadonlyMap<number, ProcessExtras> = new Map<number, ProcessExtras>();

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
    logger.info('SystemMonitorContribution', 'Activated; awaiting sampling consumers');
  }

  /**
   * Stops sampling and drops the context. The IPC listeners are removed automatically by the registry.
   */
  public dispose(): void {
    logger.info('SystemMonitorContribution', 'Disposing; stopping sampling');
    this.stopSampling();
    this.stopListing();
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
      };
    } catch (error: unknown) {
      logger.debug('SystemMonitorContribution', 'Could not list processes', error);
      return undefined;
    }
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
      gpus: readGpus(graphics?.controllers ?? []),
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
export const systemMonitorContribution: MainContribution = new SystemMonitorContribution();

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
