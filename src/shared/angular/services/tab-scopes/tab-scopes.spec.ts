import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  createComponent,
  DestroyRef,
  EnvironmentInjector,
  inject,
  Injectable,
  Injector,
  OnDestroy,
  Provider,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  provideTabScoped,
  TAB_SCOPE,
  tabScopedProviders,
  TabScopedProviders,
  TabScopes,
} from './tab-scopes';

/**
 * Counts how many sessions are made and ended, standing in for an agent's conversation.
 */
const sessions: { made: number; ended: number } = { made: 0, ended: 0 };

/**
 * Stands in for a service a tab keeps: its agent session.
 */
@Injectable()
class StubSession implements OnDestroy {
  /**
   * Holds what the session has been told, to tell one instance from another.
   */
  public readonly said: string[] = [];

  /**
   * Initializes a new instance of the {@link StubSession} class, counting it.
   */
  public constructor() {
    sessions.made += 1;
  }

  /**
   * Counts the session's end.
   */
  public ngOnDestroy(): void {
    sessions.ended += 1;
  }
}

/**
 * The stand-in tab kind's scope.
 */
const STUB_SCOPE: TabScopedProviders = {
  tokens: [StubSession],
  providers: (): Provider[] => [StubSession],
};

/**
 * Stands in for a tab's view, which lists its tab-scoped session.
 */
@Component({
  selector: 'app-stub-tab-view',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [...provideTabScoped(STUB_SCOPE)],
})
class StubTabView {
  /**
   * Holds the view's session.
   */
  public readonly session: StubSession = inject(StubSession);
}

describe('tab scopes (#1587)', () => {
  let tabs: Tabs;
  let scopes: TabScopes;

  beforeEach(() => {
    sessions.made = 0;
    sessions.ended = 0;
    tabs = TestBed.inject(Tabs);
    scopes = TestBed.inject(TabScopes);
  });

  /**
   * Makes a view as a content host would: under an injector carrying its tab's scope, or under none,
   * as a view made outside a tab is.
   * @param scope The tab's scope, or null.
   * @returns Returns the view.
   */
  function viewWith(scope: EnvironmentInjector | null): ComponentRef<StubTabView> {
    const root: Injector = TestBed.inject(Injector);
    return createComponent(StubTabView, {
      environmentInjector: TestBed.inject(EnvironmentInjector),
      elementInjector:
        scope === null
          ? root
          : Injector.create({
              providers: [
                { provide: TAB_SCOPE, useValue: { injector: scope, scoped: STUB_SCOPE } },
              ],
              parent: root,
            }),
    });
  }

  it('makesOneScopePerTab_theSameWhicheverWindowAsks', () => {
    const tab: Tab = tabs.open('agent');

    const first: EnvironmentInjector = scopes.scopeFor(tab.id, STUB_SCOPE);
    const second: EnvironmentInjector = scopes.scopeFor(tab.id, STUB_SCOPE);

    expect(second).toBe(first);
    expect(first.get(StubSession)).toBe(second.get(StubSession));
  });

  it('aViewHandedItsTabsScope_sharesItsTabsSession_soAMoveKeepsIt', () => {
    const tab: Tab = tabs.open('agent');
    const scope: EnvironmentInjector = scopes.scopeFor(tab.id, STUB_SCOPE);

    // The view in one window, then its re-creation in another.
    const first: ComponentRef<StubTabView> = viewWith(scope);
    first.instance.session.said.push('hello');
    first.destroy();
    const second: ComponentRef<StubTabView> = viewWith(scope);

    expect(second.instance.session).toBe(first.instance.session);
    expect(second.instance.session.said).toEqual(['hello']);
    expect(sessions.made).toBe(1);
    expect(sessions.ended).toBe(0);
  });

  it('aViewMadeOutsideATab_getsASessionOfItsOwn_endedWithIt', () => {
    const view: ComponentRef<StubTabView> = viewWith(null);
    const other: ComponentRef<StubTabView> = viewWith(null);

    expect(view.instance.session).not.toBe(other.instance.session);

    view.destroy();
    expect(sessions.ended).toBe(1);
  });

  it('endsATabsScope_onceTheTabHasClosed', async () => {
    const tab: Tab = tabs.open('agent');
    scopes.scopeFor(tab.id, STUB_SCOPE).get(StubSession);

    tabs.close(tab.id);
    TestBed.tick();
    // Not during the change detection that tears the tab's views down, which still reach it.
    expect(sessions.ended).toBe(0);
    await Promise.resolve();

    expect(sessions.ended).toBe(1);
    expect(scopes.scopeFor(tab.id, STUB_SCOPE).get(StubSession)).toBeInstanceOf(StubSession);
  });

  it('keepsATabsScope_whileTheTabMovesBetweenWindows', async () => {
    const tab: Tab = tabs.open('agent');
    tabs.open('code');
    const session: StubSession = scopes.scopeFor(tab.id, STUB_SCOPE).get(StubSession);

    tabs.moveToWindow(tab.id, 'w2');
    TestBed.tick();
    await Promise.resolve();

    expect(sessions.ended).toBe(0);
    expect(scopes.scopeFor(tab.id, STUB_SCOPE).get(StubSession)).toBe(session);
  });

  it('aViewTakesOnlyItsOwnKindsScope_notTheOneOfAViewItIsNestedIn', () => {
    const tab: Tab = tabs.open('directory');
    const other: TabScopedProviders = { tokens: [], providers: (): Provider[] => [] };
    const outer: EnvironmentInjector = scopes.scopeFor(tab.id, other);
    const view: ComponentRef<StubTabView> = createComponent(StubTabView, {
      environmentInjector: TestBed.inject(EnvironmentInjector),
      elementInjector: Injector.create({
        providers: [{ provide: TAB_SCOPE, useValue: { injector: outer, scoped: other } }],
        parent: TestBed.inject(Injector),
      }),
    });

    // Its own session, from a scope of its own, not a miss in the outer scope.
    expect(view.instance.session).toBeInstanceOf(StubSession);
    expect(sessions.made).toBe(1);
  });

  it('aPartsScope_sitsInItsTabs_andEndsAloneWhileTheTabStaysOpen', async () => {
    const tab: Tab = tabs.open('directory');
    const outer: EnvironmentInjector = scopes.scopeFor(tab.id, STUB_SCOPE);
    const part: TabScopedProviders = { tokens: [], providers: (): Provider[] => [] };

    const first: EnvironmentInjector = scopes.scopeFor(tab.id, part, { key: 'a', parent: outer });
    const second: EnvironmentInjector = scopes.scopeFor(tab.id, part, { key: 'b', parent: outer });

    // Each part has its own, and reaches what its tab keeps.
    expect(second).not.toBe(first);
    expect(scopes.scopeFor(tab.id, part, { key: 'a', parent: outer })).toBe(first);
    expect(first.get(StubSession)).toBe(outer.get(StubSession));

    scopes.endPart(tab.id, 'a');
    TestBed.tick();
    await Promise.resolve();

    expect(scopes.scopeFor(tab.id, part, { key: 'a', parent: outer })).not.toBe(first);
    expect(scopes.scopeFor(tab.id, part, { key: 'b', parent: outer })).toBe(second);
    expect(scopes.scopeFor(tab.id, STUB_SCOPE)).toBe(outer);
    expect(sessions.ended).toBe(0);
  });

  it('aClosedTab_endsItsPartsScopes_beforeItsOwn', async () => {
    const tab: Tab = tabs.open('directory');
    tabs.open('code');
    const outer: EnvironmentInjector = scopes.scopeFor(tab.id, STUB_SCOPE);
    const ended: string[] = [];
    outer.get(StubSession);
    outer.get(DestroyRef).onDestroy((): void => void ended.push('tab'));
    const part: TabScopedProviders = { tokens: [], providers: (): Provider[] => [] };
    scopes
      .scopeFor(tab.id, part, { key: 'a', parent: outer })
      .get(DestroyRef)
      .onDestroy((): void => void ended.push('part'));

    tabs.close(tab.id);
    TestBed.tick();
    await Promise.resolve();

    expect(ended).toEqual(['part', 'tab']);
    expect(sessions.ended).toBe(1);
  });

  it('derivesTheTokens_fromTheProvidersThatMakeThem', () => {
    const scoped: TabScopedProviders = tabScopedProviders((): Provider[] => [
      StubSession,
      [{ provide: TAB_SCOPE, useValue: null }],
    ]);

    expect(scoped.tokens).toEqual([StubSession, TAB_SCOPE]);
  });
});
