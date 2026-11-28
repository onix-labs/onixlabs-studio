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
 * Names the services a kind of tab keeps from the providers that make them: every one of them is
 * resolved from the tab's scope. A token left off a hand-written list would quietly resolve to the
 * application's own instance instead, so a long list is better derived than typed twice.
 * @param providers Makes the providers of a fresh scope.
 * @returns Returns the tab-scoped services.
 */
export function tabScopedProviders(providers: () => Provider[]): TabScopedProviders {
  const tokens: ProviderToken<unknown>[] = [];
  const collect: (provider: Provider) => void = (provider: Provider): void => {
    if (Array.isArray(provider)) {
      provider.forEach(collect);
    } else if (typeof provider === 'function') {
      tokens.push(provider);
    } else if (typeof provider === 'object' && provider !== null && 'provide' in provider) {
      tokens.push(provider.provide as ProviderToken<unknown>);
    }
  };
  providers().forEach(collect);
  return { tokens, providers };
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
   * Holds each tab's scopes, by tab id: its own, under the empty key, and any made for a part of it
   * (a worktree checkout of a workspace tab, say), under that part's key.
   */
  private readonly scopes: Map<string, Map<string, EnvironmentInjector>> = new Map<
    string,
    Map<string, EnvironmentInjector>
  >();

  /**
   * Initializes a new instance of the {@link TabScopes} class, ending the scopes of every tab that
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
            this.endTab(tabId);
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
    for (const tabId of [...this.scopes.keys()]) {
      this.endTab(tabId);
    }
  }

  /**
   * Gets a tab's scope, or the scope of a part of it, making it the first time.
   * @param tabId The tab's identifier.
   * @param scoped The services its kind keeps.
   * @param part The part of the tab the scope is for, with the scope it sits in, or undefined for the
   * tab's own.
   * @returns Returns the scope.
   */
  public scopeFor(
    tabId: string,
    scoped: TabScopedProviders,
    part?: { readonly key: string; readonly parent: EnvironmentInjector },
  ): EnvironmentInjector {
    let scopes: Map<string, EnvironmentInjector> | undefined = this.scopes.get(tabId);
    if (scopes === undefined) {
      scopes = new Map<string, EnvironmentInjector>();
      this.scopes.set(tabId, scopes);
    }
    const key: string = part?.key ?? '';
    let scope: EnvironmentInjector | undefined = scopes.get(key);
    if (scope === undefined) {
      scope = createEnvironmentInjector(
        scoped.providers(),
        part?.parent ?? this.environmentInjector,
        part === undefined ? tabId : `${tabId}/${part.key}`,
      );
      scopes.set(key, scope);
    }
    return scope;
  }

  /**
   * Ends the scope of a part of a tab that has gone while the tab stays open, such as a worktree
   * checkout that was removed. A no-op when there is none.
   * @param tabId The tab's identifier.
   * @param key The part's key.
   */
  public endPart(tabId: string, key: string): void {
    const scopes: Map<string, EnvironmentInjector> | undefined = this.scopes.get(tabId);
    if (key === '' || scopes === undefined) {
      return;
    }
    scopes.get(key)?.destroy();
    scopes.delete(key);
  }

  /**
   * Ends every scope of a tab, its parts' before its own, which they sit in.
   * @param tabId The tab's identifier.
   */
  private endTab(tabId: string): void {
    const scopes: Map<string, EnvironmentInjector> | undefined = this.scopes.get(tabId);
    if (scopes === undefined) {
      return;
    }
    for (const [key, scope] of scopes) {
      if (key !== '') {
        scope.destroy();
      }
    }
    scopes.get('')?.destroy();
    this.scopes.delete(tabId);
  }
}
