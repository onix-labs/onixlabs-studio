import { effect, inject, Service, untracked } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import {
  NotificationAction,
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ContainerEvent } from '@shared/api/container-types';
import { ContainersClient } from '../client/containers-client';
import { ContainerTerminals } from '../container-terminals/container-terminals';
import { ContainerNotificationType } from './container-notification-types';

/**
 * Specifies how often the engine is asked whether it is still there, to say when it stops or comes
 * back.
 */
const ENGINE_CHECK_MS: number = 60_000;

/**
 * Specifies how many times a container may stop within {@link RESTART_WINDOW_MS} before it is reported
 * as restarting over and over rather than exiting each time.
 */
const RESTART_LIMIT: number = 3;

/**
 * Specifies the window {@link RESTART_LIMIT} stops are counted in.
 */
const RESTART_WINDOW_MS: number = 2 * 60_000;

/**
 * Tells the user what the container engine did while they were not asking (#1488): a container that
 * stopped on its own, ran out of memory, went unhealthy or keeps restarting; an image download started
 * from Studio that finished; the engine itself stopping or coming back.
 *
 * It listens from start-up, whenever a container engine plugin is installed, whether or not the
 * Containers tab has been opened. What Studio itself just did to a container — Stop, Restart,
 * Remove — is not reported back. One container's notices share a key, so a burst updates one toast.
 */
@Service()
export class ContainerNotifier {
  /**
   * Holds the containers client.
   */
  private readonly client: ContainersClient = inject(ContainersClient);

  /**
   * Holds the notification store.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the tabs, to open the Containers tab for Show Logs.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the Containers tab's terminals, which show a container's logs.
   */
  private readonly terminals: ContainerTerminals = inject(ContainerTerminals);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds whether the notifier has started listening.
   */
  private started: boolean = false;

  /**
   * Holds whether the engine was reachable at the last check, or null before the first.
   */
  private reachable: boolean | null = null;

  /**
   * Holds when each container stopped recently, by identifier, to tell a restart loop.
   */
  private readonly stops: Map<string, number[]> = new Map<string, number[]>();

  /**
   * Holds the containers already reported as restarting over and over in the current window.
   */
  private readonly looping: Set<string> = new Set<string>();

  /**
   * Initializes the notifier: it starts listening once a container engine plugin is installed.
   */
  public constructor() {
    effect((): void => {
      if (this.client.containerEngines().length > 0) {
        untracked((): void => this.start());
      }
    });
  }

  /**
   * Starts listening to the engine's events, its downloads and its reachability.
   */
  private start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.log.info('containers.notifier', 'Listening for container engine events');
    this.client.onEvents((event: ContainerEvent): void => this.onEvent(event));
    this.client.onPullFinished((reference: string, result: { ok: boolean; error?: string }): void =>
      this.onPull(reference, result),
    );
    void this.checkEngine();
    setInterval((): void => void this.checkEngine(), ENGINE_CHECK_MS);
  }

  /**
   * Asks whether the engine is there, holding an event stream while it is and reporting a change.
   * @returns Returns a promise that resolves once the check is done.
   */
  private async checkEngine(): Promise<void> {
    const available: boolean = (await this.client.status()).available;
    const before: boolean | null = this.reachable;
    this.reachable = available;
    if (available && before !== true) {
      void this.client.watchStart();
    } else if (!available && before === true) {
      void this.client.watchStop();
    }
    // The first check finds the engine as it is; only a change after that is news.
    if (before === null || before === available) {
      return;
    }
    this.notify({
      severity: available ? 'success' : 'warning',
      title: available ? 'The container engine is running again' : 'The container engine stopped',
      key: 'containers:engine',
      type: ContainerNotificationType.Engine,
    });
  }

  /**
   * Handles one engine event.
   * @param event The event.
   */
  private onEvent(event: ContainerEvent): void {
    if (event.type !== 'container' || event.id.length === 0) {
      return;
    }
    if (event.action === 'oom') {
      this.notify({
        severity: 'error',
        title: `${this.nameOf(event)} ran out of memory`,
        detail: this.detailOf(event),
        actions: [this.showLogs(event)],
        key: `container:${event.id}`,
        type: ContainerNotificationType.OutOfMemory,
        desktop: true,
      });
    } else if (event.action.startsWith('health_status') && event.action.endsWith('unhealthy')) {
      this.notify({
        severity: 'warning',
        title: `${this.nameOf(event)} is unhealthy`,
        detail: this.detailOf(event),
        actions: [this.showLogs(event)],
        key: `container:${event.id}`,
        type: ContainerNotificationType.Unhealthy,
      });
    } else if (event.action === 'die') {
      this.onStopped(event);
    }
  }

  /**
   * Handles a container stopping: nothing when Studio stopped it; a restart loop once it has stopped
   * {@link RESTART_LIMIT} times within the window; otherwise how it exited.
   * @param event The `die` event.
   */
  private onStopped(event: ContainerEvent): void {
    if (this.client.actedOnRecently(event.id)) {
      return;
    }
    const now: number = Date.now();
    const recent: number[] = (this.stops.get(event.id) ?? []).filter(
      (at: number): boolean => now - at <= RESTART_WINDOW_MS,
    );
    recent.push(now);
    this.stops.set(event.id, recent);
    if (recent.length < RESTART_LIMIT) {
      this.looping.delete(event.id);
    }
    if (recent.length >= RESTART_LIMIT) {
      if (!this.looping.has(event.id)) {
        this.looping.add(event.id);
        this.notify({
          severity: 'error',
          title: `${this.nameOf(event)} keeps restarting`,
          detail:
            `It stopped ${recent.length} times in two minutes. ${this.detailOf(event) ?? ''}`.trim(),
          actions: [this.showLogs(event)],
          key: `container:${event.id}`,
          type: ContainerNotificationType.Restarting,
          desktop: true,
        });
      }
      return;
    }
    const code: number | undefined = event.exitCode;
    if (code === 0) {
      this.notify({
        severity: 'success',
        title: `${this.nameOf(event)} finished`,
        detail: this.detailOf(event),
        actions: [this.showLogs(event)],
        key: `container:${event.id}`,
        type: ContainerNotificationType.Finished,
      });
      return;
    }
    this.notify({
      severity: 'error',
      title:
        code === undefined
          ? `${this.nameOf(event)} exited`
          : `${this.nameOf(event)} exited (code ${code})`,
      detail: this.detailOf(event),
      actions: [this.showLogs(event), this.restart(event)],
      key: `container:${event.id}`,
      type: ContainerNotificationType.Exited,
      desktop: true,
    });
  }

  /**
   * Handles an image download started from Studio finishing.
   * @param reference The image reference.
   * @param result How the download ended.
   */
  private onPull(reference: string, result: { ok: boolean; error?: string }): void {
    this.notify(
      result.ok
        ? {
            severity: 'success',
            title: `Downloaded ${reference}`,
            key: `containers:pull:${reference}`,
            type: ContainerNotificationType.PullFinished,
          }
        : {
            severity: 'error',
            title: `Couldn't download ${reference}`,
            ...(result.error === undefined ? {} : { detail: result.error }),
            key: `containers:pull:${reference}`,
            type: ContainerNotificationType.PullFailed,
          },
    );
  }

  /**
   * Raises a notification.
   * @param request The notification.
   */
  private notify(request: NotificationRequest): void {
    this.notifications.notify(request);
  }

  /**
   * Names a container for a notification: its name when the engine gave one, else its short id.
   * @param event The event.
   * @returns Returns the name.
   */
  private nameOf(event: ContainerEvent): string {
    return event.name ?? event.id.slice(0, 12);
  }

  /**
   * Describes where a container comes from: its Compose project and image, when known.
   * @param event The event.
   * @returns Returns the detail, or undefined when nothing is known.
   */
  private detailOf(event: ContainerEvent): string | undefined {
    const parts: string[] = [
      ...(event.project === undefined ? [] : [event.project]),
      ...(event.image === undefined ? [] : [event.image]),
    ];
    return parts.length === 0 ? undefined : parts.join(' · ');
  }

  /**
   * Builds the Show Logs action: the Containers tab, with the container's logs open.
   * @param event The event.
   * @returns Returns the action.
   */
  private showLogs(event: ContainerEvent): NotificationAction {
    return {
      label: 'Show Logs',
      run: (): void => {
        this.tabs.open('containers');
        this.terminals.openLogs(`Logs: ${this.nameOf(event)}`, event.id);
      },
    };
  }

  /**
   * Builds the Restart action.
   * @param event The event.
   * @returns Returns the action.
   */
  private restart(event: ContainerEvent): NotificationAction {
    return { label: 'Restart', run: (): void => void this.client.restart(event.id) };
  }
}
