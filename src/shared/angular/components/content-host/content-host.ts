import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, Injector, Signal } from '@angular/core';
import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { Tab } from '@shared/angular/services/tabs/tab';
import {
  TAB_SCOPE,
  TabScopedProviders,
  TabScopes,
} from '@shared/angular/services/tab-scopes/tab-scopes';
import { SHELL_WINDOW, Tabs } from '@shared/angular/services/tabs/tabs';
import { DocumentConflictModal } from '@shared/angular/components/document-conflict-modal/document-conflict-modal';

/**
 * Represents the content area that hosts the view for every open tab.
 *
 * Every open tab is mounted at once and inactive tabs are hidden rather than destroyed, so that
 * view state (editor undo history, scroll position, terminal sessions) survives tab switches.
 */
@Component({
  selector: 'app-content-host',
  imports: [NgComponentOutlet, DocumentConflictModal],
  templateUrl: './content-host.html',
  styleUrl: './content-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentHost {
  /**
   * Holds the registry of feature views, consulted first so a migrated feature's view is mounted
   * from its own descriptor. Tab types with no registered feature fall back to the static switch
   * until they are migrated.
   */
  protected readonly registry: FeatureRegistry = inject(FeatureRegistry);

  /**
   * Holds the tab registry whose views are rendered.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the Studio window this belongs to, whose tabs it shows (#1587).
   */
  private readonly windowId: string = inject(SHELL_WINDOW);

  /**
   * Gets this window's open tabs, in order.
   */
  protected readonly tabs: Signal<readonly Tab[]> = this.tabsService.tabsIn(this.windowId);

  /**
   * Gets the identifier of this window's active tab, or undefined when it has none.
   */
  protected readonly activeTabId: Signal<string | undefined> = this.tabsService.activeTabIdIn(
    this.windowId,
  );

  /**
   * Holds the tab scopes, so a view is handed its tab's whichever window shows it (#1587).
   */
  private readonly tabScopes: TabScopes = inject(TabScopes);

  /**
   * Holds this host's injector, the parent of each view's.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the injector each view is made under, by tab id, so a view is not re-created for a new one.
   */
  private readonly injectors: Map<string, Injector> = new Map<string, Injector>();

  /**
   * Gets the injector a tab's view is made under: one carrying its tab's scope, when its kind keeps
   * one, so what the tab holds outlives the view (#1587).
   * @param tab The tab.
   * @returns Returns the injector.
   */
  protected injectorFor(tab: Tab): Injector {
    let injector: Injector | undefined = this.injectors.get(tab.id);
    if (injector === undefined) {
      const scoped: TabScopedProviders | undefined = this.registry.tabScopeFor(tab.type);
      injector =
        scoped === undefined
          ? this.injector
          : Injector.create({
              providers: [
                { provide: TAB_SCOPE, useValue: this.tabScopes.scopeFor(tab.id, scoped) },
              ],
              parent: this.injector,
            });
      this.injectors.set(tab.id, injector);
    }
    // Forget the injectors of tabs that have left this window.
    const shown: ReadonlySet<string> = new Set<string>(
      this.tabs().map((each: Tab): string => each.id),
    );
    for (const tabId of [...this.injectors.keys()]) {
      if (!shown.has(tabId)) {
        this.injectors.delete(tabId);
      }
    }
    return injector;
  }
}
