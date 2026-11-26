import { inject, Service, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * A tab's dock, as {@link TabDocks} drives it. See {@link import('./dock-reveal').DockReveal}.
 */
export interface TabDock {
  /**
   * Determines whether a panel is open anywhere.
   * @param panelId The identifier of the panel.
   * @returns Returns true when it is.
   */
  isOpen(panelId: string): boolean;

  /**
   * Opens and reveals a panel.
   * @param panelId The identifier of the panel.
   */
  open(panelId: string): void;

  /**
   * Closes a panel.
   * @param panelId The identifier of the panel.
   */
  close(panelId: string): void;

  /**
   * Closes a panel its group is showing, and otherwise opens and reveals it.
   * @param panelId The identifier of the panel.
   */
  toggle(panelId: string): void;
}

/**
 * Opens and closes the panels of a tab's dock from outside the tab: its ribbon, its menus, a run, the
 * agent's tools. The dock itself is what knows which panels are open, however they came to be, so what
 * is read here follows it.
 *
 * A view registers its dock for as long as it lives (see
 * {@link import('./dock-tab-registration').createDockTabRegistrar}). A tab with no dock has nothing open,
 * and nothing can be opened in it.
 */
@Service()
export class TabDocks {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the docks, by the identifier of the tab hosting each.
   */
  private readonly docks: WritableSignal<ReadonlyMap<string, TabDock>> = signal<
    ReadonlyMap<string, TabDock>
  >(new Map<string, TabDock>());

  /**
   * Registers a tab's dock.
   * @param tabId The identifier of the tab.
   * @param dock The dock.
   * @returns Returns a function that removes it, unless another has since taken its place.
   */
  public register(tabId: string, dock: TabDock): () => void {
    this.docks.update((docks: ReadonlyMap<string, TabDock>): ReadonlyMap<string, TabDock> =>
      new Map<string, TabDock>(docks).set(tabId, dock),
    );
    return (): void => {
      if (this.docks().get(tabId) !== dock) {
        return;
      }
      this.docks.update((docks: ReadonlyMap<string, TabDock>): ReadonlyMap<string, TabDock> => {
        const next: Map<string, TabDock> = new Map<string, TabDock>(docks);
        next.delete(tabId);
        return next;
      });
    };
  }

  /**
   * Determines whether a panel of a tab's dock is open. Reads signals, so a computed or a template using
   * it follows the dock.
   * @param tabId The identifier of the tab, or undefined for none.
   * @param panelId The identifier of the panel.
   * @returns Returns true when it is.
   */
  public isOpen(tabId: string | undefined, panelId: string): boolean {
    return this.dockOf(tabId)?.isOpen(panelId) ?? false;
  }

  /**
   * Opens and reveals a panel of a tab's dock.
   * @param tabId The identifier of the tab, or undefined for none.
   * @param panelId The identifier of the panel.
   */
  public open(tabId: string | undefined, panelId: string): void {
    this.log.debug('TabDocks', `Opening panel '${panelId}'`, tabId);
    this.dockOf(tabId)?.open(panelId);
  }

  /**
   * Closes a panel of a tab's dock.
   * @param tabId The identifier of the tab, or undefined for none.
   * @param panelId The identifier of the panel.
   */
  public close(tabId: string | undefined, panelId: string): void {
    this.log.debug('TabDocks', `Closing panel '${panelId}'`, tabId);
    this.dockOf(tabId)?.close(panelId);
  }

  /**
   * Closes a panel of a tab's dock when its group is showing it, and otherwise opens and reveals it.
   * @param tabId The identifier of the tab, or undefined for none.
   * @param panelId The identifier of the panel.
   */
  public toggle(tabId: string | undefined, panelId: string): void {
    this.log.debug('TabDocks', `Toggling panel '${panelId}'`, tabId);
    this.dockOf(tabId)?.toggle(panelId);
  }

  /**
   * Gets a tab's dock.
   * @param tabId The identifier of the tab, or undefined for none.
   * @returns Returns the dock, or undefined when the tab hosts none.
   */
  private dockOf(tabId: string | undefined): TabDock | undefined {
    return tabId === undefined ? undefined : this.docks().get(tabId);
  }
}
