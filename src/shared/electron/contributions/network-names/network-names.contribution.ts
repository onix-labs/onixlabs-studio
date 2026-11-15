import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import {
  canonicalAddress,
  HostName,
  HostNamesAnswer,
  MAX_RESOLVE_ADDRESSES,
  NetworkNamesChannel,
} from '@shared/api/network-names-channels';
import { ContributionContext, MainContribution } from '../main-contribution';
import { isPrivateAddress } from '../network-geo/geo-addresses';
import { HostNameBook, HostNameEntry, hostNameBook } from './host-name-book';

/**
 * Asks reverse DNS what an address is called, resolving the names its PTR records give; rejects when
 * there are none or the server does not answer.
 */
export type ReverseResolver = (address: string) => Promise<readonly string[]>;

/**
 * How long a reverse name is believed.
 */
const REVERSE_NAME_TTL_MS: number = 60 * 60 * 1000;

/**
 * How long an address reverse DNS could not name is left unasked.
 */
const NO_NAME_TTL_MS: number = 10 * 60 * 1000;

/**
 * The most addresses remembered as having no reverse name.
 */
const MAX_UNNAMED: number = 20_000;

/**
 * How long one reverse query may take before it is given up on, in milliseconds.
 */
const REVERSE_TIMEOUT_MS: number = 2_000;

/**
 * The most reverse queries in flight at once, so a table of hundreds of connections does not flood
 * the resolver.
 */
const MAX_CONCURRENT_QUERIES: number = 8;

/**
 * How long names learned from a capture are gathered before they are sent to the renderer, so a
 * burst of DNS answers crosses the bridge as one message.
 */
const LEARNED_BATCH_MS: number = 250;

/**
 * Reads the addresses to name out of what the renderer sent: a list of at most
 * {@link MAX_RESOLVE_ADDRESSES} IP address literals, each possibly with an IPv6 zone.
 * @param value What was sent.
 * @returns Returns the addresses as sent, or undefined when it is not a list of them.
 */
export function readAddresses(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_RESOLVE_ADDRESSES) {
    return undefined;
  }
  const addresses: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      entry.length > 64 ||
      isIP(entry.split('%')[0]) === 0
    ) {
      return undefined;
    }
    addresses.push(entry);
  }
  return addresses;
}

/**
 * Builds the resolver reverse lookups go through: the system's DNS servers, one try each, given up on
 * after {@link REVERSE_TIMEOUT_MS}.
 * @returns Returns the resolver.
 */
function systemReverseResolver(): ReverseResolver {
  const resolver: dns.Resolver = new dns.Resolver({ timeout: REVERSE_TIMEOUT_MS, tries: 1 });
  return (address: string): Promise<readonly string[]> => resolver.reverse(address);
}

/**
 * Names the hosts the Network Explorer lists, from the shared {@link HostNameBook}: a name seen in a
 * capture is answered straight away; otherwise the address's reverse DNS record is asked for, and
 * what it says remembered for an hour (and that it said nothing, for ten minutes). Addresses on this
 * network, the loopback, link-local and multicast ones are never asked about: their PTR records are
 * the local network's business and slow to be told there are none.
 *
 * Names learned from captures are pushed to the renderer as they are learned, so a connection's name
 * appears while the capture that learned it is still running.
 */
export class NetworkNamesContribution implements MainContribution {
  /**
   * The stable contribution id.
   */
  public readonly id: string = 'network-names';

  /**
   * Holds when each address reverse DNS could not name may be asked about again, by canonical
   * address.
   */
  private readonly unnamed: Map<string, number> = new Map<string, number>();

  /**
   * Holds the reverse queries in flight, by canonical address, so an address asked about twice at
   * once is queried once.
   */
  private readonly inFlight: Map<string, Promise<string | undefined>> = new Map<
    string,
    Promise<string | undefined>
  >();

  /**
   * Holds the queries waiting for a slot.
   */
  private readonly waiting: (() => void)[] = [];

  /**
   * Holds the names learned and not yet sent, by canonical address.
   */
  private readonly learned: Map<string, HostName> = new Map<string, HostName>();

  /**
   * Holds how many reverse queries are running.
   */
  private running: number = 0;

  /**
   * Holds the timer that sends learned names, while some wait to be sent.
   */
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Holds the function that stops listening to the book.
   */
  private stopListening: (() => void) | undefined;

  /**
   * Holds the resolver, made when first needed.
   */
  private resolver: ReverseResolver | undefined;

  /**
   * Creates the contribution.
   * @param book The book names are read from and written to.
   * @param createResolver Makes the reverse DNS resolver.
   * @param now Reads the clock.
   */
  public constructor(
    private readonly book: HostNameBook = hostNameBook,
    private readonly createResolver: () => ReverseResolver = systemReverseResolver,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Wires the resolve channel, and sends names learned from captures as they are learned.
   * @param context The surface the contribution reaches the application through.
   */
  public activate(context: ContributionContext): void {
    context.handle(
      NetworkNamesChannel.Resolve,
      async (_event: unknown, payload: unknown): Promise<HostNamesAnswer> => {
        const addresses: readonly string[] | undefined = readAddresses(payload);
        if (addresses === undefined) {
          return { kind: 'failed', message: 'That is not a list of IP addresses.' };
        }
        const names: readonly HostName[] = await Promise.all(
          addresses.map((address: string): Promise<HostName> => this.name(address)),
        );
        return { kind: 'resolved', names };
      },
    );
    this.stopListening = this.book.onLearned((names: readonly HostName[]): void => {
      for (const name of names) {
        this.learned.set(name.address, name);
      }
      this.timer ??= setTimeout((): void => {
        this.timer = undefined;
        const batch: readonly HostName[] = [...this.learned.values()];
        this.learned.clear();
        context.send(NetworkNamesChannel.Learned, batch);
      }, LEARNED_BATCH_MS);
    });
  }

  /**
   * Stops listening to the book and drops names not yet sent.
   */
  public dispose(): void {
    this.stopListening?.();
    this.stopListening = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.learned.clear();
  }

  /**
   * Names one address: from the book, or by asking reverse DNS when it may be asked.
   * @param address The address, as sent.
   * @returns Returns a promise resolving what is known of its name.
   */
  private async name(address: string): Promise<HostName> {
    const key: string = canonicalAddress(address);
    const known: HostNameEntry | undefined = this.book.lookup(key);
    if (known !== undefined) {
      return { address, name: known.name, source: known.source };
    }
    if (isPrivateAddress(key) || (this.unnamed.get(key) ?? 0) > this.now()) {
      return { address };
    }
    let query: Promise<string | undefined> | undefined = this.inFlight.get(key);
    if (query === undefined) {
      query = this.reverse(key);
      this.inFlight.set(key, query);
    }
    const name: string | undefined = await query;
    // A capture may have named the address while reverse DNS was being asked; that name wins.
    const entry: HostNameEntry | undefined = this.book.lookup(key);
    if (entry !== undefined) {
      return { address, name: entry.name, source: entry.source };
    }
    return name === undefined ? { address } : { address, name, source: 'reverse' };
  }

  /**
   * Asks reverse DNS what an address is called, once a slot is free, and writes down the answer.
   * @param key The canonical address.
   * @returns Returns a promise resolving its first PTR name, or undefined when it has none.
   */
  private async reverse(key: string): Promise<string | undefined> {
    await this.acquire();
    try {
      this.resolver ??= this.createResolver();
      const names: readonly string[] = await this.resolver(key);
      const name: string | undefined = names
        .map((entry: string): string => entry.toLowerCase().replace(/\.$/, ''))
        .find((entry: string): boolean => entry.length > 0);
      if (name === undefined) {
        this.markUnnamed(key);
        return undefined;
      }
      this.book.learn(key, name, 'reverse', REVERSE_NAME_TTL_MS);
      return name;
    } catch {
      // No PTR record, or no answer in time: either way, there is no name to show for a while.
      this.markUnnamed(key);
      return undefined;
    } finally {
      this.inFlight.delete(key);
      this.release();
    }
  }

  /**
   * Notes that reverse DNS could not name an address, so it is not asked again for a while.
   * @param key The canonical address.
   */
  private markUnnamed(key: string): void {
    this.unnamed.delete(key);
    this.unnamed.set(key, this.now() + NO_NAME_TTL_MS);
    // A long session meets many addresses; the earliest noted are the first to forget.
    const oldest: string | undefined = this.unnamed.keys().next().value;
    if (this.unnamed.size > MAX_UNNAMED && oldest !== undefined) {
      this.unnamed.delete(oldest);
    }
  }

  /**
   * Waits for a query slot.
   * @returns Returns a promise resolving once one is taken.
   */
  private async acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT_QUERIES) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve: () => void): void => void this.waiting.push(resolve));
  }

  /**
   * Frees a query slot, handing it straight to the next query waiting.
   */
  private release(): void {
    const next: (() => void) | undefined = this.waiting.shift();
    if (next === undefined) {
      this.running -= 1;
    } else {
      next();
    }
  }
}

/**
 * The singleton network-names contribution appended to the `mainContributions` manifest.
 */
export const networkNamesContribution: MainContribution = new NetworkNamesContribution();
