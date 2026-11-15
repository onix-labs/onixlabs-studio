import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  NetworkInfo,
  NetworkReading,
  SystemMonitorChannel,
} from '@shared/api/system-monitor-channels';

/**
 * The renderer client for the machine's network: its interfaces, their activity, and the connections
 * open on them. A thin, typed wrapper over the generic {@link Bridge}.
 *
 * It reads through the System Monitor's network channels rather than channels of its own. The backend
 * already lists interfaces and connections on every platform, ref-counts its consumers, and samples
 * only while one is listening, so a Network Explorer is simply another consumer. When capture arrives
 * the explorer gains a backend of its own; until then there is nothing for it to own.
 *
 * Outside Electron every method is a safe no-op.
 */
@Service()
export class NetworkProbe {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Asks the backend to read the network for this consumer. Ref-counted in the backend.
   */
  public start(): void {
    this.bridge?.send(SystemMonitorChannel.NetworkStart);
  }

  /**
   * Asks the backend to stop reading the network for this consumer.
   */
  public stop(): void {
    this.bridge?.send(SystemMonitorChannel.NetworkStop);
  }

  /**
   * Subscribes to pushed network readings. Interfaces' activity arrives with every reading; the
   * connections only with some of them, so a reading without them leaves the last list standing.
   * @param listener The callback invoked with each reading.
   * @returns Returns a function that removes the subscription.
   */
  public onReading(listener: (reading: NetworkReading) => void): () => void {
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
  public async info(): Promise<NetworkInfo | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<NetworkInfo>(SystemMonitorChannel.NetworkInfo);
    } catch {
      return null;
    }
  }
}
