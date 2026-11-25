import { Provider } from '@angular/core';
import { PanelPopout } from '@shared/angular/services/panel-popout/panel-popout';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { DockPanelAvailability } from './dock-panel-availability';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockTabContext } from './dock-tab-context';
import { dockWindowProviders } from './dock-window-providers';

/**
 * Builds everything a view needs to host a dock, for its component's `providers`:
 *
 * - what the view's dock and its pop-out windows share — its panels, which of them have something behind
 *   them, and which tab it is;
 * - the services of the view's own dock (see {@link dockWindowProviders}); and
 * - the coordinator that pops a panel out into a window, which the dock's chrome offers once the view
 *   injects it.
 *
 * Each call builds providers for one dock, so every tab hosting one has its own.
 * @param blueprint The blueprint specialising the dock, or a factory building it, which may inject.
 * @returns Returns the providers.
 */
export function dockProviders(blueprint: DockBlueprint | (() => DockBlueprint)): Provider[] {
  return [
    DockTabContext,
    DockPanelRegistry,
    DockPanelAvailability,
    ...dockWindowProviders(),
    PanelPopout,
    typeof blueprint === 'function'
      ? { provide: DOCK_BLUEPRINT, useFactory: blueprint }
      : { provide: DOCK_BLUEPRINT, useValue: blueprint },
  ];
}
