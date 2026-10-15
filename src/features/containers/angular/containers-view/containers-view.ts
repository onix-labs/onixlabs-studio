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
  OnInit,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { ContainerLogsPane } from '../container-logs/container-logs';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { CategoryItem, CategoryList } from '@shared/angular/components/category-list/category-list';
import { Button } from '@shared/angular/components/forms/button/button';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { PanelEdge } from '@shared/angular/components/panel-layout/panel-types';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { Log } from '@shared/angular/services/log/log';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';
import { Icon } from '@shared/angular/icons/icon';
import { ContainerSummary, ImageSummary } from '@shared/api/container-types';
import { PluginSummary } from '@shared/api/plugin-channels';
import { ContainerEnginePrompt } from '@shared/angular/services/plugins/container-engine-prompt';
import { ContainerTerminals } from '../container-terminals/container-terminals';
import {
  ContainersCommandHandler,
  ContainersCommands,
} from '../containers-commands/containers-commands';
import { ContainersStatus } from '../containers-status/containers-status';
import { ContainersClient } from '../client/containers-client';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';

/**
 * What the Containers tab's status strip reports.
 */
export interface ContainersSummary {
  /**
   * Gets the engine in effect's name, or null when none is installed.
   */
  readonly engine: string | null;

  /**
   * Gets whether the engine answers: null while first loading.
   */
  readonly available: boolean | null;

  /**
   * Gets how many containers the engine holds, running or not.
   */
  readonly containers: number;

  /**
   * Gets how many images the engine holds.
   */
  readonly images: number;
}

/**
 * The kinds of thing the side panel chooses between.
 */
export type ContainersKind = 'containers' | 'images';

/**
 * An image as the Images table lists it: the image, and how many containers run it.
 */
export interface ImageEntry {
  /**
   * Gets the image.
   */
  readonly image: ImageSummary;

  /**
   * Gets how many containers run the image.
   */
  readonly usedBy: number;
}

/**
 * The Containers table's columns: the state dot, the name, the image it runs, the engine's status
 * text, and the row's actions.
 */
const CONTAINER_COLUMNS: readonly TableColumn[] = [
  { id: 'state', header: '', width: '2.25rem' },
  { id: 'name', header: 'Name' },
  { id: 'image', header: 'Image' },
  { id: 'status', header: 'Status', width: '14rem' },
  { id: 'actions', header: '', width: '9rem', align: 'end' },
];

/**
 * The Images table's columns.
 */
const IMAGE_COLUMNS: readonly TableColumn[] = [
  { id: 'tag', header: 'Image' },
  { id: 'size', header: 'Size', width: '8rem', align: 'end' },
  { id: 'used', header: 'Containers', width: '8rem', align: 'end' },
];

/**
 * The row menu's actions.
 */
const MENU_LOGS: string = 'logs';
const MENU_SHELL: string = 'shell';

/**
 * The Containers tab: a thin dashboard over the containers backend contribution (#391). It lists
 * containers and images, starts/stops/removes a container, and stays live via the backend's event
 * push — so a `docker start` from the CLI reflects here without polling. When the engine is
 * unreachable it names the engine in effect in an empty state rather than showing an error.
 *
 * Nothing it says is written for one engine (#455): the copy names whichever engine is in effect, and
 * the empty state offers the command that starts it. Studio does not start an engine itself — it used
 * to launch Docker Desktop, the one engine it could, and that went when engines became plugins (#596).
 */
@Component({
  selector: 'app-containers-view',
  imports: [
    Button,
    ButtonRow,
    AppIcon,
    CategoryList,
    CdkMenuTrigger,
    Chip,
    Menu,
    PanelLayout,
    Panel,
    Table,
    TableRowDef,
    Terminal,
    Toggle,
    ToolPanel,
    TooltipTrigger,
    ContainerLogsPane,
  ],
  templateUrl: './containers-view.html',
  styleUrl: './containers-view.scss',
  providers: [ContainerTerminals],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainersView implements OnInit, OnDestroy {
  /**
   * What the engine is called before the main process has said which one is in effect. Only reachable
   * outside Electron and in the moment before the engine list arrives, but the copy has to read as a
   * sentence either way.
   */
  private static readonly UNKNOWN_ENGINE: string = 'container engine';

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
   * Holds the containers client the view reads and acts through.
   */
  private readonly client: ContainersClient = inject(ContainersClient);

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
   * Holds the offer to install a container engine, raised when the tab finds none installed.
   */
  private readonly enginePrompt: ContainerEnginePrompt = inject(ContainerEnginePrompt);

  /**
   * Gets the edges the terminal panel may dock to — the bottom by default, or a side.
   */
  protected readonly terminalEdges: readonly PanelEdge[] = ['bottom', 'right', 'left'];

  /**
   * Gets the edges the side panel may sit on: only its own, since it is part of the view.
   */
  protected readonly sideEdges: readonly PanelEdge[] = ['left'];

  /**
   * Gets the Containers table's columns.
   */
  protected readonly containerColumns: readonly TableColumn[] = CONTAINER_COLUMNS;

  /**
   * Gets the Images table's columns.
   */
  protected readonly imageColumns: readonly TableColumn[] = IMAGE_COLUMNS;

  /**
   * Holds the kind the side panel has chosen. Containers are shown to begin with.
   */
  protected readonly kind: WritableSignal<ContainersKind> = signal<ContainersKind>('containers');

  /**
   * Holds the side panel's search text, which narrows whichever list is shown.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether only running containers are listed.
   */
  protected readonly runningOnly: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the image selected in the Images list, such as the one a container's image link showed.
   */
  protected readonly selectedImageId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the container whose ⋮ button opened the shared row menu.
   */
  protected readonly menuTarget: WritableSignal<ContainerSummary | null> =
    signal<ContainerSummary | null>(null);

  /**
   * Holds whether the user closed the Terminals panel. Opening another session shows it again.
   */
  protected readonly terminalsHidden: WritableSignal<boolean> = signal<boolean>(false);

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
   * Gets the side panel's entries: Containers and Images, each with how many the engine holds.
   */
  protected readonly kindItems: Signal<readonly CategoryItem[]> = computed(
    (): readonly CategoryItem[] => [
      {
        id: 'containers',
        label: 'Containers',
        icon: Icon.CONTAINERS,
        count: this.containers().length,
      },
      {
        id: 'images',
        label: 'Images',
        icon: Icon.CONTAINER_IMAGES,
        count: this.images().length,
      },
    ],
  );

  /**
   * Gets the Containers table's rows: the containers the running-only switch and the search leave.
   */
  protected readonly containerRows: Signal<readonly TableRow[]> = computed(
    (): readonly TableRow[] => {
      const text: string = this.query().trim().toLowerCase();
      return this.containers()
        .filter(
          (container: ContainerSummary): boolean =>
            (!this.runningOnly() || this.isRunning(container)) &&
            (text.length === 0 ||
              this.displayName(container).toLowerCase().includes(text) ||
              container.image.toLowerCase().includes(text)),
        )
        .map((container: ContainerSummary): TableRow => ({ id: container.id, data: container }));
    },
  );

  /**
   * Gets the Images table's rows: the images the search leaves, each with how many containers run it.
   */
  protected readonly imageRows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] => {
    const text: string = this.query().trim().toLowerCase();
    return this.images()
      .filter(
        (image: ImageSummary): boolean =>
          text.length === 0 || this.displayTag(image).toLowerCase().includes(text),
      )
      .map((image: ImageSummary): TableRow => ({
        id: image.id,
        data: {
          image,
          usedBy: this.containers().filter((container: ContainerSummary): boolean =>
            runsImage(container, image),
          ).length,
        } satisfies ImageEntry,
      }));
  });

  /**
   * Gets the heading, which names the list shown.
   */
  protected readonly heading: Signal<string> = computed((): string =>
    this.kind() === 'containers' ? 'Containers' : 'Images',
  );

  /**
   * Gets the sentence under the heading: how many containers there are and how many run, or how many
   * images there are and the disk they take.
   */
  protected readonly subtitle: Signal<string> = computed((): string => {
    if (this.kind() === 'containers') {
      const total: number = this.containers().length;
      const running: number = this.containers().filter((container: ContainerSummary): boolean =>
        this.isRunning(container),
      ).length;
      return `${total} ${total === 1 ? 'container' : 'containers'}, ${running} running.`;
    }
    const total: number = this.images().length;
    const bytes: number = this.images().reduce(
      (sum: number, image: ImageSummary): number => sum + image.size,
      0,
    );
    return `${total} ${total === 1 ? 'image' : 'images'}, ${this.formatSize(bytes)} on disk.`;
  });

  /**
   * Gets the selected container's row id, as the table takes it.
   */
  protected readonly selectedContainerIds: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> => {
      const id: string | null = this.selectedId();
      return new Set<string>(id === null ? [] : [id]);
    },
  );

  /**
   * Gets the selected image's row id, as the table takes it.
   */
  protected readonly selectedImageIds: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> => {
      const id: string | null = this.selectedImageId();
      return new Set<string>(id === null ? [] : [id]);
    },
  );

  /**
   * Gets the row menu's items for the container that opened it: its logs, and a shell while it runs.
   */
  protected readonly rowMenuItems: Signal<readonly MenuItem[]> = computed(
    (): readonly MenuItem[] => {
      const target: ContainerSummary | null = this.menuTarget();
      return [
        { id: MENU_LOGS, label: 'View Logs', icon: Icon.ARTICLE },
        // A shell needs the engine's own CLI on this machine, which Studio no longer downloads (#973).
        ...(this.client.engineCli() === null
          ? []
          : [
              {
                id: MENU_SHELL,
                label: 'Open Shell',
                icon: Icon.TERMINAL,
                disabled: target === null || !this.isRunning(target),
              },
            ]),
      ];
    },
  );

  /**
   * Gets the engine in effect's name as it reads inside a sentence ("Start Podman to…").
   */
  protected readonly engineLabel: Signal<string> = computed(
    (): string =>
      this.client.engineInEffect()?.displayName ?? `the ${ContainersView.UNKNOWN_ENGINE}`,
  );

  /**
   * Gets the engine in effect's name as it reads at the start of a sentence ("Podman isn't running").
   */
  protected readonly engineTitle: Signal<string> = computed(
    (): string =>
      this.client.engineInEffect()?.displayName ?? `The ${ContainersView.UNKNOWN_ENGINE}`,
  );

  /**
   * Gets what the tab's status strip reports (#882): the engine, whether it answers, and how many
   * containers and images it holds. Read by the strip through the injector this view publishes.
   */
  public readonly summary: Signal<ContainersSummary> = computed((): ContainersSummary => ({
    engine: this.noEngineInstalled() ? null : (this.client.engineInEffect()?.displayName ?? null),
    available: this.available(),
    containers: this.containers().length,
    images: this.images().length,
  }));

  /**
   * Publishes this view's injector while it is active, so the status strip mounts the tab's status
   * (#882) inside it.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Gets whether no container engine is installed at all, as opposed to one being installed and not
   * running (#595).
   *
   * The two look identical from the outside — an empty dashboard — and need opposite things said about
   * them: one is fixed by starting something, the other by installing something. The engine list is
   * empty only in the first case, because an engine that is installed is described whether or not its
   * socket answers.
   */
  protected readonly noEngineInstalled: Signal<boolean> = computed(
    (): boolean => this.client.containerEngines().length === 0,
  );

  /**
   * Gets the plugin the empty state offers to install, or null when none is available.
   */
  protected readonly engineCandidate: Signal<PluginSummary | null> = computed(
    (): PluginSummary | null => this.enginePrompt.candidates()[0] ?? null,
  );

  /**
   * Gets the command the user runs to start the engine themselves, or null when there is none to offer.
   * Shown in place of a launch button for an engine the application cannot start.
   */
  protected readonly engineStartCommand: Signal<string | null> = computed(
    (): string | null => this.client.engineInEffect()?.startCommand ?? null,
  );

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

    // A hidden view's per-event reload paid two IPC round-trips for a table nobody could see; the
    // event marks it stale instead, and reactivation reloads once.
    const unsubscribe: () => void = this.client.onEvents((): void => {
      if (this.isActive()) {
        void this.load();
      } else {
        this.staleWhileHidden = true;
      }
    });
    inject(DestroyRef).onDestroy(unsubscribe);

    effect((): void => {
      if (this.isActive()) {
        this.commands.register(this.commandHandler);
        if (this.staleWhileHidden) {
          this.staleWhileHidden = false;
          untracked((): void => void this.load());
        }
      } else {
        this.commands.unregister(this.commandHandler);
      }
    });
  }

  /**
   * Holds whether engine events arrived while the tab was hidden, so reactivation reloads once.
   */
  private staleWhileHidden: boolean = false;

  /**
   * Deregisters the ribbon handler and stops any readiness poll when the tab closes.
   */
  /**
   * Publishes this view's injector to the status strip, now that the tab id is readable.
   */
  public ngOnInit(): void {
    this.statusHost.register(this.tabId());
  }

  public ngOnDestroy(): void {
    this.log.info('containers.view', 'Containers view destroyed');
    this.commands.unregister(this.commandHandler);
  }

  /**
   * Shows a kind chosen in the side panel.
   * @param kind The kind's id.
   */
  protected showKind(kind: string): void {
    this.kind.set(kind as ContainersKind);
  }

  /**
   * Shows a container's image in the Images list, selected.
   * @param container The container whose image to show.
   */
  protected showImage(container: ContainerSummary): void {
    const image: ImageSummary | undefined = this.images().find((candidate: ImageSummary): boolean =>
      runsImage(container, candidate),
    );
    this.selectedImageId.set(image?.id ?? null);
    this.query.set('');
    this.kind.set('images');
  }

  /**
   * Reads a Containers table row's container.
   * @param row The row.
   * @returns Returns the container.
   */
  protected containerOf(row: TableRow): ContainerSummary {
    return row.data as ContainerSummary;
  }

  /**
   * Reads an Images table row's entry.
   * @param row The row.
   * @returns Returns the image and how many containers run it.
   */
  protected imageOf(row: TableRow): ImageEntry {
    return row.data as ImageEntry;
  }

  /**
   * Hides the Terminals panel, keeping its sessions; the next session opened shows it again.
   */
  protected hideTerminals(): void {
    this.terminalsHidden.set(true);
  }

  /**
   * Runs the row menu's choice on the container that opened it.
   * @param id The chosen item's id.
   */
  protected onRowMenu(id: string): void {
    const target: ContainerSummary | null = this.menuTarget();
    if (target === null) {
      return;
    }
    if (id === MENU_LOGS) {
      this.viewLogs(target);
    } else if (id === MENU_SHELL) {
      this.openShell(target);
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
    void this.actOn(id, (target: string): Promise<boolean> => this.client.start(target));
  }

  /**
   * Stops a container.
   * @param id The container id.
   */
  protected stop(id: string): void {
    void this.actOn(id, (target: string): Promise<boolean> => this.client.stop(target));
  }

  /**
   * Removes a container.
   * @param id The container id.
   */
  protected remove(id: string): void {
    void this.actOn(id, (target: string): Promise<boolean> => this.client.remove(target));
  }

  /**
   * Shows a container's logs in the bottom panel, read through the engine's plugin and following the
   * container as it writes (#973) — no terminal and no engine CLI needed.
   * @param container The container to show.
   */
  protected viewLogs(container: ContainerSummary): void {
    this.log.info('containers.view', 'View logs', this.displayName(container), container.id);
    this.terminalsHidden.set(false);
    this.terminals.openLogs(`Logs: ${this.displayName(container)}`, container.id);
  }

  /**
   * Opens an interactive shell in a running container (`<engine> exec`, bash when present, else sh).
   * @param container The container to open a shell in.
   */
  protected openShell(container: ContainerSummary): void {
    const cli: string | null = this.client.engineCli();
    if (cli === null) {
      // Not offered without the engine's CLI on this machine (#973); reached only from a stale menu.
      return;
    }
    this.log.info('containers.view', 'Open shell', this.displayName(container), container.id);
    this.terminalsHidden.set(false);
    this.terminals.open(
      `${this.displayName(container)} — shell`,
      `"${cli}" exec -it ${container.id} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`,
    );
  }

  /**
   * Reloads the container and image lists.
   */
  protected refresh(): void {
    void this.load();
  }

  /**
   * Installs the container engine the empty state offers, then reloads so the dashboard fills in
   * without the user going looking for a refresh.
   */
  protected async installEngine(): Promise<void> {
    await this.enginePrompt.installFirstCandidate();
    await this.client.refreshEngines();
    await this.load();
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
   * Tones a container's status chip by its state: running is success, paused or restarting a warning,
   * a dead container danger, and a stopped one neutral.
   * @param container The container.
   * @returns Returns the tone.
   */
  protected statusTone(container: ContainerSummary): ChipTone {
    switch (container.state) {
      case 'running':
        return 'success';
      case 'paused':
      case 'restarting':
        return 'warning';
      case 'dead':
        return 'danger';
      default:
        return 'neutral';
    }
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
   * Reads the daemon status and, when reachable, the container and image lists, dropping a selection
   * that no longer exists.
   * @returns Returns a promise that resolves once the snapshot has loaded.
   */
  private async load(): Promise<void> {
    this.log.trace('containers.view', 'Loading daemon snapshot');
    // Awaited before anything is decided: an empty engine list means "not known yet" until the main
    // process has answered once, and only then means "no engine is installed".
    await this.client.ready();
    const available: boolean = (await this.client.status()).available;
    this.available.set(available);
    if (!available) {
      this.containers.set([]);
      this.images.set([]);
      if (this.noEngineInstalled()) {
        // Offered here rather than on construction, so the offer follows the discovery that there is
        // nothing to talk to rather than the mere existence of the tab.
        this.enginePrompt.offer();
      }
      return;
    }
    const [containers, images]: [ContainerSummary[], ImageSummary[]] = await Promise.all([
      this.client.listContainers(),
      this.client.listImages(),
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

/**
 * Gets whether a container runs an image: its image reference names one of the image's tags, or the
 * image's own id.
 * @param container The container.
 * @param image The image.
 * @returns Returns true when it does.
 */
function runsImage(container: ContainerSummary, image: ImageSummary): boolean {
  const reference: string = container.image;
  return (
    image.tags.includes(reference) ||
    image.tags.includes(`${reference}:latest`) ||
    image.id === reference ||
    (reference.length > 0 &&
      image.id.replace(/^sha256:/, '').startsWith(reference.replace(/^sha256:/, '')))
  );
}
