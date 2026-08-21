import { computed, inject, Injector, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * Holds the node injector of every mounted feature view, keyed by tab id.
 *
 * The shell's chrome strips live in the application root, outside the injector of any view, so a
 * chrome component cannot reach the per-tab services a view provides (a workspace, an API document,
 * an editor's document model). Views publish their injector here as they mount, and the shell mounts
 * a feature's chrome component *through* it — so the chrome reads the active view's own services
 * directly, with no forwarding registry in between and nothing to keep in step.
 *
 * A registration is dropped when the view is destroyed. Even a missed drop cannot surface stale
 * chrome: lookups are made against the active tab's id, and a closed tab is never active again.
 */
@Service()
export class ViewInjectors {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds every mounted view's injector, keyed by the id of the tab it belongs to.
   */
  private readonly injectors: WritableSignal<ReadonlyMap<string, Injector>> = signal<
    ReadonlyMap<string, Injector>
  >(new Map<string, Injector>());

  /**
   * Registers a mounted view's injector against its tab.
   * @param tabId The identifier of the tab the view belongs to.
   * @param injector The view's node injector.
   * @returns Returns a callback that drops the registration, for the caller's destroy hook.
   */
  public register(tabId: string, injector: Injector): () => void {
    this.injectors.update(
      (current: ReadonlyMap<string, Injector>): ReadonlyMap<string, Injector> => {
        const next: Map<string, Injector> = new Map<string, Injector>(current);
        next.set(tabId, injector);
        return next;
      },
    );
    this.log.trace('ViewInjectors', 'Registered view injector', tabId);
    return (): void => this.unregister(tabId, injector);
  }

  /**
   * Gets a reactive view of the injector registered for a tab.
   * @param tabId Reads the identifier of the tab to resolve, or undefined when no tab is active.
   * @returns Returns a signal of the tab's injector, or null when no view is registered for it.
   */
  public injectorFor(tabId: Signal<string | undefined>): Signal<Injector | null> {
    return computed((): Injector | null => {
      const id: string | undefined = tabId();
      return id === undefined ? null : (this.injectors().get(id) ?? null);
    });
  }

  /**
   * Drops a view's registration, but only when it still owns the entry — a view destroyed after its
   * successor has already registered (a re-parent, or a tab type swapped in place) must not remove
   * the injector that replaced it.
   * @param tabId The identifier of the tab the view belonged to.
   * @param injector The injector that was registered.
   */
  private unregister(tabId: string, injector: Injector): void {
    this.injectors.update(
      (current: ReadonlyMap<string, Injector>): ReadonlyMap<string, Injector> => {
        if (current.get(tabId) !== injector) {
          return current;
        }
        const next: Map<string, Injector> = new Map<string, Injector>(current);
        next.delete(tabId);
        return next;
      },
    );
  }
}
