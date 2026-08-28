/**
 * A hand-driven stand-in for the browser's {@link IntersectionObserver}, for components that decide
 * something for themselves by watching whether one of their elements is on screen.
 *
 * jsdom has no layout and so has no intersection observer at all: a component that watches its own
 * element simply never hears anything there, which is the right default (it stays as it started) but
 * leaves the interesting half untested. Installing this puts the observations under the test's control
 * — {@link FakeIntersectionObserver.report} says an element has gone off or come back on screen — so
 * both halves of the behaviour can be asserted.
 */
export class FakeIntersectionObserver {
  /**
   * Holds every observation registered against this installation, in the order they were made.
   */
  private readonly watches: { element: Element; notify: IntersectionObserverCallback }[] = [];

  /**
   * Holds how many observers have been disconnected.
   */
  private disconnects: number = 0;

  /**
   * Holds how many observers have been constructed.
   */
  private constructions: number = 0;

  /**
   * Holds whatever the global carried before this installation, restored by {@link uninstall}.
   */
  private readonly original: unknown = (globalThis as { IntersectionObserver?: unknown })
    .IntersectionObserver;

  /**
   * Installs a fake observer over the global, in place for the life of the test.
   * @returns Returns the installation, which the test drives and then uninstalls.
   */
  public static install(): FakeIntersectionObserver {
    const fake: FakeIntersectionObserver = new FakeIntersectionObserver();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      FakeIntersectionObserver.constructorFor(fake);
    return fake;
  }

  /**
   * Restores whatever the global carried before installation.
   */
  public uninstall(): void {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = this.original;
  }

  /**
   * Reports an element as having come on screen or gone off it, calling back whoever observes it.
   * @param element The observed element.
   * @param isIntersecting Whether the element is now on screen.
   */
  public report(element: Element, isIntersecting: boolean): void {
    for (const watch of this.watches) {
      if (watch.element === element) {
        watch.notify(
          [{ target: element, isIntersecting } as unknown as IntersectionObserverEntry],
          {} as unknown as IntersectionObserver,
        );
      }
    }
  }

  /**
   * Gets every element being observed.
   * @returns Returns the observed elements, in the order they were registered.
   */
  public observed(): readonly Element[] {
    return this.watches.map(
      (watch: { element: Element; notify: IntersectionObserverCallback }): Element => watch.element,
    );
  }

  /**
   * Gets how many observers have been constructed.
   * @returns Returns the construction count.
   */
  public count(): number {
    return this.constructions;
  }

  /**
   * Gets how many observers have been disconnected, so a test can assert that watching stops when the
   * watcher is torn down.
   * @returns Returns the disconnect count.
   */
  public disconnected(): number {
    return this.disconnects;
  }

  /**
   * Builds the constructor installed over the global, closing over the installation it records to.
   * @param records The installation observers register themselves with.
   * @returns Returns a stand-in for the {@link IntersectionObserver} constructor.
   */
  private static constructorFor(records: FakeIntersectionObserver): unknown {
    return class {
      /**
       * Initializes a new observer, recording it against the installation.
       * @param notify The callback intersection changes are reported to.
       */
      public constructor(private readonly notify: IntersectionObserverCallback) {
        records.constructions += 1;
      }

      /**
       * Records an element as observed by this observer.
       * @param element The element to watch.
       */
      public observe(element: Element): void {
        records.watches.push({ element, notify: this.notify });
      }

      /**
       * Stops watching a single element.
       * @param element The element to stop watching.
       */
      public unobserve(element: Element): void {
        const index: number = records.watches.findIndex(
          (watch: { element: Element; notify: IntersectionObserverCallback }): boolean =>
            watch.element === element && watch.notify === this.notify,
        );
        if (index >= 0) {
          records.watches.splice(index, 1);
        }
      }

      /**
       * Stops watching everything this observer watched.
       */
      public disconnect(): void {
        records.disconnects += 1;
        for (let index: number = records.watches.length - 1; index >= 0; index -= 1) {
          if (records.watches[index]?.notify === this.notify) {
            records.watches.splice(index, 1);
          }
        }
      }
    };
  }
}
