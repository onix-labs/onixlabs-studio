import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

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
   * Gets whether the selected container is paused (#974).
   */
  readonly selectionPaused: Signal<boolean>;

  /**
   * Restarts the selected container (#974).
   */
  restart(): void;

  /**
   * Pauses the selected running container, or resumes it when it is paused (#974).
   */
  togglePause(): void;

  /**
   * Starts the selected container.
   */
  start(): void;

  /**
   * Stops the selected container.
   */
  stop(): void;

  /**
   * Removes the selected container.
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
   * Gets whether the active view's selected container is paused (#974).
   */
  public readonly selectionPaused: Signal<boolean> = computed(
    (): boolean => this.handler()?.selectionPaused() ?? false,
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
   * Starts the selected container in the active view.
   */
  public start(): void {
    this.handler()?.start();
  }

  /**
   * Stops the selected container in the active view.
   */
  public stop(): void {
    this.handler()?.stop();
  }

  /**
   * Removes the selected container in the active view.
   */
  public remove(): void {
    this.handler()?.remove();
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
   * Restarts the active view's selected container (#974).
   */
  public restart(): void {
    this.handler()?.restart();
  }

  /**
   * Pauses or resumes the active view's selected container (#974).
   */
  public togglePause(): void {
    this.handler()?.togglePause();
  }

  public refresh(): void {
    this.handler()?.refresh();
  }
}
