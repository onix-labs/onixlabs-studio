import { effect, inject, Service, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { Icon } from '@shared/angular/icons/icon';
import { ContainerSummary } from '@shared/api/container-types';
import { ContainersClient } from '../client/containers-client';

/**
 * The status-strip segment id and the owner/priority this feature contributes under.
 */
const RUNNING_SEGMENT_ID: string = 'containers-running';
const STATUS_OWNER: string = 'containers';
const STATUS_PRIORITY: number = 15;

/**
 * How long engine events coalesce before the count refreshes. A `docker compose up` emits a burst of
 * lifecycle events, and refreshing per event cost two IPC round-trips (status + list) apiece; one
 * refresh at the end of the burst reads the same final count.
 */
const EVENT_REFRESH_DEBOUNCE_MS: number = 500;

/**
 * How often the count re-checks an unreachable engine. While unreachable there is no event stream to
 * hold open (holding one made the backend retry its socket every thirty seconds forever on machines
 * with no daemon at all), so this slow poll is what notices the daemon coming up.
 */
const UNAVAILABLE_RECHECK_MS: number = 60_000;

/**
 * Contributes the running-container count to the status strip's ambient region. It watches the
 * containers backend — seeded once on creation and refreshed on every engine event — and publishes a
 * segment while the engine is reachable, clearing it when no engine is. Instantiated by the Containers
 * view, it is a singleton and keeps the count live for the rest of the session.
 *
 * Ambient is the right register here: how many containers are running is true of the machine, not of
 * whichever tab is in front, so the segment is meant to survive a tab switch. Contrast a view's own
 * status, which belongs to its feature's status component (see `FeatureDescriptor.status`).
 */
@Service()
export class ContainersStatus {
  /**
   * Holds the shared status strip.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the containers client the count is derived from.
   */
  private readonly client: ContainersClient = inject(ContainersClient);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the running-container count, or null when the daemon is unreachable (segment cleared).
   */
  private readonly runningCount: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds whether this singleton currently holds the backend's ref-counted event stream open.
   */
  private watching: boolean = false;

  /**
   * Holds the pending debounced refresh, or null when none is scheduled.
   */
  private refreshDebounce: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the slow unreachable-engine re-check timer, or null while the engine is reachable.
   */
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Seeds the count, subscribes to engine events, and keeps the status segment in sync with the count.
   */
  public constructor() {
    effect((): void => {
      const count: number | null = this.runningCount();
      if (count === null) {
        this.statusBar.clearOwner(STATUS_OWNER);
        return;
      }
      this.statusBar.contribute(
        STATUS_OWNER,
        [
          {
            id: RUNNING_SEGMENT_ID,
            text: `${count} running`,
            icon: Icon.CONTAINERS,
            title: 'Running containers',
          },
        ],
        STATUS_PRIORITY,
      );
    });

    this.log.info('containers.status', 'Running-container status contribution started');
    void this.refresh();
    this.client.onEvents((): void => this.scheduleRefresh());
  }

  /**
   * Coalesces a burst of engine events into one refresh (see {@link EVENT_REFRESH_DEBOUNCE_MS}).
   */
  private scheduleRefresh(): void {
    if (this.refreshDebounce !== null) {
      return;
    }
    this.refreshDebounce = setTimeout((): void => {
      this.refreshDebounce = null;
      void this.refresh();
    }, EVENT_REFRESH_DEBOUNCE_MS);
  }

  /**
   * Re-reads the daemon status and container list, updating the running count (or clearing it when the
   * daemon is unreachable). Reachability decides who pays for liveness: while the engine is reachable
   * this singleton holds the ref-counted event stream open (it is the sanctioned always-on consumer —
   * the count is ambient, true of the machine rather than of any tab); while it is not, the hold is
   * released and a slow re-check stands in, so a machine with no daemon costs one status probe a
   * minute instead of a socket retry loop.
   * @returns Returns a promise that resolves once the count has been refreshed.
   */
  private async refresh(): Promise<void> {
    this.log.trace('containers.status', 'Refreshing running-container count');
    const available: boolean = (await this.client.status()).available;
    if (!available) {
      this.runningCount.set(null);
      if (this.watching) {
        this.watching = false;
        void this.client.watchStop();
      }
      this.armRecheck();
      return;
    }
    if (this.recheckTimer !== null) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }
    if (!this.watching) {
      this.watching = true;
      void this.client.watchStart();
    }
    const containers: ContainerSummary[] = await this.client.listContainers();
    this.runningCount.set(
      containers.filter((container: ContainerSummary): boolean => container.state === 'running')
        .length,
    );
  }

  /**
   * Arms (or re-arms) the slow unreachable-engine re-check (see {@link UNAVAILABLE_RECHECK_MS}).
   */
  private armRecheck(): void {
    if (this.recheckTimer !== null) {
      return;
    }
    this.recheckTimer = setTimeout((): void => {
      this.recheckTimer = null;
      void this.refresh();
    }, UNAVAILABLE_RECHECK_MS);
  }
}
