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
   * Refreshes the active view's lists.
   */
  public refresh(): void {
    this.handler()?.refresh();
  }
}
