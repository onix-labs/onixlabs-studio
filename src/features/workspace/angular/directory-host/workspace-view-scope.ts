import {
  Directive,
  EnvironmentInjector,
  inject,
  Injector,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import { StudioWindows } from '@shared/angular/services/studio-windows/studio-windows';
import { TAB_SCOPE, TabScope, TabScopes } from '@shared/angular/services/tab-scopes/tab-scopes';
import { WORKSPACE_VIEW_SCOPE } from '@features/workspace/angular/directory-view/directory-view';
import { WORKSPACE_TAB_SCOPE } from './directory-host-state';

/**
 * Renders one workspace view of a directory tab inside a scope of its own, kept in the tab's scope, so
 * the view's workspace, documents, terminals and dock outlive the view when its tab moves to another
 * window (#1587). A worktree container's checkouts each have one, under the checkout's id; the scope
 * ends when the view goes for any reason other than a move, and with the tab.
 *
 * Used as `<app-directory-view *appWorkspaceViewScope="key; tab: tabId()" … />`.
 */
@Directive({
  selector: '[appWorkspaceViewScope]',
})
export class WorkspaceViewScope implements OnInit, OnDestroy {
  /**
   * Gets the key of the view's scope within its tab: a checkout's id, or a fixed key for a tab's
   * single view.
   */
  public readonly key: InputSignal<string> = input.required<string>({
    alias: 'appWorkspaceViewScope',
  });

  /**
   * Gets the owning tab's id.
   */
  public readonly appWorkspaceViewScopeTab: InputSignal<string> = input.required<string>();

  /**
   * Holds the template of the view.
   */
  private readonly template: TemplateRef<unknown> = inject(TemplateRef);

  /**
   * Holds where the view is rendered.
   */
  private readonly container: ViewContainerRef = inject(ViewContainerRef);

  /**
   * Holds the open tabs' scopes.
   */
  private readonly tabScopes: TabScopes = inject(TabScopes);

  /**
   * Holds the windows, which say whether a tab is moving.
   */
  private readonly studioWindows: StudioWindows = inject(StudioWindows);

  /**
   * Holds the tab's scope, as its content host hands it over, or null outside a tab.
   */
  private readonly tabScope: TabScope | null = inject(TAB_SCOPE, { optional: true });

  /**
   * Holds whether the view was rendered in a scope kept for it.
   */
  private kept: boolean = false;

  /**
   * Renders the view in its scope. Outside a directory tab's scope (in a test, say) the view is
   * rendered as it is, and makes a scope of its own.
   */
  public ngOnInit(): void {
    if (this.tabScope?.scoped !== WORKSPACE_TAB_SCOPE) {
      this.container.createEmbeddedView(this.template);
      return;
    }
    const scope: EnvironmentInjector = this.tabScopes.scopeFor(
      this.appWorkspaceViewScopeTab(),
      WORKSPACE_VIEW_SCOPE,
      { key: this.key(), parent: this.tabScope.injector },
    );
    this.kept = true;
    // No parent: a token this does not hold goes on up the view's own injectors, as it would without it.
    const injector: Injector = Injector.create({
      providers: [
        { provide: TAB_SCOPE, useValue: { injector: scope, scoped: WORKSPACE_VIEW_SCOPE } },
      ],
    });
    this.container.createEmbeddedView(this.template, undefined, { injector });
  }

  /**
   * Ends the view's scope when the view goes for good: a removed checkout, or the single view the
   * tab became a container in place of. A move keeps it for the view made in the other window.
   */
  public ngOnDestroy(): void {
    if (!this.kept || this.studioWindows.moving().has(this.appWorkspaceViewScopeTab())) {
      return;
    }
    const tabId: string = this.appWorkspaceViewScopeTab();
    const key: string = this.key();
    // After the view's own teardown, which still reaches what the scope holds.
    queueMicrotask((): void => this.tabScopes.endPart(tabId, key));
  }
}
