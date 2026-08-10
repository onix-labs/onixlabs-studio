import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { MetricsSample, SystemMonitorChannel } from '@shared/api/system-monitor-channels';

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
}
