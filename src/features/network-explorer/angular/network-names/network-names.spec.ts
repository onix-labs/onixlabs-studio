import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { HostName, HostNamesAnswer, NetworkNamesChannel } from '@shared/api/network-names-channels';
import { NetworkNames } from './network-names';

/**
 * Stands in for the main process's names: it answers from a table and records what it was asked.
 */
class NamesBridge implements Bridge {
  /**
   * Gets the names it answers, by address.
   */
  public readonly table: Map<string, string> = new Map<string, string>();

  /**
   * Gets every request it was asked, in order.
   */
  public readonly requests: (readonly string[])[] = [];

  /**
   * Holds the learned-names listener.
   */
  private learned: ((...args: unknown[]) => void) | undefined;

  /**
   * Answers a request to name addresses.
   * @param channel The channel.
   * @param args The arguments.
   * @returns Returns the answer.
   */
  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    expect(channel).toBe(String(NetworkNamesChannel.Resolve));
    const addresses: readonly string[] = args[0] as readonly string[];
    this.requests.push(addresses);
    const answer: HostNamesAnswer = {
      kind: 'resolved',
      names: addresses.map((address: string): HostName => {
        const name: string | undefined = this.table.get(address);
        return name === undefined ? { address } : { address, name, source: 'reverse' };
      }),
    };
    return Promise.resolve(answer as T);
  }

  /**
   * Ignores a send.
   */
  public send(): void {
    // Not used.
  }

  /**
   * Records the learned-names listener.
   * @param _channel The channel.
   * @param listener The listener.
   * @returns Returns the unsubscribe function.
   */
  public on(_channel: string, listener: (...args: unknown[]) => void): () => void {
    this.learned = listener;
    return (): void => undefined;
  }

  /**
   * Pushes names a capture learned.
   * @param names The names.
   */
  public push(names: readonly HostName[]): void {
    this.learned?.(names);
  }
}

describe('NetworkNames', () => {
  let bridge: NamesBridge;
  let names: NetworkNames;

  beforeEach((): void => {
    bridge = new NamesBridge();
    Object.defineProperty(window, 'bridge', { value: bridge, configurable: true });
    names = TestBed.inject(NetworkNames);
  });

  afterEach((): void => {
    Reflect.deleteProperty(window, 'bridge');
  });

  it('resolve_asksOnceForEachAddress_writtenCanonically', async () => {
    bridge.table.set('140.82.113.25', 'lb-140-82-113-25-iad.github.com');

    await names.resolve(['140.82.113.25', '140.82.113.25', '2606:4700:0:0::1111%en0']);

    expect(bridge.requests).toEqual([['140.82.113.25', '2606:4700::1111']]);
    expect(names.names().get('140.82.113.25')).toBe('lb-140-82-113-25-iad.github.com');
  });

  it('resolve_skipsNamedAddresses_andThoseRecentlyFoundUnnamed', async () => {
    let time: number = 0;
    bridge.table.set('1.1.1.1', 'one.one.one.one');
    await names.resolve(['1.1.1.1', '203.0.113.9'], (): number => time);

    await names.resolve(['1.1.1.1', '203.0.113.9'], (): number => time);
    expect(bridge.requests).toHaveLength(1);

    time += 10 * 60 * 1000;
    await names.resolve(['1.1.1.1', '203.0.113.9'], (): number => time);
    expect(bridge.requests).toEqual([['1.1.1.1', '203.0.113.9'], ['203.0.113.9']]);
  });

  it('resolve_asksInChunks', async () => {
    const addresses: readonly string[] = Array.from(
      { length: 40 },
      (_value: unknown, index: number): string => `203.0.113.${String(index + 1)}`,
    );

    await names.resolve(addresses);

    expect(bridge.requests.map((request: readonly string[]): number => request.length)).toEqual([
      16, 16, 8,
    ]);
  });

  it('namesLearnedFromACapture_replaceReverseOnes', async () => {
    bridge.table.set('140.82.113.25', 'lb-140-82-113-25-iad.github.com');
    await names.resolve(['140.82.113.25']);

    bridge.push([{ address: '140.82.113.25', name: 'api.github.com', source: 'capture' }]);

    expect(names.names().get('140.82.113.25')).toBe('api.github.com');
  });
});
