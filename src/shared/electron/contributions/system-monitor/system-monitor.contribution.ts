import { execFile } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';
import * as si from 'systeminformation';
import {
  DiskMetric,
  GpuMetric,
  MetricsSample,
  NetworkMetric,
  SystemMonitorChannel,
} from '@shared/api/system-monitor-channels';
import { ContributionContext, MainContribution } from '../main-contribution';
import { parseIoregGpu, pickGpu, readDisk, sumNetwork } from './metrics-readers';
import { MetricsSampler } from './metrics-sampler';

/**
 * How often, in milliseconds, the machine metrics are sampled while a consumer is active.
 */
const SAMPLE_INTERVAL_MS: number = 1_000;

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
   * Wires the start/stop requests. Sampling itself does not begin until a consumer starts it.
   * @param context The contribution context.
   */
  public activate(context: ContributionContext): void {
    this.context = context;
    context.on(SystemMonitorChannel.Start, (): void => this.addConsumer());
    context.on(SystemMonitorChannel.Stop, (): void => this.removeConsumer());
  }

  /**
   * Stops sampling and drops the context. The IPC listeners are removed automatically by the registry.
   */
  public dispose(): void {
    this.stopSampling();
    this.context = null;
    this.consumers = 0;
  }

  /**
   * Adds a consumer, starting the sampling loop when it is the first.
   */
  private addConsumer(): void {
    this.consumers += 1;
    if (this.timer === null) {
      this.startSampling();
    }
  }

  /**
   * Removes a consumer, stopping the sampling loop when it was the last.
   */
  private removeConsumer(): void {
    this.consumers = Math.max(0, this.consumers - 1);
    if (this.consumers === 0) {
      this.stopSampling();
    }
  }

  /**
   * Starts the sampling loop, priming the CPU baseline so the first pushed sample carries a real delta.
   */
  private startSampling(): void {
    this.sampler = new MetricsSampler();
    // Prime the CPU and network/disk baselines so the first pushed sample carries real deltas.
    void this.readSample();
    this.timer = setInterval((): void => this.tick(), SAMPLE_INTERVAL_MS);
  }

  /**
   * Stops the sampling loop.
   */
  private stopSampling(): void {
    if (this.timer !== null) {
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
      .then((sample: MetricsSample): void => this.context?.send(SystemMonitorChannel.Sample, sample))
      .finally((): void => {
        this.sampling = false;
      });
  }

  /**
   * Reads one sample: CPU and memory from the OS (synchronous), and network, disk and best-effort GPU
   * from systeminformation (asynchronous). Each optional reading degrades to undefined on failure so a
   * single unavailable metric never sinks the sample.
   * @returns Returns the sample.
   */
  private async readSample(): Promise<MetricsSample> {
    const base: MetricsSample = this.sampler.sample(
      os.cpus(),
      os.totalmem(),
      os.freemem(),
      new Date().toISOString(),
    );
    const [network, disk, gpu]: [NetworkMetric | undefined, DiskMetric | undefined, GpuMetric | undefined] =
      await Promise.all([this.readNetwork(), this.readDisk(), this.readGpu()]);
    return { ...base, network, disk, gpu };
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
   * it falls back to systeminformation. Undefined when no source reports a reading.
   * @returns Returns the GPU metric, or undefined.
   */
  private async readGpu(): Promise<GpuMetric | undefined> {
    if (process.platform === 'darwin') {
      const mac: GpuMetric | undefined = await this.readGpuMac();
      if (mac !== undefined) {
        return mac;
      }
    }
    try {
      return pickGpu((await si.graphics()).controllers);
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
