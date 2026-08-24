import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * Describes one of the active view's dockable panels as the application menu offers it: what it is
 * called, whether it is currently in the layout, and whether it has anything to show.
 */
export interface DockPanelState {
  /**
   * Gets the panel's identifier, as the dock knows it.
   */
  readonly id: string;

  /**
   * Gets the panel's display title, as it reads in the menu.
   */
  readonly title: string;

  /**
   * Gets whether the panel is currently showing — tabbed in the dock, floating over it, or popped out
   * into its own window. Drives the menu row's tick.
   */
  readonly docked: boolean;

  /**
   * Gets whether the panel can be toggled right now. A panel with nothing behind it is listed but
   * disabled rather than hidden — the Solution Explorer without a recognised project system, the Debug
   * panel without a session, the source-control panels without a repository — so the menu stays a
   * stable map of what the view can hold rather than a list that reshuffles under the pointer. A panel
   * already showing stays enabled whatever is behind it, so it can always be dismissed; one living in
   * its own pop-out window does not, because that window is what closes it.
   */
  readonly enabled: boolean;
}

/**
 * Defines the panel commands the active dock-hosting view serves on behalf of the shell's chrome.
 */
export interface DockPanelCommandHandler {
  /**
   * Gets the view's dockable tool panels, in catalogue order.
   */
  readonly panels: Signal<readonly DockPanelState[]>;

  /**
   * Toggles a panel: docks and reveals it when it is absent, and closes it when it is present.
   * @param panelId The identifier of the panel to toggle.
   */
  toggle(panelId: string): void;
}

/**
 * Routes the application menu's View → Panels commands to the active dock-hosting view.
 *
 * The ribbon and the menu are rendered by the shell, outside the injector of any view, so neither can
 * resolve the per-view dock services a panel command has to act on. The active view registers a handler
 * here reaching its own {@link import('@shared/angular/services/dock-layout/dock-state').DockState},
 * and the menu reads and dispatches through it — the same seam shape the workspace's find and
 * source-control commands already use.
 *
 * With no view registered the list is empty and the menu's Panels submenu simply does not appear.
 */
@Service()
export class DockPanelCommands {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the active view's handler, or null when no dock-hosting tab is active.
   */
  private readonly handler: WritableSignal<DockPanelCommandHandler | null> =
    signal<DockPanelCommandHandler | null>(null);

  /**
   * Gets the active view's dockable panels, or an empty list when no view is registered.
   */
  public readonly panels: Signal<readonly DockPanelState[]> = computed(
    (): readonly DockPanelState[] => this.handler()?.panels() ?? [],
  );

  /**
   * Registers the active view's handler.
   * @param handler The handler serving the active view's dock.
   */
  public register(handler: DockPanelCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Unregisters the given handler, if it is the currently registered one.
   * @param handler The handler to unregister.
   */
  public unregister(handler: DockPanelCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Toggles a panel in the active view's dock.
   * @param panelId The identifier of the panel to toggle.
   */
  public toggle(panelId: string): void {
    this.log.debug('DockPanelCommands', `Toggling panel '${panelId}'`);
    this.handler()?.toggle(panelId);
  }
}
