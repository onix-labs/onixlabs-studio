import { Signal, signal, WritableSignal } from '@angular/core';
import { canonicalAddress } from '@shared/api/network-names-channels';

/**
 * A stand-in for the host names the main process knows: the test says what each address is called,
 * and it records what it was asked to name.
 */
export class FakeNetworkNames {
  /**
   * Gets every address it was asked to name, in order.
   */
  public readonly asked: string[] = [];

  /**
   * Holds the names, by canonical address.
   */
  private readonly state: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());

  /**
   * Gets the names, by canonical address.
   */
  public readonly names: Signal<ReadonlyMap<string, string>> = this.state.asReadonly();

  /**
   * Says what an address is called, as a capture or reverse DNS would.
   * @param address The address.
   * @param name Its name.
   */
  public name(address: string, name: string): void {
    this.state.update(
      (current: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
        new Map<string, string>([...current, [canonicalAddress(address), name]]),
    );
  }

  /**
   * Records the addresses asked about.
   * @param addresses The addresses.
   * @returns Returns a resolved promise.
   */
  public resolve(addresses: readonly string[]): Promise<void> {
    this.asked.push(...addresses);
    return Promise.resolve();
  }
}
