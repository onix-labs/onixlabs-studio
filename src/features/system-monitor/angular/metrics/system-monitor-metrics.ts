import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  MetricsSample,
  ProcessesSnapshot,
  SamplingRate,
  SystemInfo,
  SystemMonitorChannel,
} from '@shared/api/system-monitor-channels';

/**
 * The renderer client for the System Monitor metrics backend contribution (#398): a thin, typed
 * wrapper over the generic {@link Bridge}. A view calls {@link start} when it shows and {@link stop}
 * when it hides — the backend ref-counts these, so sampling only runs while a monitor is visible — and
 * subscribes to pushed samples through {@link onSample}. Outside Electron every method is a safe no-op.
 */
@Service()
export class SystemMonitorMetrics {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Asks the backend to begin sampling for this consumer.
   */
  public start(): void {
    this.bridge?.send(SystemMonitorChannel.Start);
  }

  /**
   * Asks the backend to stop sampling for this consumer.
   */
  public stop(): void {
    this.bridge?.send(SystemMonitorChannel.Stop);
  }

  /**
   * Tells the backend how often to sample. Takes effect at once on a running loop.
   * @param intervalMs The time between samples, in milliseconds.
   * @param gpu Whether to read the GPU.
   */
  public setRate(intervalMs: number, gpu: boolean = true): void {
    const rate: SamplingRate = { intervalMs, gpu };
    this.bridge?.send(SystemMonitorChannel.Rate, rate);
  }

  /**
   * Subscribes to pushed metrics samples.
   * @param listener The listener invoked with each sample.
   * @returns Returns a function that unsubscribes the listener; a no-op outside Electron.
   */
  public onSample(listener: (sample: MetricsSample) => void): () => void {
    return (
      this.bridge?.on(SystemMonitorChannel.Sample, (...args: unknown[]): void =>
        listener(args[0] as MetricsSample),
      ) ??
      ((): void => {
        // No bridge outside Electron; there is nothing to unsubscribe.
      })
    );
  }

  /**
   * Asks the backend to begin listing processes for this consumer. Ref-counted like {@link start}, and
   * separately from it: a listing is far costlier than a sample, so it runs only while a process list
   * is on screen.
   */
  public startProcesses(): void {
    this.bridge?.send(SystemMonitorChannel.ProcessesStart);
  }

  /**
   * Asks the backend to stop listing processes for this consumer.
   */
  public stopProcesses(): void {
    this.bridge?.send(SystemMonitorChannel.ProcessesStop);
  }

  /**
   * Subscribes to pushed process snapshots.
   * @param listener The callback invoked with each snapshot.
   * @returns Returns a function that removes the subscription.
   */
  public onProcesses(listener: (snapshot: ProcessesSnapshot) => void): () => void {
    return (
      this.bridge?.on(SystemMonitorChannel.Processes, (...args: unknown[]): void =>
        listener(args[0] as ProcessesSnapshot),
      ) ??
      ((): void => {
        // No bridge outside Electron; there is nothing to unsubscribe.
      })
    );
  }

  /**
   * Reads the machine's static description.
   * @returns Returns the description, or null outside Electron or when it could not be read.
   */
  public async info(): Promise<SystemInfo | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<SystemInfo>(SystemMonitorChannel.Info);
    } catch {
      return null;
    }
  }
}
