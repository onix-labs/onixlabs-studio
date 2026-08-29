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
import { Icon } from '@shared/angular/icons/icon';
import { Layouts } from '@shared/angular/services/layouts/layouts';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { Tab } from '@shared/angular/services/tabs/tab';
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
 * shows the current view, with nothing to clear and no owner keys to collide. A feature that
 * registers no status component falls back to the tab's title.
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
   * Holds the layout store, so the strip can name the layout the active workspace is showing.
   */
  private readonly layouts: Layouts = inject(Layouts);

  /**
   * Gets the segment naming the layout the active workspace is showing, or null when the active tab
   * is not a workspace. The ribbon's View button reads "Default" whatever the default is called,
   * because a layout name has no length limit and a ribbon face has no room; this is where the name
   * it is actually showing is said. Purely a readout — there is nothing to press.
   */
  protected readonly layoutSegment: Signal<StatusSegment | null> = computed(
    (): StatusSegment | null => {
      const name: string | null = this.layouts.activeName();
      return name === null
        ? null
        : { id: 'layout', text: name, icon: Icon.LAYOUT_PRESET, title: `Layout: ${name}` };
    },
  );

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
   * Gets the fallback leading segments, naming the active tab (or a ready indicator) for a feature
   * that contributes no status component of its own.
   */
  protected readonly fallback: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const activeTab: Tab | undefined = this.tabsService.activeTab();
      return activeTab === undefined
        ? [{ id: 'ready', text: 'Ready' }]
        : [{ id: 'active-tab', text: activeTab.title, icon: activeTab.icon }];
    },
  );

  /**
   * Gets the ambient segments, shown at the end of the strip whichever tab is active.
   */
  protected readonly ambient: Signal<readonly StatusSegment[]> = this.statusBar.segments;
}
