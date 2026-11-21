import {
  computed,
  inject,
  OnDestroy,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  LiveServerAvailability,
  LiveServerChannel,
  LiveServerInfo,
  LiveServerOpenAnswer,
} from '@shared/api/live-server-channels';
import { PluginChannel } from '@shared/api/plugin-channels';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Shell } from '@shared/angular/services/shell/shell';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * Matches the files Open with Live Server is offered on: pages, which are what a browser shows.
 */
const PAGE_PATTERN: RegExp = /\.html?$/i;

/**
 * This tab's live server (#1062): whether one can be offered, the one serving this workspace, and the
 * commands the explorers and the status chip run against it.
 *
 * ⛔ Core UI only: serving belongs to the live-server plugin, behind the main process's host. This asks
 * for a page to be served, opens its address in the browser, and stops the server when the workspace
 * closes — one server per workspace, so a second page reuses it.
 *
 * Provided per workspace view, beside the {@link Workspace} whose root it serves.
 */
@Service()
export class LiveServerSession implements OnDestroy {
  /**
   * Holds this tab's workspace, whose root is the folder served.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the shell client the address is opened through, in the browser the user chose.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the notification store a failure is reported to.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the generic transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds whether a live server can be offered.
   */
  private readonly availabilitySignal: WritableSignal<LiveServerAvailability> =
    signal<LiveServerAvailability>('none');

  /**
   * Holds every running server, in every workspace, as the main process last said.
   */
  private readonly serversSignal: WritableSignal<readonly LiveServerInfo[]> = signal<
    readonly LiveServerInfo[]
  >([]);

  /**
   * Holds the unsubscribes of the main process's pushes.
   */
  private readonly unsubscribes: (() => void)[] = [];

  /**
   * Gets the server serving this workspace, or null when none is running.
   */
  public readonly server: Signal<LiveServerInfo | null> = computed((): LiveServerInfo | null => {
    const root: string | undefined = this.workspace.root()?.path;
    return (
      this.serversSignal().find((server: LiveServerInfo): boolean => server.root === root) ?? null
    );
  });

  /**
   * Gets whether Open with Live Server is offered: a plugin contributes a live server, installed or
   * not — one that is not installed says so when chosen.
   */
  public readonly offered: Signal<boolean> = computed(
    (): boolean => this.availabilitySignal() !== 'none',
  );

  /**
   * Initializes the session, reading what is running and listening for changes.
   */
  public constructor() {
    if (this.bridge === undefined) {
      return;
    }
    this.unsubscribes.push(
      this.bridge.on(LiveServerChannel.Changed, (servers: unknown): void => {
        if (Array.isArray(servers)) {
          this.serversSignal.set(servers.filter(isLiveServerInfo));
        }
      }),
      // An install or removal changes whether there is a live server to offer.
      this.bridge.on(PluginChannel.Changed, (): void => {
        void this.refreshAvailability();
      }),
    );
    void this.refresh();
  }

  /**
   * Determines whether Open with Live Server applies to a file.
   * @param path The file's path.
   * @returns Returns true when it is a page and a live server can be offered.
   */
  public opens(path: string): boolean {
    return this.offered() && PAGE_PATTERN.test(path);
  }

  /**
   * Serves this workspace, starting its server when none runs, and opens a page of it in the browser.
   * @param path The page's absolute path.
   * @returns Returns a promise that resolves once the page has been handed to the browser.
   */
  public async open(path: string): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    this.log.info('workspace.live-server', 'Open with Live Server', path);
    const answer: LiveServerOpenAnswer = await this.bridge.invoke<LiveServerOpenAnswer>(
      LiveServerChannel.Open,
      path,
    );
    if (!answer.ok) {
      this.log.warn('workspace.live-server', 'Could not open with Live Server', answer.error);
      this.notifications.notify({
        severity: 'error',
        title: $localize`:Notification title when a page could not be served by Live Server:Could not open with Live Server`,
        detail: answer.error,
      });
      return;
    }
    this.upsert(answer.server);
    await this.shell.openExternal(answer.pageUrl, 'studio');
  }

  /**
   * Opens this workspace's server's address in the browser again.
   * @returns Returns a promise that resolves once it has been handed to the browser.
   */
  public async openAddress(): Promise<void> {
    const server: LiveServerInfo | null = this.server();
    if (server !== null) {
      await this.shell.openExternal(server.url, 'studio');
    }
  }

  /**
   * Copies this workspace's server's address.
   * @returns Returns a promise that resolves once it is on the clipboard.
   */
  public async copyAddress(): Promise<void> {
    const server: LiveServerInfo | null = this.server();
    if (server === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(server.url);
    } catch (error: unknown) {
      this.log.warn('workspace.live-server', 'Could not copy the address', error);
    }
  }

  /**
   * Stops this workspace's server, freeing its port.
   * @returns Returns a promise that resolves once it has stopped.
   */
  public async stop(): Promise<void> {
    const server: LiveServerInfo | null = this.server();
    if (server === null || this.bridge === undefined) {
      return;
    }
    this.log.info('workspace.live-server', 'Stop Live Server', server.root);
    this.serversSignal.update((servers: readonly LiveServerInfo[]): readonly LiveServerInfo[] =>
      servers.filter((candidate: LiveServerInfo): boolean => candidate.root !== server.root),
    );
    await this.bridge.invoke<void>(LiveServerChannel.Stop, server.root);
  }

  /**
   * Stops this workspace's server as its tab closes. The main process stops it too once the folder
   * closes; this covers a tab closed while the folder stays open elsewhere.
   */
  public ngOnDestroy(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    void this.stop();
  }

  /**
   * Reads what is running and whether a live server can be offered.
   * @returns Returns a promise that resolves once both are read.
   */
  private async refresh(): Promise<void> {
    const before: readonly LiveServerInfo[] = this.serversSignal();
    const [servers]: [readonly LiveServerInfo[], void] = await Promise.all([
      this.bridge?.invoke<readonly LiveServerInfo[]>(LiveServerChannel.List) ?? [],
      this.refreshAvailability(),
    ]);
    // A push or an open that landed while the list was on its way is newer than the list.
    if (Array.isArray(servers) && this.serversSignal() === before) {
      this.serversSignal.set(servers.filter(isLiveServerInfo));
    }
  }

  /**
   * Reads whether a live server can be offered.
   * @returns Returns a promise that resolves once it is read.
   */
  private async refreshAvailability(): Promise<void> {
    const availability: LiveServerAvailability | undefined =
      await this.bridge?.invoke<LiveServerAvailability>(LiveServerChannel.Availability);
    if (availability === 'none' || availability === 'not-installed' || availability === 'ready') {
      this.availabilitySignal.set(availability);
    }
  }

  /**
   * Records a server the main process answered with, ahead of its push.
   * @param server The server.
   */
  private upsert(server: LiveServerInfo): void {
    this.serversSignal.update((servers: readonly LiveServerInfo[]): readonly LiveServerInfo[] => [
      ...servers.filter((candidate: LiveServerInfo): boolean => candidate.root !== server.root),
      server,
    ]);
  }
}

/**
 * Narrows a pushed value to a running server's description.
 * @param value The candidate.
 * @returns Returns true when it is one.
 */
function isLiveServerInfo(value: unknown): value is LiveServerInfo {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  return (
    typeof record['root'] === 'string' &&
    typeof record['url'] === 'string' &&
    typeof record['port'] === 'number' &&
    typeof record['displayName'] === 'string'
  );
}
