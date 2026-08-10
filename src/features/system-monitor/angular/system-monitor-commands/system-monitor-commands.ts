import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * The contract the active System Monitor view implements so the ribbon can drive it. Mirrors the
 * Containers/terminal command-registry pattern: the view registers a handler while active, the ribbon
 * calls the forwarding methods, and each is a no-op when no view is active.
 */
export interface SystemMonitorCommandHandler {
  /**
   * Gets whether the audit currently shows any records, so the ribbon can enable/disable Copy.
   */
  readonly hasRecords: Signal<boolean>;

  /**
   * Reloads the sessions and the viewed session's records.
   */
  refresh(): void;

  /**
   * Resets the severity and text filters to their defaults (all severities, no text).
   */
  clearFilters(): void;

  /**
   * Copies the currently-shown records to the clipboard as text.
   */
  copy(): void;
}

/**
 * The registry the System Monitor ribbon calls into. The active view registers its handler; the
 * ribbon's derived state and forwarding methods read through whichever handler is current.
 */
@Service()
export class SystemMonitorCommands {
  /**
   * Holds the active view's command handler, or null when no System Monitor tab is active.
   */
  private readonly handler: WritableSignal<SystemMonitorCommandHandler | null> =
    signal<SystemMonitorCommandHandler | null>(null);

  /**
   * Gets whether the active view's audit shows any records.
   */
  public readonly hasRecords: Signal<boolean> = computed(
    (): boolean => this.handler()?.hasRecords() ?? false,
  );

  /**
   * Registers the active view's handler as the current one.
   * @param handler The handler to make current.
   */
  public register(handler: SystemMonitorCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Clears the handler when the owning view deregisters, if it is still the current one.
   * @param handler The handler to clear.
   */
  public unregister(handler: SystemMonitorCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Reloads the active view's sessions and records.
   */
  public refresh(): void {
    this.handler()?.refresh();
  }

  /**
   * Resets the active view's filters.
   */
  public clearFilters(): void {
    this.handler()?.clearFilters();
  }

  /**
   * Copies the active view's shown records to the clipboard.
   */
  public copy(): void {
    this.handler()?.copy();
  }
}
