import {
  createEnvironmentInjector,
  DestroyRef,
  effect,
  EnvironmentInjector,
  inject,
  InjectionToken,
  OnDestroy,
  Provider,
  ProviderToken,
  Service,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Names the services a kind of tab keeps for as long as the tab is open, whichever window shows it
 * (#1587): its agent session, its open documents, its terminals. A view is re-created when its tab moves
 * to another window; what it provides itself goes with it, and what its tab scope holds does not.
 */
export interface TabScopedProviders {
  /**
   * Gets the tokens a view resolves from its tab's scope, rather than providing itself.
   */
  readonly tokens: readonly ProviderToken<unknown>[];

  /**
   * Makes the providers of a fresh scope, once per tab.
   * @returns Returns the providers.
   */
  readonly providers: () => Provider[];
}

/**
 * Describes a tab's scope as the content host hands it to the tab's view.
 */
export interface TabScope {
  /**
   * Gets the scope.
   */
  readonly injector: EnvironmentInjector;

  /**
   * Gets what the scope was made with, so a view only takes the scope of its own kind of tab: one
   * nested in another kind's view must not take that view's.
   */
  readonly scoped: TabScopedProviders;
}

/**
 * Carries a tab's scope to its view, from the content host that renders it.
 */
export const TAB_SCOPE: InjectionToken<TabScope> = new InjectionToken<TabScope>('TAB_SCOPE');

/**
 * Holds the scope a view resolves its tab-scoped services from: its tab's, or one of its own when it
 * is made outside a tab.
 */
const VIEW_SCOPE: InjectionToken<EnvironmentInjector> = new InjectionToken<EnvironmentInjector>(
  'VIEW_SCOPE',
);

/**
 * Gets the providers a view lists for its tab-scoped services: each resolves from its tab's scope, so
 * it is the same instance in whichever window the view is made. A view made outside a tab (in its own
 * tests, say) gets a scope of its own, destroyed with it, so it behaves as it did when it provided
 * them itself.
 * @param scoped The tab-scoped services.
 * @returns Returns the view's providers for them.
 */
export function provideTabScoped(scoped: TabScopedProviders): Provider[] {
  return [
    {
      provide: VIEW_SCOPE,
      useFactory: (): EnvironmentInjector => {
        const tabScope: TabScope | null = inject(TAB_SCOPE, { optional: true });
        if (tabScope?.scoped === scoped) {
          return tabScope.injector;
        }
        const own: EnvironmentInjector = createEnvironmentInjector(
          scoped.providers(),
          inject(EnvironmentInjector),
        );
        inject(DestroyRef).onDestroy((): void => own.destroy());
        return own;
      },
    },
    ...scoped.tokens.map((token: ProviderToken<unknown>): Provider => ({
      provide: token,
      useFactory: (): unknown => inject(VIEW_SCOPE).get(token),
    })),
  ];
}

/**
 * Keeps each open tab's scope: made the first time a view asks for it, and destroyed once the tab has
 * closed and its views are gone, never while it moves between windows.
 */
@Service()
export class TabScopes implements OnDestroy {
  /**
   * Holds the root environment, every scope's parent.
   */
  private readonly environmentInjector: EnvironmentInjector = inject(EnvironmentInjector);

  /**
   * Holds the tab registry, whose closes end scopes.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds each tab's scope, by tab id.
   */
  private readonly scopes: Map<string, EnvironmentInjector> = new Map<
    string,
    EnvironmentInjector
  >();

  /**
   * Initializes a new instance of the {@link TabScopes} class, ending the scope of every tab that
   * closes.
   */
  public constructor() {
    effect((): void => {
      const open: ReadonlySet<string> = new Set<string>(
        this.tabs.tabs().map((tab: Tab): string => tab.id),
      );
      const closed: string[] = [...this.scopes.keys()].filter(
        (tabId: string): boolean => !open.has(tabId),
      );
      if (closed.length > 0) {
        // After this pass of change detection, which is when the closed tabs' views are torn down:
        // their teardown still reaches what the scope holds.
        queueMicrotask((): void => {
          for (const tabId of closed) {
            this.scopes.get(tabId)?.destroy();
            this.scopes.delete(tabId);
            this.log.debug('TabScopes', 'Ended the scope of a closed tab', tabId);
          }
        });
      }
    });
  }

  /**
   * Ends every scope with the application.
   */
  public ngOnDestroy(): void {
    for (const scope of this.scopes.values()) {
      scope.destroy();
    }
    this.scopes.clear();
  }

  /**
   * Gets a tab's scope, making it the first time.
   * @param tabId The tab's identifier.
   * @param scoped The services its kind keeps.
   * @returns Returns the scope.
   */
  public scopeFor(tabId: string, scoped: TabScopedProviders): EnvironmentInjector {
    let scope: EnvironmentInjector | undefined = this.scopes.get(tabId);
    if (scope === undefined) {
      scope = createEnvironmentInjector(scoped.providers(), this.environmentInjector, tabId);
      this.scopes.set(tabId, scope);
    }
    return scope;
  }
}
