import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * The contract the active Network Explorer view implements so the ribbon can drive it. The ribbon is
 * rendered by the shell, outside the view's injector, so it cannot reach the view's services directly:
 * the view registers a handler while it is alive, the ribbon calls the forwarding methods, and each is
 * a no-op when no Network Explorer tab is active.
 */
export interface NetworkExplorerCommandHandler {
  /**
   * Gets whether interfaces that are down or carry no address are listed.
   */
  readonly showIdleInterfaces: Signal<boolean>;

  /**
   * Gets whether connections between this machine and itself are listed.
   */
  readonly showLoopback: Signal<boolean>;

  /**
   * Re-reads the machine's interfaces.
   */
  refresh(): void;

  /**
   * Lists idle interfaces, or stops listing them.
   */
  toggleIdleInterfaces(): void;

  /**
   * Lists loopback connections, or stops listing them.
   */
  toggleLoopback(): void;

  /**
   * Opens a capture file the user chooses.
   */
  openCapture(): Promise<void>;
}

/**
 * The registry the Network Explorer ribbon calls into. The active view registers its handler; the
 * ribbon's derived state and forwarding methods read through whichever handler is current.
 */
@Service()
export class NetworkExplorerCommands {
  /**
   * Holds the active view's command handler, or null when no Network Explorer tab is active.
   */
  private readonly handler: WritableSignal<NetworkExplorerCommandHandler | null> =
    signal<NetworkExplorerCommandHandler | null>(null);

  /**
   * Gets whether the active view lists idle interfaces.
   */
  public readonly showIdleInterfaces: Signal<boolean> = computed(
    (): boolean => this.handler()?.showIdleInterfaces() ?? false,
  );

  /**
   * Gets whether the active view lists loopback connections.
   */
  public readonly showLoopback: Signal<boolean> = computed(
    (): boolean => this.handler()?.showLoopback() ?? false,
  );

  /**
   * Registers the active view's handler.
   * @param handler The handler to register.
   */
  public register(handler: NetworkExplorerCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Clears a handler when its view is destroyed or set aside, ignoring a stale clear from a view that
   * has already been replaced by another.
   * @param handler The handler to clear.
   */
  public clear(handler: NetworkExplorerCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Re-reads the interfaces.
   */
  public refresh(): void {
    this.handler()?.refresh();
  }

  /**
   * Toggles listing idle interfaces.
   */
  public toggleIdleInterfaces(): void {
    this.handler()?.toggleIdleInterfaces();
  }

  /**
   * Toggles listing loopback connections.
   */
  public toggleLoopback(): void {
    this.handler()?.toggleLoopback();
  }

  /**
   * Opens a capture file.
   */
  public openCapture(): void {
    void this.handler()?.openCapture();
  }
}
