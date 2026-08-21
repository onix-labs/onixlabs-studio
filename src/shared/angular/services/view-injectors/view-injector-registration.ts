import { effect, inject, Injector, Signal } from '@angular/core';
import { ViewInjectors } from './view-injectors';

/**
 * A deferred view-injector registration created in an injection context but completed once the
 * owning tab's id is known.
 */
export interface ViewInjectorRegistrar {
  /**
   * Publishes the view's injector against its tab for as long as the view is active, so the shell can
   * mount the feature's status strip through it. Call once from the view's `ngOnInit`, when the
   * required tab-id input is readable.
   * @param tabId The owning tab's identifier.
   */
  register(tabId: string): void;
}

/**
 * Publishes a feature view's injector, while it is active, so the shell's status strip can mount the
 * feature's status component inside it and reach the view's own per-tab services.
 *
 * Registration follows activation rather than mere existence, because a tab is not always one view: a
 * worktree container tab mounts one kept-alive sub-view per checkout, all sharing the tab's id, and
 * only the selected one speaks for the tab. Registering the active view resolves that without the
 * feature having to qualify anything — and the registration is dropped on deactivation and on destroy
 * alike, so nothing can outlive the view it describes.
 *
 * Injects its dependencies in the calling injection context (a component field initializer); the
 * caller finalises registration from `ngOnInit`, once the required tab-id input is readable.
 * @param options The view's active-state signal.
 * @returns Returns a registrar to finalise once the tab id is known.
 */
export function createViewInjectorRegistrar(options: {
  readonly isActive: Signal<boolean>;
}): ViewInjectorRegistrar {
  const injector: Injector = inject(Injector);
  const injectors: ViewInjectors = inject(ViewInjectors);

  return {
    register(tabId: string): void {
      effect(
        (onCleanup: (callback: () => void) => void): void => {
          if (!options.isActive()) {
            return;
          }
          onCleanup(injectors.register(tabId, injector));
        },
        { injector },
      );
    },
  };
}
