import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * The contract the active API Explorer view implements so the ribbon can drive it. Mirrors the
 * Containers / Model Manager command-registry pattern: the ribbon is rendered by the shell, outside
 * the view's injector, so it cannot reach the view's services directly. The view registers a handler
 * while it is active, the ribbon calls the forwarding methods, and each is a no-op when no API
 * Explorer tab is active.
 */
export interface ApiExplorerCommandHandler {
  /**
   * Gets whether a request is open in the well and can therefore be sent.
   */
  readonly canSend: Signal<boolean>;

  /**
   * Gets whether the open request is currently in flight, so the ribbon can offer Cancel.
   */
  readonly sending: Signal<boolean>;

  /**
   * Gets the name of the active environment, or null when none is active.
   */
  readonly environmentName: Signal<string | null>;

  /**
   * Sends the request open in the well, or cancels it when it is already in flight.
   */
  send(): void;

  /**
   * Adds a request to the first collection and opens it.
   */
  newRequest(): void;

  /**
   * Adds a collection.
   */
  newCollection(): void;

  /**
   * Cycles to the next environment, so the user can switch target without leaving the ribbon.
   */
  cycleEnvironment(): void;
}

/**
 * The registry the API Explorer ribbon calls into. The active view registers its handler; the ribbon's
 * derived state and forwarding methods read through whichever handler is current.
 */
@Service()
export class ApiExplorerCommands {
  /**
   * Holds the active view's command handler, or null when no API Explorer tab is active.
   */
  private readonly handler: WritableSignal<ApiExplorerCommandHandler | null> =
    signal<ApiExplorerCommandHandler | null>(null);

  /**
   * Gets whether the active view has a request that can be sent.
   */
  public readonly canSend: Signal<boolean> = computed(
    (): boolean => this.handler()?.canSend() ?? false,
  );

  /**
   * Gets whether the active view's open request is in flight.
   */
  public readonly sending: Signal<boolean> = computed(
    (): boolean => this.handler()?.sending() ?? false,
  );

  /**
   * Gets the active view's environment name, or null.
   */
  public readonly environmentName: Signal<string | null> = computed(
    (): string | null => this.handler()?.environmentName() ?? null,
  );

  /**
   * Registers the active view's handler.
   * @param handler The handler to register.
   */
  public register(handler: ApiExplorerCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Clears a handler when its view is destroyed, ignoring a stale clear from a view that has already
   * been replaced by another.
   * @param handler The handler to clear.
   */
  public clear(handler: ApiExplorerCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Sends (or cancels) the open request.
   */
  public send(): void {
    this.handler()?.send();
  }

  /**
   * Adds a request.
   */
  public newRequest(): void {
    this.handler()?.newRequest();
  }

  /**
   * Adds a collection.
   */
  public newCollection(): void {
    this.handler()?.newCollection();
  }

  /**
   * Switches to the next environment.
   */
  public cycleEnvironment(): void {
    this.handler()?.cycleEnvironment();
  }
}
