import { Provider } from '@angular/core';
import { DockAutoHide } from './dock-auto-hide';
import { DockDrag } from './dock-drag';
import { DockFloating } from './dock-floating';
import { DockFocus } from './dock-focus';
import { DockGeometry } from './dock-geometry';
import { DockMinimums } from './dock-minimums';
import { DockReveal } from './dock-reveal';
import { DockState } from './dock-state';
import { PopoutPanels } from './popout-panels';

/**
 * Builds the services one window's dock has of its own: its layout, and everything that measures, drags,
 * floats, hides, focuses and reveals within it. A view's dock and a pop-out window's each have these;
 * what they share, such as the panels, the view provides (see
 * {@link import('./dock-providers').dockProviders}). The host provides the
 * {@link import('./dock-blueprint').DOCK_BLUEPRINT} its layout starts from.
 * @returns Returns the providers.
 */
export function dockWindowProviders(): Provider[] {
  return [
    DockState,
    DockGeometry,
    DockMinimums,
    DockFocus,
    DockFloating,
    DockAutoHide,
    DockDrag,
    DockReveal,
    PopoutPanels,
  ];
}
