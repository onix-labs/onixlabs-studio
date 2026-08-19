import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { CatalogModel, CatalogResult } from '@shared/api/model-catalog-types';
import {
  LocalModel,
  ModelDiskUsage,
  ModelPullProgress,
  ModelRuntimeInfo,
  ModelRuntimeStatus,
  RunningModel,
  RuntimeInstallation,
  RuntimeInstallProgress,
} from '@shared/api/model-runtime-types';
import { ModelConnections } from '../model-connections/model-connections';
import {
  ModelManagerCommandHandler,
  ModelManagerCommands,
} from '../model-manager-commands/model-manager-commands';
import { ModelRuntimes } from '../model-runtime/model-runtimes';

/**
 * The installed-models table's columns.
 */
const INSTALLED_COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Model' },
  { id: 'parameters', header: 'Parameters', width: '9rem' },
  { id: 'quantization', header: 'Quantisation', width: '9rem' },
  { id: 'size', header: 'Size', width: '8rem', align: 'end' },
  { id: 'modified', header: 'Modified', width: '11rem' },
  { id: 'actions', header: '', width: '4rem', align: 'end' },
];

/**
 * The running-models table's columns.
 */
const RUNNING_COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Model' },
  { id: 'processor', header: 'Processor', width: '10rem' },
  { id: 'size', header: 'Size', width: '8rem', align: 'end' },
  { id: 'expires', header: 'Unloads', width: '11rem' },
];

/**
 * The available-models table's columns.
 */
const AVAILABLE_COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Model' },
  { id: 'source', header: 'Source', width: '8rem' },
  { id: 'parameters', header: 'Parameters', width: '8rem' },
  { id: 'size', header: 'Size', width: '8rem', align: 'end' },
  { id: 'actions', header: '', width: '12rem', align: 'end' },
];

/**
 * How long, in milliseconds, to wait after the last keystroke before searching the catalogue. Long
 * enough that typing a model name is one query rather than a dozen.
 */
const SEARCH_DEBOUNCE_MS: number = 300;

/**
 * The AI Model Manager tab: the local model lifecycle in one place.
 *
 * It owns the *runtime and the weights* — whether the runtime is installed, whether its server is up,
 * which models are on disk, and which are loaded into memory. It deliberately does not own endpoint
 * configuration: once a model is here and the server is up, the user connects to it under
 * Settings > AI > Providers, which is where connections live (#254).
 *
 * The runtime is reached through {@link ModelRuntimes}, so nothing here names Ollama; a second runtime
 * implementation would surface through this same view.
 */
@Component({
  selector: 'app-model-manager-view',
  imports: [Button, TextField, AppIcon, Table, TableRowDef],
  templateUrl: './model-manager-view.html',
  styleUrl: './model-manager-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelManagerView {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the installed-models table's columns.
   */
  protected readonly installedColumns: readonly TableColumn[] = INSTALLED_COLUMNS;

  /**
   * Gets the running-models table's columns.
   */
  protected readonly runningColumns: readonly TableColumn[] = RUNNING_COLUMNS;

  /**
   * Gets the available-models table's columns.
   */
  protected readonly availableColumns: readonly TableColumn[] = AVAILABLE_COLUMNS;

  /**
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether this tab is the active one.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the runtime client the view reads and controls through.
   */
  private readonly runtimes: ModelRuntimes = inject(ModelRuntimes);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the command registry the ribbon drives this view through while active.
   */
  private readonly commands: ModelManagerCommands = inject(ModelManagerCommands);

  /**
   * Holds the link that keeps the local Ollama connections in step with what is installed, so a pulled
   * model reaches the agent picker without a detour through Settings.
   */
  private readonly links: ModelConnections = inject(ModelConnections);

  /**
   * Holds the runtime's identity, so the view names whatever runtime is behind the slot rather than
   * assuming Ollama. Falls back to a neutral label until the backend answers.
   */
  protected readonly runtimeName: WritableSignal<string> = signal<string>('Model runtime');

  /**
   * Holds the runtime's server status, or null before the first reading.
   */
  protected readonly status: WritableSignal<ModelRuntimeStatus | null> =
    signal<ModelRuntimeStatus | null>(null);

  /**
   * Holds where the runtime's binary is, or null before the first reading.
   */
  protected readonly installation: WritableSignal<RuntimeInstallation | null> =
    signal<RuntimeInstallation | null>(null);

  /**
   * Holds the models installed locally.
   */
  protected readonly installed: WritableSignal<readonly LocalModel[]> = signal<
    readonly LocalModel[]
  >([]);

  /**
   * Holds the models currently loaded into memory.
   */
  protected readonly running: WritableSignal<readonly RunningModel[]> = signal<
    readonly RunningModel[]
  >([]);

  /**
   * Holds the model store's disk usage.
   */
  protected readonly disk: WritableSignal<ModelDiskUsage | null> = signal<ModelDiskUsage | null>(
    null,
  );

  /**
   * Holds the in-flight managed install's progress, or null when none is running.
   */
  protected readonly installProgress: WritableSignal<RuntimeInstallProgress | null> =
    signal<RuntimeInstallProgress | null>(null);

  /**
   * Holds whether a start, stop, install or remove is in flight, so the controls disable rather than
   * letting the user queue conflicting operations.
   */
  protected readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the catalogue's current results.
   */
  protected readonly available: WritableSignal<readonly CatalogModel[]> = signal<
    readonly CatalogModel[]
  >([]);

  /**
   * Holds the ids of catalogue sources that failed the last search, so the view can say the list is
   * partial rather than silently showing fewer results.
   */
  protected readonly catalogFailures: WritableSignal<readonly string[]> = signal<readonly string[]>(
    [],
  );

  /**
   * Holds the catalogue search text.
   */
  protected readonly searchText: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether a catalogue search is in flight.
   */
  protected readonly searching: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the in-flight pulls' progress, keyed by model reference. Several models can be pulled at
   * once, so this is a map rather than a single value.
   */
  protected readonly pulls: WritableSignal<ReadonlyMap<string, ModelPullProgress>> = signal<
    ReadonlyMap<string, ModelPullProgress>
  >(new Map<string, ModelPullProgress>());

  /**
   * The pending debounce timer for the catalogue search.
   */
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Gets whether the runtime's server is reachable.
   */
  protected readonly isRunning: Signal<boolean> = computed(
    (): boolean => this.status()?.available === true,
  );

  /**
   * Gets the references of the models already installed, so the catalogue can mark them rather than
   * offering to install something that is already there.
   */
  protected readonly installedRefs: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> =>
      new Set<string>(this.installed().map((model: LocalModel): string => model.name)),
  );

  /**
   * Gets the available models adapted to the table's row shape.
   */
  protected readonly availableRows: Signal<readonly TableRow[]> = computed(
    (): readonly TableRow[] =>
      this.available().map((model: CatalogModel): TableRow => ({ id: model.ref, data: model })),
  );

  /**
   * Gets whether the reachable server is the one Studio started, and so may be stopped. A server the
   * user runs themselves is left alone — the control is disabled rather than silently doing nothing.
   */
  protected readonly isStoppable: Signal<boolean> = computed(
    (): boolean => this.status()?.startedByStudio === true,
  );

  /**
   * Gets whether the runtime binary is missing, so the view offers to install it.
   */
  protected readonly needsInstall: Signal<boolean> = computed(
    (): boolean => this.installation()?.kind === 'absent',
  );

  /**
   * Gets the human-readable description of where the runtime came from, for the status line.
   */
  protected readonly installLabel: Signal<string> = computed((): string => {
    const installation: RuntimeInstallation | null = this.installation();
    if (installation === null) {
      return '';
    }
    switch (installation.kind) {
      case 'system':
        return `Installed on this machine${installation.version === '' ? '' : ` · ${installation.version}`}`;
      case 'managed':
        return `Managed by Studio${installation.version === '' ? '' : ` · ${installation.version}`}`;
      default:
        return 'Not installed';
    }
  });

  /**
   * Gets the install progress as a percentage, or null when the total is unknown (so the bar shows an
   * indeterminate state rather than a wrong number).
   */
  protected readonly installPercent: Signal<number | null> = computed((): number | null => {
    const progress: RuntimeInstallProgress | null = this.installProgress();
    if (progress === null || progress.total <= 0) {
      return null;
    }
    return Math.min(100, Math.round((progress.received / progress.total) * 100));
  });

  /**
   * Gets the installed models adapted to the table's row shape.
   */
  protected readonly installedRows: Signal<readonly TableRow[]> = computed(
    (): readonly TableRow[] =>
      this.installed().map((model: LocalModel): TableRow => ({ id: model.name, data: model })),
  );

  /**
   * Gets the running models adapted to the table's row shape.
   */
  protected readonly runningRows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.running().map((model: RunningModel): TableRow => ({ id: model.name, data: model })),
  );

  /**
   * Holds the handler the ribbon drives the active view through.
   */
  private readonly commandHandler: ModelManagerCommandHandler = {
    running: this.isRunning,
    stoppable: this.isStoppable,
    busy: this.busy,
    refresh: (): void => void this.refresh(),
    start: (): void => void this.start(),
    stop: (): void => void this.stop(),
  };

  /**
   * Loads the initial state and follows the runtime's status while the tab is open.
   */
  public constructor() {
    // Keep the neutral placeholder if the backend cannot name itself, rather than rendering a blank
    // or an "undefined" into the heading.
    void this.runtimes.describe().then((info: ModelRuntimeInfo): void => {
      if (info.displayName !== undefined && info.displayName.length > 0) {
        this.runtimeName.set(info.displayName);
      }
    });
    void this.refresh();

    // The backend ref-counts watchers and only polls while one is registered, so an unwatched runtime
    // costs nothing. The subscription lives for the tab, not just while it is active, so a server
    // started elsewhere is reflected when the user comes back to it.
    const unwatch: () => void = this.runtimes.watchStatus((status: ModelRuntimeStatus): void => {
      this.status.set(status);
      // Availability changing means the model lists are stale: a server that just came up has models
      // to show, and one that went down has none.
      void this.loadModels();
    });
    const unsubscribeProgress: () => void = this.runtimes.onInstallProgress(
      (progress: RuntimeInstallProgress): void => this.installProgress.set(progress),
    );
    const unsubscribePulls: () => void = this.runtimes.onPullProgress(
      (progress: ModelPullProgress): void => this.acceptPull(progress),
    );

    void this.searchCatalog();

    const destroy: DestroyRef = inject(DestroyRef);
    destroy.onDestroy(unwatch);
    destroy.onDestroy(unsubscribeProgress);
    destroy.onDestroy(unsubscribePulls);
    destroy.onDestroy((): void => {
      if (this.searchTimer !== null) {
        clearTimeout(this.searchTimer);
      }
    });
    destroy.onDestroy((): void => this.commands.unregister(this.commandHandler));

    effect((): void => {
      if (this.isActive()) {
        this.commands.register(this.commandHandler);
      } else {
        this.commands.unregister(this.commandHandler);
      }
    });
  }

  /**
   * Reloads everything the view shows.
   * @returns Returns a promise that resolves once the reload settles.
   */
  protected async refresh(): Promise<void> {
    const [status, installation]: [ModelRuntimeStatus, RuntimeInstallation] = await Promise.all([
      this.runtimes.status(),
      this.runtimes.installation(),
    ]);
    this.status.set(status);
    this.installation.set(installation);
    await this.loadModels();
  }

  /**
   * Starts the runtime's server.
   * @returns Returns a promise that resolves once the start settles.
   */
  protected async start(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const started: boolean = await this.runtimes.start();
      this.log.info('model-manager.view', `Runtime start ${started ? 'succeeded' : 'failed'}`);
      await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Stops the runtime's server.
   * @returns Returns a promise that resolves once the stop settles.
   */
  protected async stop(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.runtimes.stop();
      await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Downloads and installs a Studio-managed copy of the *runtime* — distinct from {@link install},
   * which downloads a model.
   * @returns Returns a promise that resolves once the install settles.
   */
  protected async installRuntime(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.installProgress.set({ stage: 'downloading', received: 0, total: 0 });
    try {
      const installation: RuntimeInstallation = await this.runtimes.install();
      this.installation.set(installation);
      this.log.info('model-manager.view', `Managed install finished as '${installation.kind}'`);
      await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Removes an installed model, deleting its weights.
   * @param model The model to remove.
   * @returns Returns a promise that resolves once the removal settles.
   */
  protected async remove(model: LocalModel): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const removed: boolean = await this.runtimes.remove(model.name);
      this.log.info('model-manager.view', `Remove '${model.name}' ${removed ? 'ok' : 'failed'}`);
      if (removed) {
        // The weights are gone; stop the picker offering a model that can no longer run.
        this.links.unlinkRemoved(model.name);
      }
      await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Dismisses a finished or failed install's progress strip.
   */
  protected dismissProgress(): void {
    this.installProgress.set(null);
  }

  /**
   * Records the search text and schedules a catalogue search, debounced so typing a model name costs
   * one query rather than one per keystroke.
   * @param text The new search text.
   */
  protected onSearchChange(text: string): void {
    this.searchText.set(text);
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout((): void => {
      this.searchTimer = null;
      void this.searchCatalog();
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * Searches the catalogue for the current text.
   * @returns Returns a promise that resolves once the search settles.
   */
  protected async searchCatalog(): Promise<void> {
    this.searching.set(true);
    try {
      const result: CatalogResult = await this.runtimes.searchCatalog(this.searchText());
      this.available.set(result.models);
      this.catalogFailures.set(result.failedSources);
    } finally {
      this.searching.set(false);
    }
  }

  /**
   * Downloads a model from the catalogue. Progress arrives on the push subscription, so this only has
   * to refresh the installed list once the pull settles.
   * @param model The catalogue model to install.
   * @returns Returns a promise that resolves once the pull settles.
   */
  protected async install(model: CatalogModel): Promise<void> {
    this.log.info('model-manager.view', `Pulling '${model.ref}'`);
    try {
      const pulled: boolean = await this.runtimes.pull(model.ref);
      if (pulled) {
        // The model is on disk; make it reachable from the agent picker too. A cancelled or failed
        // pull deliberately links nothing.
        await this.links.linkInstalled(model.ref);
      }
    } finally {
      await this.refresh();
    }
  }

  /**
   * Cancels an in-flight pull.
   * @param model The catalogue model whose pull to cancel.
   * @returns Returns a promise that resolves once the cancel is issued.
   */
  protected async cancelInstall(model: CatalogModel): Promise<void> {
    await this.runtimes.cancelPull(model.ref);
  }

  /**
   * Gets the in-flight pull for a model, or null when it is not being pulled.
   * @param ref The model reference.
   * @returns Returns the progress, or null.
   */
  protected pullOf(ref: string): ModelPullProgress | null {
    return this.pulls().get(ref) ?? null;
  }

  /**
   * Whether a catalogue model is already installed.
   * @param ref The model reference.
   * @returns Returns true when it is installed.
   */
  protected isInstalled(ref: string): boolean {
    return this.installedRefs().has(ref);
  }

  /**
   * Gets a pull's percentage, or null when the total is unknown.
   * @param progress The pull progress.
   * @returns Returns the percentage, or null.
   */
  protected pullPercent(progress: ModelPullProgress): number | null {
    if (progress.total <= 0) {
      return null;
    }
    return Math.min(100, Math.round((progress.received / progress.total) * 100));
  }

  /**
   * Records one pull update. A settled pull is dropped from the map so its row returns to an ordinary
   * Install button, except a failure, which is kept so the user can see why.
   * @param progress The update.
   */
  private acceptPull(progress: ModelPullProgress): void {
    this.pulls.update(
      (current: ReadonlyMap<string, ModelPullProgress>): ReadonlyMap<string, ModelPullProgress> => {
        const next: Map<string, ModelPullProgress> = new Map<string, ModelPullProgress>(current);
        if (progress.stage === 'done' || progress.stage === 'cancelled') {
          next.delete(progress.model);
        } else {
          next.set(progress.model, progress);
        }
        return next;
      },
    );
  }

  /**
   * Reads a table row's installed-model payload.
   * @param row The table row.
   * @returns Returns the row's model.
   */
  protected local(row: TableRow): LocalModel {
    return row.data as LocalModel;
  }

  /**
   * Reads a table row's running-model payload.
   * @param row The table row.
   * @returns Returns the row's model.
   */
  protected loaded(row: TableRow): RunningModel {
    return row.data as RunningModel;
  }

  /**
   * Reads a table row's catalogue-model payload.
   * @param row The table row.
   * @returns Returns the row's model.
   */
  protected cat(row: TableRow): CatalogModel {
    return row.data as CatalogModel;
  }

  /**
   * Describes where a running model is executing. Ollama reports how much of the model sits in VRAM;
   * none of it means it is running on the CPU, which is the difference between fast and unusably slow,
   * so it is surfaced rather than left to be inferred from a byte count.
   * @param model The running model.
   * @returns Returns the processor description.
   */
  protected processor(model: RunningModel): string {
    if (model.sizeVram <= 0) {
      return 'CPU';
    }
    if (model.sizeVram >= model.size) {
      return 'GPU';
    }
    return `GPU ${Math.round((model.sizeVram / model.size) * 100)}%`;
  }

  /**
   * Formats a byte count as a human-readable size.
   * @param bytes The size in bytes.
   * @returns Returns the formatted size (for example `4.7 GB`).
   */
  protected formatBytes(bytes: number): string {
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
   * Formats an ISO-8601 timestamp as a locale date and time, or a dash when there is none.
   * @param timestamp The timestamp.
   * @returns Returns the formatted value.
   */
  protected formatDate(timestamp: string): string {
    if (timestamp === '') {
      return '—';
    }
    const date: Date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
  }

  /**
   * Loads the installed models, running models and disk usage.
   * @returns Returns a promise that resolves once they have loaded.
   */
  private async loadModels(): Promise<void> {
    const [installed, running, disk]: [LocalModel[], RunningModel[], ModelDiskUsage] =
      await Promise.all([this.runtimes.list(), this.runtimes.running(), this.runtimes.diskUsage()]);
    this.installed.set(installed);
    this.running.set(running);
    this.disk.set(disk);
  }
}
