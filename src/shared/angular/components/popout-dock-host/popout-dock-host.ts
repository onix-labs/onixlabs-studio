import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, InjectionToken } from '@angular/core';
import { DockContainer } from '@shared/angular/components/dock-layout/dock-container/dock-container';
import { DOCK_BLUEPRINT, DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockAutoHide } from '@shared/angular/services/dock-layout/dock-auto-hide';
import { DockDrag } from '@shared/angular/services/dock-layout/dock-drag';
import { DockFloating } from '@shared/angular/services/dock-layout/dock-floating';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockGeometry } from '@shared/angular/services/dock-layout/dock-geometry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockNode, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';

/**
 * Configures a pop-out window's dock: the document the dock lives in (the auxiliary window's) and
 * the panel its layout starts with. Supplied through the element injector the host is created
 * with, so the host's own providers can build the dock services around it.
 */
export interface PopoutDockConfig {
  /**
   * Gets the auxiliary window's document, which the dock's drag and chrome must operate in.
   */
  readonly document: Document;

  /**
   * Gets the identifier of the panel the dock starts with.
   */
  readonly panelId: string;
}

/**
 * Injects the {@link PopoutDockConfig} of a pop-out window's dock host.
 */
export const POPOUT_DOCK_CONFIG: InjectionToken<PopoutDockConfig> =
  new InjectionToken<PopoutDockConfig>('POPOUT_DOCK_CONFIG');

/**
 * Hosts a full dock container inside a pop-out window. The dock services are provided HERE — a
 * fresh layout state seeded with the popped panel, geometry, drag, floating, auto-hide, focus, and
 * reveal all scoped to this window and its document — while everything else (the panel registry,
 * the tab context, and every panel's backing service) resolves through the parent injector to the
 * owning view's instances. A pop-out window is therefore a real dock: its panels arrange, tab,
 * float, and collapse with the same machinery as the main window's, and their content behaves as
 * if docked there.
 *
 * The window's dock is ephemeral: its blueprint carries no persistence key, so arrangements live
 * and die with the window. Its {@link PopoutPanels} instance is fresh and handler-less, so the
 * group chrome's own pop-out button is disabled inside a window that already is one.
 */
@Component({
  selector: 'app-popout-dock-host',
  imports: [DockContainer],
  template: '<app-dock-container />',
  styleUrl: './popout-dock-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    DockState,
    DockGeometry,
    DockFocus,
    DockFloating,
    DockAutoHide,
    DockDrag,
    DockReveal,
    PopoutPanels,
    {
      provide: DOCUMENT,
      useFactory: (): Document => inject(POPOUT_DOCK_CONFIG).document,
    },
    {
      provide: DOCK_BLUEPRINT,
      useFactory: (): DockBlueprint => {
        const panelId: string = inject(POPOUT_DOCK_CONFIG).panelId;
        return {
          createLayout: (): DockNode => mkStack('tool', [panelId]),
          panels: [],
        };
      },
    },
  ],
})
export class PopoutDockHost {}
