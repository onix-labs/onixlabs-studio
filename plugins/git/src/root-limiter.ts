/**
 * Specifies how many requests run at once against one repository. Measured, with 64 `git status`
 * arriving together: 8 at a time was the quickest and the steadiest (about 560 ms, where 4 took about
 * 790 ms and no limit anywhere from 490 ms to 1600 ms, with a process per request).
 */
const DEFAULT_LIMIT: number = 8;

/**
 * Holds one repository's running count and its queue.
 */
interface RootState {
  /**
   * Holds how many requests are running.
   */
  running: number;

  /**
   * Holds the requests waiting, oldest first.
   */
  readonly waiting: (() => void)[];
}

/**
 * Limits how many requests run at once per repository, in the order they arrived.
 */
export class RootLimiter {
  /**
   * Holds each repository with requests running.
   */
  private readonly roots: Map<string, RootState> = new Map<string, RootState>();

  /**
   * Holds how many requests may run at once per repository.
   */
  private readonly limit: number;

  /**
   * Initializes a new instance of the {@link RootLimiter} class.
   * @param limit How many requests may run at once per repository.
   */
  public constructor(limit: number = DEFAULT_LIMIT) {
    this.limit = limit;
  }

  /**
   * Runs a request when its repository has room for it.
   * @param root The repository.
   * @param task The request.
   * @returns Returns what the request returns.
   */
  public async run<T>(root: string, task: () => Promise<T>): Promise<T> {
    await this.acquire(root);
    try {
      return await task();
    } finally {
      this.release(root);
    }
  }

  /**
   * Takes a place, waiting for one when there are none.
   * @param root The repository.
   * @returns Returns a promise that resolves once the place is held.
   */
  private async acquire(root: string): Promise<void> {
    const state: RootState = this.roots.get(root) ?? { running: 0, waiting: [] };
    this.roots.set(root, state);
    if (state.running < this.limit) {
      state.running += 1;
      return;
    }
    await new Promise<void>((resolve: () => void): void => {
      state.waiting.push(resolve);
    });
  }

  /**
   * Gives a place up, handing it straight to the oldest request waiting so none can jump the queue.
   * @param root The repository.
   */
  private release(root: string): void {
    const state: RootState | undefined = this.roots.get(root);
    if (state === undefined) {
      return;
    }
    const next: (() => void) | undefined = state.waiting.shift();
    if (next !== undefined) {
      next();
      return;
    }
    state.running -= 1;
    if (state.running === 0) {
      this.roots.delete(root);
    }
  }
}
