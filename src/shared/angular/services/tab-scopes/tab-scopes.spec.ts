import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  createComponent,
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
import { provideTabScoped, TAB_SCOPE, TabScopedProviders, TabScopes } from './tab-scopes';

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
          : Injector.create({ providers: [{ provide: TAB_SCOPE, useValue: scope }], parent: root }),
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
});
