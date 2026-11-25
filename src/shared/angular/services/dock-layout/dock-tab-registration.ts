import { DestroyRef, inject } from '@angular/core';
import { DockReveal } from './dock-reveal';
import { DockTabContext } from './dock-tab-context';
import { TabDocks } from './tab-docks';

/**
 * A view's registration of its dock against its tab, created in an injection context and completed once
 * the tab's identifier is known.
 */
export interface DockTabRegistrar {
  /**
   * Tells the dock which tab hosts it, and lets the tab's panels be opened and closed from outside it
   * (see {@link TabDocks}) until the view is destroyed. Call once, from the view's `ngOnInit`.
   * @param tabId The identifier of the tab.
   */
  register(tabId: string): void;
}

/**
 * Creates the registration of a view's dock against its tab. Call in a field initializer of a component
 * providing a dock (see {@link import('./dock-providers').dockProviders}).
 * @returns Returns the registrar.
 */
export function createDockTabRegistrar(): DockTabRegistrar {
  const context: DockTabContext = inject(DockTabContext);
  const reveal: DockReveal = inject(DockReveal);
  const docks: TabDocks = inject(TabDocks);
  const destroyRef: DestroyRef = inject(DestroyRef);
  return {
    register(tabId: string): void {
      context.setTabId(tabId);
      destroyRef.onDestroy(docks.register(tabId, reveal));
    },
  };
}
