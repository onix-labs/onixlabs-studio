// What makes polling a forge affordable: an entity-tag cache and a rate-limit ledger. Pure logic, kept
// free of Electron and Node imports so both are unit-testable with a fake clock.
//
// The two work together. GitHub does not count a conditional request that answers 304 against the rate
// limit, so a section re-read on a timer costs nothing at all while nothing has changed — but only if
// the entity tag is sent, and only if the answer is served from the cache rather than treated as an
// empty body. The ledger is the backstop for everything else: it reads the budget the forge reports
// and refuses to spend the last of it, so the limit is approached and never hit.

/**
 * How many requests are held back from the reported budget. Studio is rarely the only thing on a
 * token — a `gh` command or a browser tab shares it — so spending to the last request would leave
 * whatever the user does next to be the one that fails.
 */
const RESERVE: number = 20;

/**
 * The clock the ledger reads, injected so a test can drive it.
 */
export type Clock = () => number;

/**
 * One cached response: the entity tag to revalidate with, and the body last seen with it.
 */
interface CacheEntry {
  /**
   * Gets the entity tag the forge issued.
   */
  readonly etag: string;

  /**
   * Gets the parsed body that tag stands for.
   */
  readonly body: unknown;
}

/**
 * Holds each URL's entity tag and the body it stands for, so a re-read can be revalidated rather than
 * re-fetched.
 *
 * Keyed by URL alone, which is safe only because the cache is dropped whenever the credential changes:
 * two accounts can see different things at the same URL, and serving one's cached body to the other
 * would be a leak rather than a stale read. {@link clear} is what enforces that.
 */
export class EtagCache {
  /**
   * Holds the entries, keyed by URL.
   */
  private readonly entries: Map<string, CacheEntry> = new Map<string, CacheEntry>();

  /**
   * Reads the entity tag to revalidate a URL with.
   * @param url The request URL.
   * @returns Returns the tag, or null when nothing is cached for it.
   */
  public tagFor(url: string): string | null {
    return this.entries.get(url)?.etag ?? null;
  }

  /**
   * Reads the body cached for a URL.
   * @param url The request URL.
   * @returns Returns the body, or undefined when nothing is cached for it.
   */
  public bodyFor(url: string): unknown {
    return this.entries.get(url)?.body;
  }

  /**
   * Determines whether a URL has a cached body.
   * @param url The request URL.
   * @returns Returns true when a body is cached.
   */
  public has(url: string): boolean {
    return this.entries.has(url);
  }

  /**
   * Stores a response against its entity tag. A response the forge sent no tag for is not cached: it
   * could never be revalidated, so keeping it would only risk serving it as though it could.
   * @param url The request URL.
   * @param etag The entity tag, or null when the response carried none.
   * @param body The parsed body.
   */
  public store(url: string, etag: string | null, body: unknown): void {
    if (etag === null || etag.length === 0) {
      return;
    }
    this.entries.set(url, { etag, body });
  }

  /**
   * Drops everything cached. Called whenever the credential changes, since the cache is keyed by URL
   * alone and two accounts do not see the same things at the same URL.
   */
  public clear(): void {
    this.entries.clear();
  }
}

/**
 * Tracks the forge's reported request budget, so the limit is approached rather than hit.
 *
 * GitHub reports the budget on every response, and refuses with 403 once it is gone — which is
 * indistinguishable, at the status line, from a token that lacks a scope. Reading the headers instead
 * lets Studio stop before that happens and say when it will resume, rather than showing an
 * authentication error for something that is not one.
 */
export class RateLimitLedger {
  /**
   * Holds the clock.
   */
  private readonly now: Clock;

  /**
   * Holds the requests the forge last reported as remaining, or null before any response.
   */
  private remaining: number | null = null;

  /**
   * Holds when the budget resets, as epoch milliseconds, or null before any response.
   */
  private resetAt: number | null = null;

  /**
   * Initializes a new instance of the {@link RateLimitLedger} class.
   * @param now The clock to read.
   */
  public constructor(now: Clock) {
    this.now = now;
  }

  /**
   * Records what a response reported about the budget. A response carrying no rate-limit headers
   * leaves the ledger untouched rather than resetting it — an unrelated failure must not look like a
   * budget that has recovered.
   * @param remainingHeader The `x-ratelimit-remaining` value, or null.
   * @param resetHeader The `x-ratelimit-reset` value (epoch seconds), or null.
   * @param retryAfterHeader The `retry-after` value (seconds), or null. Sent for the secondary rate
   * limit, which is a separate mechanism from the hourly budget and answered the same way.
   */
  public record(
    remainingHeader: string | null,
    resetHeader: string | null,
    retryAfterHeader: string | null,
  ): void {
    const retryAfter: number = Number.parseInt(retryAfterHeader ?? '', 10);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      // A secondary-limit response says only "wait this long", so the budget is treated as spent for
      // that long whatever the hourly headers say.
      this.remaining = 0;
      this.resetAt = this.now() + retryAfter * 1000;
      return;
    }
    const remaining: number = Number.parseInt(remainingHeader ?? '', 10);
    const reset: number = Number.parseInt(resetHeader ?? '', 10);
    if (!Number.isFinite(remaining) || !Number.isFinite(reset)) {
      return;
    }
    this.remaining = remaining;
    this.resetAt = reset * 1000;
  }

  /**
   * Gets when the forge will accept requests again, or null when it will accept one now.
   *
   * The budget counts as spent while more than {@link RESERVE} requests short of empty, so the
   * reserve is left for whatever the user does by hand. Once the reset has passed the budget is
   * available again without needing a response to prove it — which is what lets the panel recover on
   * its own rather than waiting for a request nobody will make.
   *
   * @returns Returns the epoch milliseconds to wait until, or null when nothing is owed.
   */
  public blockedUntil(): number | null {
    if (this.remaining === null || this.resetAt === null || this.remaining > RESERVE) {
      return null;
    }
    if (this.now() >= this.resetAt) {
      // The window rolled over. Clearing rather than merely reporting available keeps a stale reading
      // from blocking again on the next call.
      this.remaining = null;
      this.resetAt = null;
      return null;
    }
    return this.resetAt;
  }

  /**
   * Drops what is recorded, for a credential change — the budget belongs to the token.
   */
  public clear(): void {
    this.remaining = null;
    this.resetAt = null;
  }
}
