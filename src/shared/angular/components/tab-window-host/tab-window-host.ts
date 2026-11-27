// TRIAL (#1593) — throwaway: hosts one title-strip tab's view in a second same-renderer window.
import { DOCUMENT, NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  InjectionToken,
  Signal,
  Type,
} from '@angular/core';
import { ModalBackdropView } from '@shared/angular/components/modal-backdrop/modal-backdrop-view';
import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { ModalBackdrop } from '@shared/angular/services/modal-backdrop/modal-backdrop';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { windowScopedCdkProviders } from '@shared/angular/services/window-scope/window-scope';

/**
 * Describes the window a tab is hosted in.
 */
export interface TabWindowConfig {
  /**
   * Gets the window's document.
   */
  readonly document: Document;

  /**
   * Gets the hosted tab's identifier.
   */
  readonly tabId: string;
}

/**
 * Carries the hosted window's configuration into its host.
 */
export const TAB_WINDOW_CONFIG: InjectionToken<TabWindowConfig> =
  new InjectionToken<TabWindowConfig>('TAB_WINDOW_CONFIG');

/**
 * Hosts one tab's view in a second window, with that window's own document, CDK layer and modal
 * backdrop, as the dock's pop-out host does for panels.
 */
@Component({
  selector: 'app-tab-window-host',
  imports: [NgComponentOutlet, ModalBackdropView],
  template: `
    @if (view(); as v) {
      <div class="tab-view">
        <ng-container *ngComponentOutlet="v; inputs: { tabId: tabId, isActive: true }" />
      </div>
    }
    <app-modal-backdrop />
  `,
  styles: [
    ':host { display: block; position: relative; block-size: 100%; min-block-size: 0; }',
    '.tab-view { block-size: 100%; } .tab-view > * { display: block; block-size: 100%; }',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    ...windowScopedCdkProviders(),
    ModalBackdrop,
    { provide: DOCUMENT, useFactory: (): Document => inject(TAB_WINDOW_CONFIG).document },
  ],
})
export class TabWindowHost {
  /**
   * Holds the registry of feature views.
   */
  private readonly registry: FeatureRegistry = inject(FeatureRegistry);

  /**
   * Holds the tab registry.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Gets the hosted tab's identifier.
   */
  protected readonly tabId: string = inject(TAB_WINDOW_CONFIG).tabId;

  /**
   * Gets the hosted tab's view, or null once the tab is gone.
   */
  protected readonly view: Signal<Type<unknown> | null> = computed((): Type<unknown> | null => {
    const tab: Tab | undefined = this.tabs.tabs().find((each: Tab): boolean => each.id === this.tabId);
    return tab === undefined ? null : (this.registry.viewFor(tab.type) ?? null);
  });
}
