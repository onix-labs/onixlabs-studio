import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { GlobalPermissionsPanel } from './global-permissions-panel/global-permissions-panel';
import { MissionControlAgentTile } from './mission-control-agent-tile/mission-control-agent-tile';

/**
 * The Mission Control feature view: a single place to manage every open tab's agent. A left
 * {@link GlobalPermissionsPanel} aggregates and answers pending agent requests from every tab; the
 * main area is a horizontally-scrolling row of {@link MissionControlAgentTile}s, one per open tab
 * (excluding Mission Control and Settings themselves), each an isolated conversation scoped to that
 * tab's context. The view, tiles, and contextual ribbon coordinate through the app-level
 * {@link MissionControl} singleton.
 */
@Component({
  selector: 'app-mission-control-view',
  imports: [PanelLayout, Panel, GlobalPermissionsPanel, MissionControlAgentTile],
  templateUrl: './mission-control-view.html',
  styleUrl: './mission-control-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionControlView {
  /**
   * Holds the tab registry the agent columns are drawn from.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Gets the identifier of the Mission Control tab.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the Mission Control tab is the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the open tabs that get an agent column: every tab except Mission Control itself and the
   * Settings tab, which have no agent.
   */
  protected readonly agentTabs: Signal<readonly Tab[]> = computed((): readonly Tab[] =>
    this.tabs
      .tabs()
      .filter((tab: Tab): boolean => tab.type !== 'mission-control' && tab.type !== 'settings'),
  );
}
