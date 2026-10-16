import { execFile } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { app, IpcMainEvent } from 'electron';
import * as si from 'systeminformation';
import {
  AppUsageMetric,
  DEFAULT_SAMPLE_INTERVAL_MS,
  DiskMetric,
  GpuMetric,
  MetricsSample,
  NetworkMetric,
  SystemMonitorChannel,
} from '@shared/api/system-monitor-channels';
import { logger } from '../../logger';
import { ContributionContext, MainContribution } from '../main-contribution';
import { parseIoregGpu, pickGpu, readAppUsage, readDisk, sumNetwork } from './metrics-readers';
import { MetricsSampler } from './metrics-sampler';
import { HeavyCadence, normaliseSamplingInterval } from './sampling-cadence';

/**
 * The costly readings, carried forward between the ticks they are taken on.
 */
interface HeavyReadings {
  readonly network: NetworkMetric | undefined;
  readonly disk: DiskMetric | undefined;
  readonly gpu: GpuMetric | undefined;
}

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
  private heavy: HeavyReadings = { network: undefined, disk: undefined, gpu: undefined };

  /**
   * Whether every GPU source reported nothing this sampling run, so none is asked again until the
   * next: on a machine without a readable GPU the fallback is `system_profiler`, hundreds of
   * milliseconds, and it would otherwise run on every costly tick for good.
   */
  private gpuUnavailable: boolean = false;

  /**
   * Wires the start/stop requests. Sampling itself does not begin until a consumer starts it.
   * @param context The contribution context.
   */
  public activate(context: ContributionContext): void {
    this.context = context;
    context.on(SystemMonitorChannel.Start, (): void => this.addConsumer());
    context.on(SystemMonitorChannel.Stop, (): void => this.removeConsumer());
    context.on(SystemMonitorChannel.Rate, (_event: IpcMainEvent, payload: unknown): void =>
      this.setRate(normaliseSamplingInterval(payload)),
    );
    logger.info('SystemMonitorContribution', 'Activated; awaiting sampling consumers');
  }

  /**
   * Stops sampling and drops the context. The IPC listeners are removed automatically by the registry.
   */
  public dispose(): void {
    logger.info('SystemMonitorContribution', 'Disposing; stopping sampling');
    this.stopSampling();
    this.context = null;
    this.consumers = 0;
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
    this.heavy = { network: undefined, disk: undefined, gpu: undefined };
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
    if (this.heavyCadence.due(Date.now())) {
      const [network, disk, gpu]: [
        NetworkMetric | undefined,
        DiskMetric | undefined,
        GpuMetric | undefined,
      ] = await Promise.all([this.readNetwork(), this.readDisk(), this.readGpu()]);
      this.heavy = { network, disk, gpu };
    }
    return { ...base, ...this.heavy, app: this.readApp() };
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
   * Reads summed network throughput, or undefined when unavailable.
   * @returns Returns the network metric, or undefined.
   */
  private async readNetwork(): Promise<NetworkMetric | undefined> {
    try {
      return sumNetwork(await si.networkStats('*'));
    } catch {
      return undefined;
    }
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
      return gpu.available ? gpu : undefined;
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
      return gpu.available ? gpu : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * The singleton System Monitor contribution appended to the `mainContributions` manifest.
 */
export const systemMonitorContribution: MainContribution = new SystemMonitorContribution();
