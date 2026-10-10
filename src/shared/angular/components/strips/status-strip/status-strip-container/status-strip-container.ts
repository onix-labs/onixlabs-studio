import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  Signal,
  Type,
} from '@angular/core';
import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { Tab, TAB_TYPE_METADATA, TabTypeMetadata } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ViewInjectors } from '@shared/angular/services/view-injectors/view-injectors';
import { StatusStripLspMenu } from '../status-strip-lsp-menu/status-strip-lsp-menu';
import { StatusStripNotificationsMenu } from '../status-strip-notifications-menu/status-strip-notifications-menu';
import { StatusStripTasksMenu } from '../status-strip-tasks-menu/status-strip-tasks-menu';
import { StatusStripSegment } from '../status-strip-segment/status-strip-segment';
import { StatusStripSegments } from '../status-strip-segments/status-strip-segments';

/**
 * Represents the status strip, which is split into two regions.
 *
 * The **view region** belongs wholly to the active tab: the strip mounts the active feature's status
 * component (from its {@link FeatureRegistry} descriptor) through that view's own injector, so the
 * component reads the view's per-tab services directly. Exactly one is mounted at a time and it is
 * destroyed on tab switch, so a view's status cannot linger over another view — the strip always
 * shows the current view, with nothing to clear and no owner keys to collide. The region always opens
 * by naming what kind of tab is active — "Workspace", "Code Editor" (#882) — and a feature that
 * registers no status component shows only that. Every segment is a readout: nothing here is pressed.
 *
 * The **ambient region** shows app-wide state that outlives any one tab — the {@link StatusBar}
 * registry's segments, the language servers running for the active workspace, and the notification
 * centre.
 */
@Component({
  selector: 'app-status-strip-container',
  imports: [
    NgComponentOutlet,
    StatusStripLspMenu,
    StatusStripNotificationsMenu,
    StatusStripTasksMenu,
    StatusStripSegment,
    StatusStripSegments,
  ],
  templateUrl: './status-strip-container.html',
  styleUrl: './status-strip-container.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStripContainer {
  /**
   * Holds the ambient status registry.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the registry the active feature's status component is resolved from.
   */
  private readonly registry: FeatureRegistry = inject(FeatureRegistry);

  /**
   * Holds the tab registry, used to resolve the active tab and its type.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the mounted views' injectors, so the active feature's status component is created inside
   * the view whose state it reports.
   */
  private readonly viewInjectors: ViewInjectors = inject(ViewInjectors);

  /**
   * Gets the active feature's status component, or undefined when the feature contributes none.
   */
  protected readonly viewStatus: Signal<Type<unknown> | undefined> = computed(
    (): Type<unknown> | undefined => this.registry.statusFor(this.tabsService.activeTab()?.type),
  );

  /**
   * Gets the active view's injector, through which its status component is mounted, or null when no
   * view has registered one yet (the first render of a newly opened tab).
   */
  protected readonly viewInjector: Signal<Injector | null> = this.viewInjectors.injectorFor(
    this.tabsService.activeTabId,
  );

  /**
   * Gets the segment naming what kind of tab is active — the same words and icon for every tab of a
   * type, whatever each is titled — or a ready indicator while no tab is open.
   */
  protected readonly kindSegment: Signal<StatusSegment> = computed((): StatusSegment => {
    const activeTab: Tab | undefined = this.tabsService.activeTab();
    if (activeTab === undefined) {
      return { id: 'ready', text: 'Ready' };
    }
    const metadata: TabTypeMetadata = TAB_TYPE_METADATA[activeTab.type];
    return { id: 'tab-kind', text: metadata.kind, icon: metadata.icon };
  });

  /**
   * Gets the segments a feature with no status component of its own contributes: none. The strip's
   * kind segment already says what the tab is, and repeating its title would say nothing more.
   */
  protected readonly fallback: readonly StatusSegment[] = [];

  /**
   * Gets the ambient segments, shown at the end of the strip whichever tab is active.
   */
  protected readonly ambient: Signal<readonly StatusSegment[]> = this.statusBar.segments;
}
