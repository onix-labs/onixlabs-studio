import {
  OverlayContainer,
  OverlayKeyboardDispatcher,
  OverlayOutsideClickDispatcher,
} from '@angular/cdk/overlay';
import { DragDropRegistry } from '@angular/cdk/drag-drop';
import { ScrollDispatcher, ViewportRuler } from '@angular/cdk/scrolling';
import { Provider } from '@angular/core';
import { PopoutViewportRuler } from '@shared/angular/components/popout-dock-host/popout-viewport-ruler';

/**
 * Builds the CDK layer a secondary window needs of its own, for a host that renders content into
 * that window's document.
 *
 * CDK resolves these through the triggering element's injector (`createOverlayRef` /
 * `createDragRef`), so providing them on a host component scopes them to everything rendered inside
 * it: the overlay container lands in that window's body, outside-click closing listens on that
 * window's body, drag move/up tracking binds to its document, scrollables register against it, and
 * positioning measures its viewport. Main-window triggers keep resolving the root instances — this
 * is the only supported way to make menus, dropdowns, and drags work in a secondary window.
 *
 * The caller provides `DOCUMENT` itself, from whichever configuration token carries its window's
 * document; every provider here resolves it from the same injector.
 * @returns Returns the window-scoped CDK providers.
 */
export function windowScopedCdkProviders(): Provider[] {
  return [
    OverlayContainer,
    OverlayOutsideClickDispatcher,
    OverlayKeyboardDispatcher,
    ScrollDispatcher,
    DragDropRegistry,
    { provide: ViewportRuler, useClass: PopoutViewportRuler },
  ];
}
