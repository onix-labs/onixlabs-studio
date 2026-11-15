import { canonicalAddress, HostName, HostNameSource } from '@shared/api/network-names-channels';

/**
 * What the book says about one address.
 */
export interface HostNameEntry {
  /**
   * Gets the address's name.
   */
  readonly name: string;

  /**
   * Gets where the name was learned.
   */
  readonly source: HostNameSource;

  /**
   * Gets when the name stops being believed, in milliseconds since the Unix epoch.
   */
  readonly expires: number;
}

/**
 * Hears of names the book learned from a capture that changed what it says.
 */
export type HostNamesListener = (names: readonly HostName[]) => void;

/**
 * How long a name seen in a capture is believed: long, because a connection opened from a DNS answer
 * outlives the answer's TTL by hours, and the name is what the application asked for.
 */
export const CAPTURE_NAME_TTL_MS: number = 12 * 60 * 60 * 1000;

/**
 * The most addresses the book remembers; past it, the names learned longest ago are forgotten.
 */
const CAPACITY: number = 20_000;

/**
 * The main process's book of host names: what each IP address is called, as far as is known, and
 * where that name came from.
 *
 * A name seen in a capture — a DNS answer, a TLS server name — always beats a reverse DNS one: it is
 * the name an application actually used, where a PTR record often names a load balancer. A reverse
 * name never overwrites a capture name still believed; a capture name overwrites anything.
 *
 * One book is shared by the capture contribution, which writes what it sees, and the names
 * contribution, which answers the renderer and writes what reverse DNS says.
 */
export class HostNameBook {
  /**
   * Holds the entries, by canonical address, the least recently written first.
   */
  private readonly entries: Map<string, HostNameEntry> = new Map<string, HostNameEntry>();

  /**
   * Holds those hearing of names learned from captures.
   */
  private readonly listeners: Set<HostNamesListener> = new Set<HostNamesListener>();

  /**
   * Creates a book.
   * @param now Reads the clock.
   * @param capacity The most addresses remembered.
   */
  public constructor(
    private readonly now: () => number = Date.now,
    private readonly capacity: number = CAPACITY,
  ) {}

  /**
   * Gets what the book says about an address, while it is still believed.
   * @param address The address, in any form.
   * @returns Returns the entry, or undefined when the address has no name believed.
   */
  public lookup(address: string): HostNameEntry | undefined {
    const key: string = canonicalAddress(address);
    const entry: HostNameEntry | undefined = this.entries.get(key);
    if (entry !== undefined && entry.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /**
   * Writes an address's name, unless it is a reverse name for an address whose capture name is
   * still believed. Listeners hear of a capture name that changes what the book says.
   * @param address The address, in any form.
   * @param name The name.
   * @param source Where the name was learned.
   * @param ttlMs How long it is believed, in milliseconds.
   * @returns Returns true when the book now says something it did not.
   */
  public learn(address: string, name: string, source: HostNameSource, ttlMs: number): boolean {
    const changed: boolean = this.write(address, name, source, ttlMs);
    if (changed && source === 'capture') {
      this.announce([{ address: canonicalAddress(address), name, source }]);
    }
    return changed;
  }

  /**
   * Writes many names seen in a capture at once, so listeners hear of them together.
   * @param sightings The names and their addresses.
   * @param ttlMs How long they are believed, in milliseconds.
   */
  public learnFromCapture(
    sightings: readonly HostName[],
    ttlMs: number = CAPTURE_NAME_TTL_MS,
  ): void {
    const learned: HostName[] = [];
    for (const sighting of sightings) {
      if (
        sighting.name !== undefined &&
        this.write(sighting.address, sighting.name, 'capture', ttlMs)
      ) {
        learned.push({
          address: canonicalAddress(sighting.address),
          name: sighting.name,
          source: 'capture',
        });
      }
    }
    if (learned.length > 0) {
      this.announce(learned);
    }
  }

  /**
   * Listens for names learned from captures that change what the book says.
   * @param listener The listener.
   * @returns Returns a function that stops it listening.
   */
  public onLearned(listener: HostNamesListener): () => void {
    this.listeners.add(listener);
    return (): void => void this.listeners.delete(listener);
  }

  /**
   * Writes an address's name, as {@link learn} does, without telling anyone.
   * @param address The address, in any form.
   * @param name The name.
   * @param source Where the name was learned.
   * @param ttlMs How long it is believed, in milliseconds.
   * @returns Returns true when the book now says something it did not.
   */
  private write(address: string, name: string, source: HostNameSource, ttlMs: number): boolean {
    const key: string = canonicalAddress(address);
    const existing: HostNameEntry | undefined = this.lookup(key);
    if (source === 'reverse' && existing?.source === 'capture') {
      return false;
    }
    const changed: boolean = existing?.name !== name || existing.source !== source;
    // Re-inserting moves the address to the end, so the oldest are at the front to forget.
    this.entries.delete(key);
    this.entries.set(key, { name, source, expires: this.now() + ttlMs });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.capacity) {
        break;
      }
      this.entries.delete(oldest);
    }
    return changed;
  }

  /**
   * Tells the listeners of names learned.
   * @param names The names.
   */
  private announce(names: readonly HostName[]): void {
    for (const listener of this.listeners) {
      listener(names);
    }
  }
}

/**
 * The book the capture and names contributions share.
 */
export const hostNameBook: HostNameBook = new HostNameBook();
