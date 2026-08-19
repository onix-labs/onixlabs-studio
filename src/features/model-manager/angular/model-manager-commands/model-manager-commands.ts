import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

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
}
