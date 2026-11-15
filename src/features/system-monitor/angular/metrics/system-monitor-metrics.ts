import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  GpuHistory,
  GpuReading,
  MetricsSample,
  NetworkInfo,
  NetworkReading,
  NetworkSnapshot,
  ProcessesSnapshot,
  SamplingRate,
  StorageInfo,
  StorageReading,
  StorageSnapshot,
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

  /**
   * Asks the backend to begin reading the GPU for this consumer. Ref-counted like {@link start}.
   */
  public startGpu(): void {
    this.bridge?.send(SystemMonitorChannel.GpuStart);
  }

  /**
   * Asks the backend to stop reading the GPU for this consumer.
   */
  public stopGpu(): void {
    this.bridge?.send(SystemMonitorChannel.GpuStop);
  }

  /**
   * Subscribes to pushed GPU readings.
   * @param listener The callback invoked with each reading.
   * @returns Returns a function that removes the subscription.
   */
  public onGpu(listener: (reading: GpuReading) => void): () => void {
    return (
      this.bridge?.on(SystemMonitorChannel.Gpu, (...args: unknown[]): void =>
        listener(args[0] as GpuReading),
      ) ??
      ((): void => {
        // No bridge outside Electron; there is nothing to unsubscribe.
      })
    );
  }

  /**
   * Asks the backend to read the network interfaces for this consumer. Ref-counted in the backend.
   */
  public startNetwork(): void {
    this.bridge?.send(SystemMonitorChannel.NetworkStart);
  }

  /**
   * Asks the backend to stop reading the network interfaces for this consumer.
   */
  public stopNetwork(): void {
    this.bridge?.send(SystemMonitorChannel.NetworkStop);
  }

  /**
   * Subscribes to pushed network readings.
   * @param listener The callback invoked with each reading.
   * @returns Returns a function that removes the subscription.
   */
  public onNetwork(listener: (reading: NetworkReading) => void): () => void {
    return (
      this.bridge?.on(SystemMonitorChannel.Network, (...args: unknown[]): void =>
        listener(args[0] as NetworkReading),
      ) ??
      ((): void => {
        // No bridge outside Electron; there is nothing to unsubscribe.
      })
    );
  }

  /**
   * Reads the machine's network interfaces, DNS servers and default gateway.
   * @returns Returns the network, or null outside Electron or when it could not be read.
   */
  public async networkInfo(): Promise<NetworkInfo | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<NetworkInfo>(SystemMonitorChannel.NetworkInfo);
    } catch {
      return null;
    }
  }

  /**
   * Asks the backend to read the storage devices for this consumer. Ref-counted in the backend.
   */
  public startStorage(): void {
    this.bridge?.send(SystemMonitorChannel.StorageStart);
  }

  /**
   * Asks the backend to stop reading the storage devices for this consumer.
   */
  public stopStorage(): void {
    this.bridge?.send(SystemMonitorChannel.StorageStop);
  }

  /**
   * Subscribes to pushed storage readings.
   * @param listener The callback invoked with each reading.
   * @returns Returns a function that removes the subscription.
   */
  public onStorage(listener: (reading: StorageReading) => void): () => void {
    return (
      this.bridge?.on(SystemMonitorChannel.Storage, (...args: unknown[]): void =>
        listener(args[0] as StorageReading),
      ) ??
      ((): void => {
        // No bridge outside Electron; there is nothing to unsubscribe.
      })
    );
  }

  /**
   * Reads the machine's storage devices and the device each volume is on.
   * @returns Returns the storage, or null outside Electron or when it could not be read.
   */
  public async storageInfo(): Promise<StorageInfo | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<StorageInfo>(SystemMonitorChannel.StorageInfo);
    } catch {
      return null;
    }
  }

  /**
   * Reads the GPU's history over a span, from what the backend keeps while GPU Monitoring is on.
   * @param spanMs The span, in milliseconds.
   * @returns Returns the history, or null outside Electron or when it could not be read.
   */
  public async gpuHistory(spanMs: number): Promise<GpuHistory | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<GpuHistory>(SystemMonitorChannel.GpuHistory, spanMs);
    } catch {
      return null;
    }
  }

  /**
   * Reads the icon of the app a process belongs to.
   * @param location The folder the process's executable is in.
   * @param name The process's name.
   * @returns Returns the icon as a PNG data URL, or null outside Electron, when the process has no icon
   * of its own, or when it could not be read.
   */
  public async processIcon(location: string, name: string): Promise<string | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<string | null>(
        SystemMonitorChannel.ProcessIcon,
        location,
        name,
      );
    } catch {
      return null;
    }
  }

  /**
   * Lists the processes now, whatever view is showing (for the monitor's agent).
   * @returns Returns the listing, or null outside Electron or when it could not be read.
   */
  public readProcessesNow(): Promise<ProcessesSnapshot | null> {
    return this.invokeOrNull<ProcessesSnapshot>(SystemMonitorChannel.ProcessesRead);
  }

  /**
   * Reads the GPU in detail now (for the monitor's agent).
   * @returns Returns the reading, or null outside Electron or when it could not be read.
   */
  public readGpuNow(): Promise<GpuReading | null> {
    return this.invokeOrNull<GpuReading>(SystemMonitorChannel.GpuRead);
  }

  /**
   * Reads the storage devices and their activity now (for the monitor's agent).
   * @returns Returns the storage, or null outside Electron or when it could not be read.
   */
  public readStorageNow(): Promise<StorageSnapshot | null> {
    return this.invokeOrNull<StorageSnapshot>(SystemMonitorChannel.StorageRead);
  }

  /**
   * Reads the network interfaces, their activity, the connections and the DNS latency now (for the
   * monitor's agent).
   * @returns Returns the network, or null outside Electron or when it could not be read.
   */
  public readNetworkNow(): Promise<NetworkSnapshot | null> {
    return this.invokeOrNull<NetworkSnapshot>(SystemMonitorChannel.NetworkRead);
  }

  /**
   * Invokes a backend channel, treating a missing bridge or a failure as no answer.
   * @param channel The channel.
   * @returns Returns the answer, or null.
   */
  private async invokeOrNull<T>(channel: SystemMonitorChannel): Promise<T | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return (await this.bridge.invoke<T | null>(channel)) ?? null;
    } catch {
      return null;
    }
  }
}
