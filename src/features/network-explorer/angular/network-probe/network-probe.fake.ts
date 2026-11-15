import { NetworkInfo, NetworkReading } from '@shared/api/system-monitor-channels';

/**
 * A stand-in for the backend: it answers the interfaces it was given and pushes readings on demand.
 */
export class FakeNetworkProbe {
  /**
   * Gets the number of consumers the backend is sampling for.
   */
  public consumers: number = 0;

  /**
   * Gets the network the probe answers with.
   */
  public network: NetworkInfo | null = null;

  /**
   * Holds the subscribed listeners.
   */
  private readonly listeners: Set<(reading: NetworkReading) => void> = new Set<
    (reading: NetworkReading) => void
  >();

  /**
   * Counts a consumer in.
   */
  public start(): void {
    this.consumers += 1;
  }

  /**
   * Counts a consumer out.
   */
  public stop(): void {
    this.consumers -= 1;
  }

  /**
   * Subscribes a listener.
   * @param listener The listener.
   * @returns Returns the unsubscribe function.
   */
  public onReading(listener: (reading: NetworkReading) => void): () => void {
    this.listeners.add(listener);
    return (): void => void this.listeners.delete(listener);
  }

  /**
   * Answers the network.
   * @returns Returns the network.
   */
  public info(): Promise<NetworkInfo | null> {
    return Promise.resolve(this.network);
  }

  /**
   * Pushes a reading to every listener.
   * @param reading The reading.
   */
  public push(reading: NetworkReading): void {
    for (const listener of this.listeners) {
      listener(reading);
    }
  }

  /**
   * Gets the number of subscribed listeners.
   * @returns Returns the count.
   */
  public get subscribed(): number {
    return this.listeners.size;
  }
}
