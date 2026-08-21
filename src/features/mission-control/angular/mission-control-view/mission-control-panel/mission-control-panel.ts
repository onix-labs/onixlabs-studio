import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { Agent } from '@shared/angular/services/agent/agent';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { AgentRequestCard } from '@shared/angular/components/agent-request-card/agent-request-card';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PulseDot } from '@shared/angular/components/pulse-dot/pulse-dot';
import { Icon } from '@shared/angular/icons/icon';
import { ListReorder, ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import { Button } from '@shared/angular/components/forms/button/button';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Log } from '@shared/angular/services/log/log';
import { MissionControl } from '@features/mission-control/angular/mission-control/mission-control';
import { MissionControlTiles } from '../mission-control-tiles';

/**
 * A row in the agent rail: one live agent host, its live status, and any requests it is awaiting. Built
 * per change so the label, icon, and status track the host's live signals.
 */
interface RailItem {
  /**
   * Gets the host id, used to scroll the matching tile into view.
   */
  readonly id: string;

  /**
   * Gets the host's display label.
   */
  readonly label: string;

  /**
   * Gets the icon shown beside the label: the origin tab's glyph, or the agent glyph for a host with no
   * owning tab.
   */
  readonly icon: Icon;

  /**
   * Gets the branch the host's project is on, or null for a host with no project behind it (a file,
   * terminal, or binary agent, or a folder that is not a repository).
   */
  readonly branch: string | null;

  /**
   * Gets the run-state label (Working / Idle / Ready).
   */
  readonly statusLabel: string;

  /**
   * Gets whether the host's agent is currently running.
   */
  readonly isRunning: boolean;

  /**
   * Gets the host's pending requests, rendered inline beneath the row.
   */
  readonly entries: readonly AgentRequestEntry[];
}

/**
 * The Mission Control left column: a live rail of every agent alongside the columns it drives. It lists
 * one row per live {@link AgentHost} (the same set the columns mirror); clicking a row scrolls its
 * column into view, and a row hosts that agent's pending requests inline so a permission can be answered
 * without hunting for the column. When the "show permissions at the top" setting is on, agents awaiting
 * a request float to the top of the list (the columns keep their order). Requests from an agent with no
 * column fall into an "Other requests" group so none are ever dropped. Permission configuration is not
 * mirrored here — it lives in the ribbon and in the Mission Control settings category.
 */
@Component({
  selector: 'app-mission-control-panel',
  imports: [Button, AppIcon, PulseDot, AgentRequestCard, ListView],
  templateUrl: './mission-control-panel.html',
  styleUrl: './mission-control-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionControlPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the app-wide live-hosts registry the rail lists.
   */
  private readonly agentHosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds the app-wide agent-requests registry, surfaced inline per agent.
   */
  private readonly agentRequests: AgentRequests = inject(AgentRequests);

  /**
   * Holds the tab registry, used to resolve each host's origin-tab icon.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the view-scoped tile registry, used to scroll a column into view.
   */
  private readonly tiles: MissionControlTiles = inject(MissionControlTiles);

  /**
   * Holds the shared Mission Control view state, backing the per-agent hide toggle.
   */
  private readonly missionControl: MissionControl = inject(MissionControl);

  /**
   * Holds the settings service backing the reorder preference.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the pending requests grouped by their owning agent, so each row surfaces its own.
   */
  private readonly requestsByAgent: Signal<ReadonlyMap<Agent, readonly AgentRequestEntry[]>> =
    computed((): ReadonlyMap<Agent, readonly AgentRequestEntry[]> => {
      const map: Map<Agent, AgentRequestEntry[]> = new Map<Agent, AgentRequestEntry[]>();
      for (const entry of this.agentRequests.entries()) {
        const list: AgentRequestEntry[] = map.get(entry.agent) ?? [];
        list.push(entry);
        map.set(entry.agent, list);
      }
      return map;
    });

  /**
   * Gets the hosts in display order: registration order, or requests-first when the reorder preference
   * is on. The sort is stable, so agents keep their relative order within each group.
   */
  private readonly orderedHosts: Signal<readonly AgentHost[]> = computed(
    (): readonly AgentHost[] => {
      const hosts: readonly AgentHost[] = this.agentHosts.hosts();
      if (!this.settings.missionControlShowPermissionsAtTop()) {
        return hosts;
      }
      const byAgent: ReadonlyMap<Agent, readonly AgentRequestEntry[]> = this.requestsByAgent();
      return [...hosts].sort(
        (a: AgentHost, b: AgentHost): number =>
          this.pendingRank(a, byAgent) - this.pendingRank(b, byAgent),
      );
    },
  );

  /**
   * Gets the agent rail rows, one per live host, in display order.
   */
  protected readonly items: Signal<readonly RailItem[]> = computed((): readonly RailItem[] => {
    const byAgent: ReadonlyMap<Agent, readonly AgentRequestEntry[]> = this.requestsByAgent();
    return this.orderedHosts().map((host: AgentHost): RailItem => {
      const running: boolean = host.agent.isRunning();
      // Read the memoized `hasMessages` boolean, not `items().length`: the rail is always mounted (it
      // survives Mission Control being backgrounded), so depending on every host's transcript length
      // would rebuild the whole rail on every streaming token. The boolean is stable across a run.
      const hasMessages: boolean = host.agent.hasMessages();
      const tabIcon: Icon | undefined =
        host.tabId === null ? undefined : this.tabs.get(host.tabId)?.icon;
      return {
        id: host.id,
        label: host.label(),
        branch: host.branch?.() ?? null,
        icon: tabIcon ?? Icon.AGENT,
        statusLabel: running ? 'Working' : hasMessages ? 'Idle' : 'Ready',
        isRunning: running,
        entries: byAgent.get(host.agent) ?? [],
      };
    });
  });

  /**
   * Gets the agent rail rows mapped to list rows for the shared {@link ListView}.
   */
  protected readonly rows: Signal<readonly ListRow[]> = computed((): readonly ListRow[] =>
    this.items().map((item: RailItem): ListRow => ({ id: item.id, data: item })),
  );

  /**
   * Gets pending requests owned by an agent that has no live column, so they are never dropped from the
   * rail (they render under an "Other requests" group).
   */
  protected readonly orphanEntries: Signal<readonly AgentRequestEntry[]> = computed(
    (): readonly AgentRequestEntry[] => {
      const hosted: ReadonlySet<Agent> = new Set<Agent>(
        this.agentHosts.hosts().map((host: AgentHost): Agent => host.agent),
      );
      return this.agentRequests
        .entries()
        .filter((entry: AgentRequestEntry): boolean => !hosted.has(entry.agent));
    },
  );

  /**
   * Ranks a host for the requests-first sort: 0 when it has a pending request, 1 otherwise.
   * @param host The host to rank.
   * @param byAgent The pending requests grouped by agent.
   * @returns Returns the sort rank.
   */
  private pendingRank(
    host: AgentHost,
    byAgent: ReadonlyMap<Agent, readonly AgentRequestEntry[]>,
  ): number {
    return (byAgent.get(host.agent)?.length ?? 0) > 0 ? 0 : 1;
  }

  /**
   * Unwraps a list row's rail-item payload for the projected row template.
   * @param row The list row.
   * @returns Returns the rail item carried by the row.
   */
  protected itemOf(row: ListRow): RailItem {
    return row.data as RailItem;
  }

  /**
   * Scrolls the column for a clicked (or keyboard-activated) rail row into view. The row id is the
   * host id, which the tile registry keys columns by.
   * @param row The list row that was activated.
   */
  protected onRowClick(row: ListRow): void {
    this.log.debug('mission-control.panel', 'Rail row activated', { host: row.id });
    this.tiles.reveal(row.id);
  }

  /**
   * Gets whether the given agent (by host id) is manually hidden, driving the rail row's hide toggle.
   * @param id The host id.
   * @returns Returns true when the agent's column is hidden.
   */
  protected isHidden(id: string): boolean {
    return this.missionControl.isHostHidden(id);
  }

  /**
   * Toggles whether the given agent's column is hidden, from the rail row's hide button. Stops the
   * click from bubbling to the row so toggling visibility does not also scroll the column into view.
   * @param item The rail item whose column to hide or show.
   * @param event The originating click, whose propagation is stopped.
   */
  protected onToggleHidden(item: RailItem, event: Event): void {
    event.stopPropagation();
    this.log.info('mission-control.panel', 'Toggled agent hide from rail', {
      host: item.id,
      hidden: !this.missionControl.isHostHidden(item.id),
    });
    this.missionControl.toggleHostHidden(item.id);
  }

  /**
   * Applies a drag-reorder of the rail: moves the dragged host to the dropped-on host's position in the
   * shared {@link AgentHosts} order, which the columns read from too, so reordering the rail reorders
   * the horizontally-stacked columns.
   * @param event The reorder describing the moved and target host ids.
   */
  protected onReorder(event: ListReorder): void {
    this.log.info('mission-control.panel', 'Reordered agent rail', {
      from: event.from,
      to: event.to,
    });
    this.agentHosts.reorder(event.from, event.to);
  }
}
