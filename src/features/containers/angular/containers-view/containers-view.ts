import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { PanelEdge } from '@shared/angular/components/panel-layout/panel-types';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { ContainerSummary, ImageSummary } from '@shared/api/docker-types';
import { ContainerTerminals } from '../container-terminals/container-terminals';
import {
  ContainersCommandHandler,
  ContainersCommands,
} from '../containers-commands/containers-commands';
import { ContainersStatus } from '../containers-status/containers-status';
import { Docker } from '../docker/docker';

/**
 * The Containers tab: a thin dashboard over the Docker backend contribution (#391). It lists
 * containers and images, starts/stops/removes a container, and stays live via the backend's event
 * push — so a `docker start` from the CLI reflects here without polling. When the daemon is
 * unreachable it shows a "Docker isn't running" empty state rather than an error.
 */
@Component({
  selector: 'app-containers-view',
  imports: [Button, AppIcon, PanelLayout, Panel, Terminal],
  templateUrl: './containers-view.html',
  styleUrl: './containers-view.scss',
  providers: [ContainerTerminals],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainersView implements OnDestroy {
  /**
   * How many times, and how far apart (ms), to poll the daemon for readiness after launching Docker
   * Desktop — roughly a minute, which comfortably covers a cold start.
   */
  private static readonly READINESS_ATTEMPTS: number = 30;
  private static readonly READINESS_INTERVAL_MS: number = 2_000;

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether this tab is the active one, driving command-handler registration.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the Docker client the view reads and acts through.
   */
  private readonly docker: Docker = inject(Docker);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the ribbon command registry the active view registers its handler with.
   */
  private readonly commands: ContainersCommands = inject(ContainersCommands);

  /**
   * Holds the docker logs/shell terminals opened from container rows, hosted in the bottom panel.
   */
  protected readonly terminals: ContainerTerminals = inject(ContainerTerminals);

  /**
   * Gets the edges the terminal panel may dock to — the bottom by default, or a side.
   */
  protected readonly terminalEdges: readonly PanelEdge[] = ['bottom', 'right', 'left'];

  /**
   * Holds whether the daemon is reachable: null while first loading, then true/false.
   */
  protected readonly available: WritableSignal<boolean | null> = signal<boolean | null>(null);

  /**
   * Holds the current container list.
   */
  protected readonly containers: WritableSignal<readonly ContainerSummary[]> = signal<
    readonly ContainerSummary[]
  >([]);

  /**
   * Holds the current image list.
   */
  protected readonly images: WritableSignal<readonly ImageSummary[]> = signal<
    readonly ImageSummary[]
  >([]);

  /**
   * Holds the id of the selected container, or null when none is selected.
   */
  protected readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether an action is in flight, so the controls disable until it settles.
   */
  protected readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether Docker Desktop is being launched and the daemon awaited, so the empty state shows a
   * "starting" affordance instead of the launch button.
   */
  protected readonly launching: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the view has been destroyed, so the readiness poll stops when the tab closes.
   */
  private destroyed: boolean = false;

  /**
   * Gets whether a container is selected.
   */
  private readonly hasSelection: Signal<boolean> = computed(
    (): boolean =>
      this.selectedId() !== null &&
      this.containers().some(
        (container: ContainerSummary): boolean => container.id === this.selectedId(),
      ),
  );

  /**
   * Gets whether the selected container is running.
   */
  private readonly selectionRunning: Signal<boolean> = computed((): boolean => {
    const id: string | null = this.selectedId();
    return this.containers().some(
      (container: ContainerSummary): boolean =>
        container.id === id && container.state === 'running',
    );
  });

  /**
   * Holds the handler the ribbon drives the active view through.
   */
  private readonly commandHandler: ContainersCommandHandler = {
    hasSelection: this.hasSelection,
    selectionRunning: this.selectionRunning,
    start: (): void => this.startSelected(),
    stop: (): void => this.stopSelected(),
    remove: (): void => this.removeSelected(),
    viewLogs: (): void => this.logsSelected(),
    shell: (): void => this.shellSelected(),
    refresh: (): void => void this.load(),
  };

  /**
   * Loads the initial snapshot, subscribes to live engine events, keeps the ribbon handler registered
   * while active, and starts the status-strip running count.
   */
  public constructor() {
    // Instantiating the status contribution starts (and keeps) the running-container count in the
    // shared status strip for the session.
    inject(ContainersStatus);

    this.log.info('containers.view', 'Containers view created');
    void this.load();

    const unsubscribe: () => void = this.docker.onEvents((): void => {
      void this.load();
    });
    inject(DestroyRef).onDestroy(unsubscribe);

    effect((): void => {
      if (this.isActive()) {
        this.commands.register(this.commandHandler);
      } else {
        this.commands.unregister(this.commandHandler);
      }
    });
  }

  /**
   * Deregisters the ribbon handler and stops any readiness poll when the tab closes.
   */
  public ngOnDestroy(): void {
    this.log.info('containers.view', 'Containers view destroyed');
    this.destroyed = true;
    this.commands.unregister(this.commandHandler);
  }

  /**
   * Launches Docker Desktop and then polls the daemon until it comes up (or a timeout), so the
   * dashboard fills in on its own once Docker is ready. A no-op while already launching.
   */
  protected async startDocker(): Promise<void> {
    if (this.launching()) {
      return;
    }
    this.log.info('containers.view', 'Starting Docker and awaiting readiness');
    this.launching.set(true);
    try {
      if (!(await this.docker.launchDesktop())) {
        this.log.warn('containers.view', 'Docker Desktop launch was not issued');
        return;
      }
      for (let attempt: number = 0; attempt < ContainersView.READINESS_ATTEMPTS; attempt += 1) {
        await this.delay(ContainersView.READINESS_INTERVAL_MS);
        if (this.destroyed) {
          return;
        }
        await this.load();
        if (this.available() === true) {
          this.log.info('containers.view', 'Docker became ready', attempt + 1);
          return;
        }
      }
      this.log.warn('containers.view', 'Docker did not become ready before timeout');
    } finally {
      this.launching.set(false);
    }
  }

  /**
   * Selects a container row.
   * @param id The container id.
   */
  protected select(id: string): void {
    this.log.debug('containers.view', 'Selected container', id);
    this.selectedId.set(id);
  }

  /**
   * Starts a container.
   * @param id The container id.
   */
  protected start(id: string): void {
    void this.actOn(id, (target: string): Promise<boolean> => this.docker.start(target));
  }

  /**
   * Stops a container.
   * @param id The container id.
   */
  protected stop(id: string): void {
    void this.actOn(id, (target: string): Promise<boolean> => this.docker.stop(target));
  }

  /**
   * Removes a container.
   * @param id The container id.
   */
  protected remove(id: string): void {
    void this.actOn(id, (target: string): Promise<boolean> => this.docker.remove(target));
  }

  /**
   * Streams a container's logs (`docker logs -f`) in a terminal in the bottom panel.
   * @param container The container to tail.
   */
  protected viewLogs(container: ContainerSummary): void {
    this.log.info('containers.view', 'View logs', this.displayName(container), container.id);
    this.terminals.open(`Logs: ${this.displayName(container)}`, `docker logs -f ${container.id}`);
  }

  /**
   * Opens an interactive shell in a running container (`docker exec`, bash when present, else sh).
   * @param container The container to open a shell in.
   */
  protected openShell(container: ContainerSummary): void {
    this.log.info('containers.view', 'Open shell', this.displayName(container), container.id);
    this.terminals.open(
      `${this.displayName(container)} — shell`,
      `docker exec -it ${container.id} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`,
    );
  }

  /**
   * Reloads the container and image lists.
   */
  protected refresh(): void {
    void this.load();
  }

  /**
   * Determines whether a container is running.
   * @param container The container to test.
   * @returns Returns true when the container's state is `running`.
   */
  protected isRunning(container: ContainerSummary): boolean {
    return container.state === 'running';
  }

  /**
   * Builds the display name for a container: its first name, or a short id when it has none.
   * @param container The container to name.
   * @returns Returns the display name.
   */
  protected displayName(container: ContainerSummary): string {
    return container.names[0] ?? container.id.slice(0, 12);
  }

  /**
   * Builds the display tag for an image: its first repository tag, a short id for a dangling image.
   * @param image The image to label.
   * @returns Returns the display tag.
   */
  protected displayTag(image: ImageSummary): string {
    return image.tags[0] ?? `<none> (${image.id.replace(/^sha256:/, '').slice(0, 12)})`;
  }

  /**
   * Formats a byte count as a human-readable size.
   * @param bytes The size in bytes.
   * @returns Returns the formatted size (for example `12.3 MB`).
   */
  protected formatSize(bytes: number): string {
    const units: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size: number = bytes;
    let unit: number = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
  }

  /**
   * Starts the selected container (ribbon action).
   */
  private startSelected(): void {
    const id: string | null = this.selectedId();
    if (id !== null) {
      this.start(id);
    }
  }

  /**
   * Stops the selected container (ribbon action).
   */
  private stopSelected(): void {
    const id: string | null = this.selectedId();
    if (id !== null) {
      this.stop(id);
    }
  }

  /**
   * Removes the selected container (ribbon action).
   */
  private removeSelected(): void {
    const id: string | null = this.selectedId();
    if (id !== null) {
      this.remove(id);
    }
  }

  /**
   * Streams the selected container's logs (ribbon action).
   */
  private logsSelected(): void {
    const container: ContainerSummary | undefined = this.selectedContainer();
    if (container !== undefined) {
      this.viewLogs(container);
    }
  }

  /**
   * Opens a shell in the selected running container (ribbon action).
   */
  private shellSelected(): void {
    const container: ContainerSummary | undefined = this.selectedContainer();
    if (container !== undefined && this.isRunning(container)) {
      this.openShell(container);
    }
  }

  /**
   * Gets the currently-selected container, or undefined when none is selected.
   * @returns Returns the selected container, or undefined.
   */
  private selectedContainer(): ContainerSummary | undefined {
    const id: string | null = this.selectedId();
    return id === null
      ? undefined
      : this.containers().find((container: ContainerSummary): boolean => container.id === id);
  }

  /**
   * Runs one container action against the daemon, then reloads. Ignored while another action is in
   * flight.
   * @param id The container id.
   * @param action The daemon call to make.
   * @returns Returns a promise that resolves once the action and reload settle.
   */
  private async actOn(id: string, action: (id: string) => Promise<boolean>): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.log.trace('containers.view', 'Running container action', id);
    this.busy.set(true);
    try {
      const accepted: boolean = await action(id);
      this.log.debug('containers.view', 'Container action settled', id, accepted);
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Resolves after the given delay.
   * @param ms The delay in milliseconds.
   * @returns Returns a promise that resolves once the delay elapses.
   */
  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Reads the daemon status and, when reachable, the container and image lists, dropping a selection
   * that no longer exists.
   * @returns Returns a promise that resolves once the snapshot has loaded.
   */
  private async load(): Promise<void> {
    this.log.trace('containers.view', 'Loading daemon snapshot');
    const available: boolean = (await this.docker.status()).available;
    this.available.set(available);
    if (!available) {
      this.containers.set([]);
      this.images.set([]);
      return;
    }
    const [containers, images]: [ContainerSummary[], ImageSummary[]] = await Promise.all([
      this.docker.listContainers(),
      this.docker.listImages(),
    ]);
    this.log.debug('containers.view', 'Loaded snapshot', containers.length, images.length);
    this.containers.set(containers);
    this.images.set(images);
    const id: string | null = this.selectedId();
    if (
      id !== null &&
      !containers.some((container: ContainerSummary): boolean => container.id === id)
    ) {
      this.selectedId.set(null);
    }
  }
}
