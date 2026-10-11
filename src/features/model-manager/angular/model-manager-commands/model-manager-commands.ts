import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * The groups the AI Model Manager's list is split into, one open at a time.
 */
export type ModelGroupId = 'installed' | 'available' | 'loaded';

/**
 * The contract the active AI Model Manager view implements so the ribbon can drive it. Mirrors the
 * Containers/System Monitor command-registry pattern: the view registers a handler while active, the
 * ribbon calls the forwarding methods, and each is a no-op when no view is active.
 */
export interface ModelManagerCommandHandler {
  /**
   * Gets whether the runtime's server is currently reachable, so the ribbon can offer Start or Stop.
   */
  readonly running: Signal<boolean>;

  /**
   * Gets whether the reachable server is the one Studio started. Only such a server can be stopped, so
   * the ribbon disables Stop for a server the user is running themselves.
   */
  readonly stoppable: Signal<boolean>;

  /**
   * Gets whether an operation is in flight, so the ribbon can disable its actions.
   */
  readonly busy: Signal<boolean>;

  /**
   * Gets whether the runtime is not installed, so the ribbon offers Install in place of Start.
   */
  readonly needsInstall: Signal<boolean>;

  /**
   * Gets the group of the list that is open, or null when none is, so the ribbon's group buttons show
   * which is pressed.
   */
  readonly shownGroup: Signal<ModelGroupId | null>;

  /**
   * Gets the groups that have models to list, so the ribbon disables the button of an empty one.
   */
  readonly presentGroups: Signal<readonly ModelGroupId[]>;

  /**
   * Gets the search text the list is filtered by.
   */
  readonly searchText: Signal<string>;

  /**
   * Installs the runtime.
   */
  installRuntime(): void;

  /**
   * Opens a group of the list, closing the others.
   * @param group The group to open.
   */
  openGroup(group: ModelGroupId): void;

  /**
   * Filters the list by text: the installed and loaded models by name, and the catalogue by search.
   * @param text The search text.
   */
  search(text: string): void;

  /**
   * Reloads the installed models, running models, status and disk usage.
   */
  refresh(): void;

  /**
   * Starts the runtime's server.
   */
  start(): void;

  /**
   * Stops the runtime's server.
   */
  stop(): void;
}

/**
 * The registry the AI Model Manager ribbon calls into. The active view registers its handler; the
 * ribbon's derived state and forwarding methods read through whichever handler is current.
 */
@Service()
export class ModelManagerCommands {
  /**
   * Holds the active view's command handler, or null when no Model Manager tab is active.
   */
  private readonly handler: WritableSignal<ModelManagerCommandHandler | null> =
    signal<ModelManagerCommandHandler | null>(null);

  /**
   * Gets whether the active view's runtime server is running.
   */
  public readonly running: Signal<boolean> = computed(
    (): boolean => this.handler()?.running() ?? false,
  );

  /**
   * Gets whether the active view's runtime server can be stopped by Studio.
   */
  public readonly stoppable: Signal<boolean> = computed(
    (): boolean => this.handler()?.stoppable() ?? false,
  );

  /**
   * Gets whether the active view has an operation in flight.
   */
  public readonly busy: Signal<boolean> = computed((): boolean => this.handler()?.busy() ?? false);

  /**
   * Gets whether the active view's runtime is not installed.
   */
  public readonly needsInstall: Signal<boolean> = computed(
    (): boolean => this.handler()?.needsInstall() ?? false,
  );

  /**
   * Gets the active view's open group, or null when no view is active or none is open.
   */
  public readonly shownGroup: Signal<ModelGroupId | null> = computed(
    (): ModelGroupId | null => this.handler()?.shownGroup() ?? null,
  );

  /**
   * Gets the active view's groups that have models to list; none when no view is active.
   */
  public readonly presentGroups: Signal<readonly ModelGroupId[]> = computed(
    (): readonly ModelGroupId[] => this.handler()?.presentGroups() ?? [],
  );

  /**
   * Gets the active view's search text.
   */
  public readonly searchText: Signal<string> = computed(
    (): string => this.handler()?.searchText() ?? '',
  );

  /**
   * Registers the active view's handler as the current one.
   * @param handler The handler to make current.
   */
  public register(handler: ModelManagerCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Clears the handler when the owning view deregisters, if it is still the current one.
   * @param handler The handler to clear.
   */
  public unregister(handler: ModelManagerCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Reloads the active view's models and status.
   */
  public refresh(): void {
    this.handler()?.refresh();
  }

  /**
   * Starts the active view's runtime server.
   */
  public start(): void {
    this.handler()?.start();
  }

  /**
   * Stops the active view's runtime server.
   */
  public stop(): void {
    this.handler()?.stop();
  }

  /**
   * Installs the active view's runtime.
   */
  public installRuntime(): void {
    this.handler()?.installRuntime();
  }

  /**
   * Opens a group of the active view's list.
   * @param group The group to open.
   */
  public openGroup(group: ModelGroupId): void {
    this.handler()?.openGroup(group);
  }

  /**
   * Filters the active view's list.
   * @param text The search text.
   */
  public search(text: string): void {
    this.handler()?.search(text);
  }
}
