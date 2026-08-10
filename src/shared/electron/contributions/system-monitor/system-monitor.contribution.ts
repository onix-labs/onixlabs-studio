import * as os from 'node:os';
import { MetricsSample, SystemMonitorChannel } from '@shared/api/system-monitor-channels';
import { ContributionContext, MainContribution } from '../main-contribution';
import { MetricsSampler } from './metrics-sampler';

/**
 * How often, in milliseconds, the machine metrics are sampled while a consumer is active.
 */
const SAMPLE_INTERVAL_MS: number = 1_000;

/**
 * The System Monitor's metrics backend contribution. It samples machine CPU and memory on an interval
 * and pushes each {@link MetricsSample} to the renderer, but only while a view has asked it to: the
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
    this.readSample();
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
   * Samples and pushes one snapshot to the renderer.
   */
  private tick(): void {
    this.context?.send(SystemMonitorChannel.Sample, this.readSample());
  }

  /**
   * Reads one sample from the OS.
   * @returns Returns the sample.
   */
  private readSample(): MetricsSample {
    return this.sampler.sample(os.cpus(), os.totalmem(), os.freemem(), new Date().toISOString());
  }
}

/**
 * The singleton System Monitor contribution appended to the `mainContributions` manifest.
 */
export const systemMonitorContribution: MainContribution = new SystemMonitorContribution();
