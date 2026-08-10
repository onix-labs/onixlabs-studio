import { effect, inject, Service, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { Icon } from '@shared/angular/icons/icon';
import { ContainerSummary } from '@shared/api/docker-types';
import { Docker } from '../docker/docker';

/**
 * The status-strip segment id and the owner/priority this feature contributes under.
 */
const RUNNING_SEGMENT_ID: string = 'containers-running';
const STATUS_OWNER: string = 'containers';
const STATUS_PRIORITY: number = 15;

/**
 * Contributes the running-container count to the shared status strip. It watches the Docker backend —
 * seeded once on creation and refreshed on every engine event — and publishes a trailing segment while
 * the daemon is reachable, clearing it when Docker is absent. Instantiated by the Containers view, it
 * is a singleton and keeps the count live for the rest of the session.
 */
@Service()
export class ContainersStatus {
  /**
   * Holds the shared status strip.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the Docker client the count is derived from.
   */
  private readonly docker: Docker = inject(Docker);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the running-container count, or null when the daemon is unreachable (segment cleared).
   */
  private readonly runningCount: WritableSignal<number | null> = signal<number | null>(null);

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
        {
          leading: [],
          trailing: [
            {
              id: RUNNING_SEGMENT_ID,
              text: `${count} running`,
              icon: Icon.CONTAINERS,
              title: 'Running containers',
            },
          ],
        },
        STATUS_PRIORITY,
      );
    });

    this.log.info('containers.status', 'Running-container status contribution started');
    void this.refresh();
    this.docker.onEvents((): void => {
      void this.refresh();
    });
  }

  /**
   * Re-reads the daemon status and container list, updating the running count (or clearing it when the
   * daemon is unreachable).
   * @returns Returns a promise that resolves once the count has been refreshed.
   */
  private async refresh(): Promise<void> {
    this.log.trace('containers.status', 'Refreshing running-container count');
    const available: boolean = (await this.docker.status()).available;
    if (!available) {
      this.runningCount.set(null);
      return;
    }
    const containers: ContainerSummary[] = await this.docker.listContainers();
    this.runningCount.set(
      containers.filter((container: ContainerSummary): boolean => container.state === 'running').length,
    );
  }
}
