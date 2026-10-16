/**
 * Turns a burst of "reload now" requests into as few reloads as possible: one after the burst has
 * settled, and one more after a reload that was already running when a request arrived.
 *
 * `docker compose up` with twenty services raises a hundred engine events in a few seconds, and each
 * used to reload the whole view — four engine calls a time, resolving in any order, the last to land
 * winning (audit P6). The view asks for a reload; this decides when one runs.
 */
export class ReloadCoalescer {
  /**
   * Holds the pending trailing-edge timer, or null when none is scheduled.
   */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether a reload is running.
   */
  private running: boolean = false;

  /**
   * Holds whether a request arrived while a reload was running, so one more follows it.
   */
  private dirty: boolean = false;

  /**
   * Initializes a new instance of the {@link ReloadCoalescer} class.
   * @param reload What a reload does.
   * @param delayMs How long a burst is allowed to settle before the reload runs.
   */
  public constructor(
    private readonly reload: () => Promise<void>,
    private readonly delayMs: number,
  ) {}

  /**
   * Asks for a reload. Requests within the delay of each other fold into one.
   */
  public request(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout((): void => {
      this.timer = null;
      void this.run();
    }, this.delayMs);
  }

  /**
   * Drops a pending request, for teardown.
   */
  public cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty = false;
  }

  /**
   * Runs one reload, or marks one owed when a reload is already running.
   * @returns Resolves once this reload, and any it owed, have run.
   */
  private async run(): Promise<void> {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    try {
      await this.reload();
    } finally {
      this.running = false;
      if (this.dirty) {
        this.dirty = false;
        void this.run();
      }
    }
  }
}
