import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Names the kinds of container the ribbon filters and selects by.
 */
export type ContainerGroup = 'running' | 'paused' | 'stopped';

/**
 * The contract the active Containers view implements so the ribbon can drive it. Mirrors the
 * terminal's command-registry pattern: the view registers a handler while active, the ribbon calls
 * the forwarding methods, and each is a no-op when no view is active.
 */
export interface ContainersCommandHandler {
  /**
   * Gets whether a container is selected, so the ribbon can enable/disable its actions.
   */
  readonly hasSelection: Signal<boolean>;

  /**
   * Gets whether the selected container is running (start disabled when true; stop disabled when false).
   */
  readonly selectionRunning: Signal<boolean>;

  /**
   * Gets whether Start, Stop, Restart or Remove have anything to act on: the ticked containers, or
   * else the selected one.
   */
  readonly hasTargets: Signal<boolean>;

  /**
   * Gets whether any target is stopped or paused, so Start has something to do.
   */
  readonly canStart: Signal<boolean>;

  /**
   * Gets whether any target is running or paused, so Stop has something to do.
   */
  readonly canStop: Signal<boolean>;

  /**
   * Gets whether any target is running, so Pause has something to do.
   */
  readonly canPause: Signal<boolean>;

  /**
   * Gets whether any target is paused, so Resume has something to do.
   */
  readonly canResume: Signal<boolean>;

  /**
   * Gets whether the view is listing containers, which the running-only filter applies to.
   */
  readonly showingContainers: Signal<boolean>;

  /**
   * Gets whether the engine has answered, so an image can be pulled or run.
   */
  readonly engineReady: Signal<boolean>;

  /**
   * Asks for an image to pull.
   */
  pullImage(): void;

  /**
   * Asks how to run an image.
   */
  runImage(): void;

  /**
   * Gets which kinds of container are listed.
   */
  readonly shownGroups: Signal<ReadonlySet<ContainerGroup>>;

  /**
   * Gets which kinds of container have at least one listed, so they can be selected.
   */
  readonly listedGroups: Signal<ReadonlySet<ContainerGroup>>;

  /**
   * Gets which kinds of container are all ticked.
   */
  readonly selectedGroups: Signal<ReadonlySet<ContainerGroup>>;

  /**
   * Lists every kind of container.
   */
  showAll(): void;

  /**
   * Lists a kind of container, or stops listing it and unticks those it hides.
   * @param group The kind of container.
   * @param on Whether to list it.
   */
  setShown(group: ContainerGroup, on: boolean): void;

  /**
   * Ticks or unticks every listed container of a kind.
   * @param group The kind of container.
   * @param on Whether to tick them.
   */
  setSelected(group: ContainerGroup, on: boolean): void;

  /**
   * Gets whether anything is ticked, so Clear has something to do.
   */
  readonly canClear: Signal<boolean>;

  /**
   * Unticks every container.
   */
  clear(): void;

  /**
   * Restarts the ticked containers, or else the selected one (#974).
   */
  restart(): void;

  /**
   * Pauses the running targets (#974).
   */
  pause(): void;

  /**
   * Resumes the paused targets (#974).
   */
  resume(): void;

  /**
   * Starts the stopped targets and resumes the paused ones.
   */
  start(): void;

  /**
   * Stops the running and paused targets.
   */
  stop(): void;

  /**
   * Removes the ticked containers, or else the selected one.
   */
  remove(): void;

  /**
   * Streams the selected container's logs in a terminal.
   */
  viewLogs(): void;

  /**
   * Opens an interactive shell in the selected (running) container.
   */
  shell(): void;

  /**
   * Reloads the container and image lists.
   */
  refresh(): void;
}

/**
 * The registry the Containers ribbon calls into. The active view registers its handler; the ribbon's
 * derived state and forwarding methods read through whichever handler is current.
 */
@Service()
export class ContainersCommands {
  /**
   * Holds the active view's command handler, or null when no Containers tab is active.
   */
  private readonly handler: WritableSignal<ContainersCommandHandler | null> =
    signal<ContainersCommandHandler | null>(null);

  /**
   * Gets whether the active view has a container selected.
   */
  public readonly hasSelection: Signal<boolean> = computed(
    (): boolean => this.handler()?.hasSelection() ?? false,
  );

  /**
   * Gets whether the active view's selected container is running.
   */
  public readonly selectionRunning: Signal<boolean> = computed(
    (): boolean => this.handler()?.selectionRunning() ?? false,
  );

  /**
   * Gets whether the active view has containers for Start, Stop, Restart or Remove to act on.
   */
  public readonly hasTargets: Signal<boolean> = computed(
    (): boolean => this.handler()?.hasTargets() ?? false,
  );

  /**
   * Gets whether Start has something to do in the active view.
   */
  public readonly canStart: Signal<boolean> = computed(
    (): boolean => this.handler()?.canStart() ?? false,
  );

  /**
   * Gets whether Stop has something to do in the active view.
   */
  public readonly canStop: Signal<boolean> = computed(
    (): boolean => this.handler()?.canStop() ?? false,
  );

  /**
   * Gets whether Pause has something to do in the active view.
   */
  public readonly canPause: Signal<boolean> = computed(
    (): boolean => this.handler()?.canPause() ?? false,
  );

  /**
   * Gets whether Resume has something to do in the active view.
   */
  public readonly canResume: Signal<boolean> = computed(
    (): boolean => this.handler()?.canResume() ?? false,
  );

  /**
   * Gets whether the active view is listing containers.
   */
  public readonly showingContainers: Signal<boolean> = computed(
    (): boolean => this.handler()?.showingContainers() ?? false,
  );

  /**
   * Gets whether the active view's engine has answered.
   */
  public readonly engineReady: Signal<boolean> = computed(
    (): boolean => this.handler()?.engineReady() ?? false,
  );

  /**
   * Gets which kinds of container the active view lists.
   */
  public readonly shownGroups: Signal<ReadonlySet<ContainerGroup>> = computed(
    (): ReadonlySet<ContainerGroup> => this.handler()?.shownGroups() ?? new Set<ContainerGroup>(),
  );

  /**
   * Gets which kinds of container have at least one listed in the active view.
   */
  public readonly listedGroups: Signal<ReadonlySet<ContainerGroup>> = computed(
    (): ReadonlySet<ContainerGroup> => this.handler()?.listedGroups() ?? new Set<ContainerGroup>(),
  );

  /**
   * Gets which kinds of container are all ticked in the active view.
   */
  public readonly selectedGroups: Signal<ReadonlySet<ContainerGroup>> = computed(
    (): ReadonlySet<ContainerGroup> =>
      this.handler()?.selectedGroups() ?? new Set<ContainerGroup>(),
  );

  /**
   * Gets whether Clear has something to do in the active view.
   */
  public readonly canClear: Signal<boolean> = computed(
    (): boolean => this.handler()?.canClear() ?? false,
  );

  /**
   * Registers the active view's handler as the current one.
   * @param handler The handler to make current.
   */
  public register(handler: ContainersCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Clears the handler when the owning view deregisters, if it is still the current one.
   * @param handler The handler to clear.
   */
  public unregister(handler: ContainersCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Starts the active view's ticked containers, or else its selected one.
   */
  public start(): void {
    this.handler()?.start();
  }

  /**
   * Stops the active view's ticked containers, or else its selected one.
   */
  public stop(): void {
    this.handler()?.stop();
  }

  /**
   * Removes the active view's ticked containers, or else its selected one.
   */
  public remove(): void {
    this.handler()?.remove();
  }

  /**
   * Asks for an image to pull in the active view.
   */
  public pullImage(): void {
    this.handler()?.pullImage();
  }

  /**
   * Asks how to run an image in the active view.
   */
  public runImage(): void {
    this.handler()?.runImage();
  }

  /**
   * Lists every kind of container in the active view.
   */
  public showAll(): void {
    this.handler()?.showAll();
  }

  /**
   * Lists a kind of container in the active view, or stops listing it.
   * @param group The kind of container.
   * @param on Whether to list it.
   */
  public setShown(group: ContainerGroup, on: boolean): void {
    this.handler()?.setShown(group, on);
  }

  /**
   * Ticks or unticks every listed container of a kind in the active view.
   * @param group The kind of container.
   * @param on Whether to tick them.
   */
  public setSelected(group: ContainerGroup, on: boolean): void {
    this.handler()?.setSelected(group, on);
  }

  /**
   * Unticks every container in the active view.
   */
  public clear(): void {
    this.handler()?.clear();
  }

  /**
   * Streams the selected container's logs in the active view.
   */
  public viewLogs(): void {
    this.handler()?.viewLogs();
  }

  /**
   * Opens a shell in the active view's selected container.
   */
  public shell(): void {
    this.handler()?.shell();
  }

  /**
   * Refreshes the active view's lists.
   */
  /**
   * Restarts the active view's ticked containers, or else its selected one (#974).
   */
  public restart(): void {
    this.handler()?.restart();
  }

  /**
   * Pauses the active view's running targets (#974).
   */
  public pause(): void {
    this.handler()?.pause();
  }

  /**
   * Resumes the active view's paused targets (#974).
   */
  public resume(): void {
    this.handler()?.resume();
  }

  public refresh(): void {
    this.handler()?.refresh();
  }
}
