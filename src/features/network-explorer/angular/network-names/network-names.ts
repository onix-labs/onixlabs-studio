import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  canonicalAddress,
  HostName,
  HostNamesAnswer,
  NetworkNamesChannel,
} from '@shared/api/network-names-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * How many addresses one request asks about, so names trickle in as reverse DNS answers rather than
 * all waiting on the slowest.
 */
const CHUNK: number = 16;

/**
 * How long an address with no name is left unasked, in milliseconds; the main process remembers
 * that for as long, so asking sooner would only be answered from its memory.
 */
const UNNAMED_RETRY_MS: number = 10 * 60 * 1000;

/**
 * The renderer's view of what the remote hosts the Network Explorer lists are called, by canonical
 * address. Names learned from a capture arrive as they are learned and replace any reverse DNS name;
 * the rest are asked for.
 *
 * One for the whole app rather than one per tab: what an address is called is the same whichever
 * explorer asked.
 */
@Service()
export class NetworkNames {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds every name known, by canonical address.
   */
  private readonly namesState: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());

  /**
   * Holds the addresses asked about and not yet answered.
   */
  private readonly pending: Set<string> = new Set<string>();

  /**
   * Holds when each address answered with no name was answered, by canonical address.
   */
  private readonly unnamed: Map<string, number> = new Map<string, number>();

  /**
   * Gets every name known, by canonical address (see {@link canonicalAddress}).
   */
  public readonly names: Signal<ReadonlyMap<string, string>> = this.namesState.asReadonly();

  /**
   * Follows the names captures learn.
   */
  public constructor() {
    this.bridge?.on(NetworkNamesChannel.Learned, (...args: unknown[]): void =>
      this.remember(args[0] as readonly HostName[]),
    );
  }

  /**
   * Learns what addresses are called, asking only about those not already named, being asked about,
   * or recently found to have no name.
   * @param addresses The addresses, in any form.
   * @param now Reads the clock.
   */
  public async resolve(addresses: readonly string[], now: () => number = Date.now): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    const bridge: Bridge = this.bridge;
    const known: ReadonlyMap<string, string> = this.namesState();
    const time: number = now();
    const asking: readonly string[] = [
      ...new Set<string>(addresses.map((address: string): string => canonicalAddress(address))),
    ].filter(
      (address: string): boolean =>
        address.length > 0 &&
        !known.has(address) &&
        !this.pending.has(address) &&
        time - (this.unnamed.get(address) ?? -Infinity) >= UNNAMED_RETRY_MS,
    );
    if (asking.length === 0) {
      return;
    }
    asking.forEach((address: string): void => void this.pending.add(address));
    const chunks: (readonly string[])[] = [];
    for (let start: number = 0; start < asking.length; start += CHUNK) {
      chunks.push(asking.slice(start, start + CHUNK));
    }
    await Promise.all(
      chunks.map((chunk: readonly string[]): Promise<void> => this.ask(bridge, chunk, now)),
    );
  }

  /**
   * Asks the main process to name a few addresses, and remembers what it says.
   * @param bridge The IPC transport.
   * @param addresses The canonical addresses.
   * @param now Reads the clock.
   */
  private async ask(
    bridge: Bridge,
    addresses: readonly string[],
    now: () => number,
  ): Promise<void> {
    try {
      const answer: HostNamesAnswer = await bridge.invoke<HostNamesAnswer>(
        NetworkNamesChannel.Resolve,
        addresses,
      );
      if (answer.kind === 'failed') {
        this.log.warn('network-explorer.names', 'Could not name addresses', answer.message);
        return;
      }
      const time: number = now();
      for (const entry of answer.names) {
        if (entry.name === undefined) {
          this.unnamed.set(entry.address, time);
        }
      }
      this.remember(answer.names);
    } catch (error: unknown) {
      this.log.warn('network-explorer.names', 'Could not name addresses', error);
    } finally {
      addresses.forEach((address: string): void => void this.pending.delete(address));
    }
  }

  /**
   * Remembers names. A name already known is replaced: the main process only ever sends a capture
   * name over a reverse one, never the other way round.
   * @param names The names.
   */
  private remember(names: readonly HostName[]): void {
    const named: readonly HostName[] = names.filter(
      (entry: HostName): boolean => entry.name !== undefined,
    );
    if (named.length === 0) {
      return;
    }
    this.namesState.update((current: ReadonlyMap<string, string>): ReadonlyMap<string, string> => {
      const next: Map<string, string> = new Map<string, string>(current);
      for (const entry of named) {
        if (entry.name !== undefined) {
          const address: string = canonicalAddress(entry.address);
          next.set(address, entry.name);
          this.unnamed.delete(address);
        }
      }
      return next;
    });
  }
}
