import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { Agent } from '@shared/angular/services/agent/agent';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PulseDot } from '@shared/angular/components/pulse-dot/pulse-dot';
import { Icon } from '@shared/angular/icons/icon';
import { ListReorder, ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import { Button } from '@shared/angular/components/forms/button/button';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Log } from '@shared/angular/services/log/log';
import { MissionControl } from '@features/mission-control/angular/mission-control/mission-control';
import { MissionControlTiles } from '../mission-control-tiles';

/**
 * A row in the agent rail: one live agent host and its live status. Built per change so the label,
 * icon, and status track the host's live signals.
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
   * Gets the run-state label (Waiting / Working / Idle / Ready).
   */
  readonly statusLabel: string;

  /**
   * Gets whether the host's agent is currently running.
   */
  readonly isRunning: boolean;

  /**
   * Gets whether the host's agent has a request awaiting the user, which marks the row.
   */
  readonly isWaiting: boolean;
}

/**
 * The Mission Control left column: a live rail of every agent alongside the columns it drives. It lists
 * one row per live {@link AgentHost} (the same set the columns mirror), in registration order, and
 * clicking a row scrolls its column into view.
 *
 * A row whose agent is waiting on the user is marked in the warning colour, and that is the whole of
 * what the rail says about requests: it points at the column to go to, it does not answer for it.
 * Pending requests were once mirrored here as inline answer cards, with agents awaiting one floated to
 * the top of the list; both were removed, so a request is answered on the agent's own transcript.
 * Permission configuration is not mirrored here either — it lives in the ribbon and in the Mission
 * Control settings category.
 */
@Component({
  selector: 'app-mission-control-panel',
  imports: [Button, AppIcon, PulseDot, ListView],
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
   * Holds the app-wide agent-requests registry, read only to mark the rows that are waiting.
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the agents with a request awaiting the user, so their rows can mark themselves.
   *
   * Membership is compared by content rather than by identity, which matters here: the underlying
   * `entries` recomputes whenever any agent's transcript changes — so on every streaming token — and a
   * set rebuilt at that rate would invalidate {@link items} and redraw the whole rail with it. Holding
   * the previous set while membership is unchanged (almost always) keeps the rail still, for the same
   * reason `hasMessages` is read below as a memoized boolean rather than a transcript length.
   */
  private readonly waitingAgents: Signal<ReadonlySet<Agent>> = computed(
    (): ReadonlySet<Agent> =>
      new Set<Agent>(
        this.agentRequests.entries().map((entry: AgentRequestEntry): Agent => entry.agent),
      ),
    {
      equal: (a: ReadonlySet<Agent>, b: ReadonlySet<Agent>): boolean =>
        a.size === b.size && [...a].every((agent: Agent): boolean => b.has(agent)),
    },
  );

  /**
   * Gets the agent rail rows, one per live host, in registration order — which is the order the
   * columns are stacked in, and the order the rail's own drag-reorder rewrites.
   */
  protected readonly items: Signal<readonly RailItem[]> = computed((): readonly RailItem[] => {
    const waiting: ReadonlySet<Agent> = this.waitingAgents();
    return this.agentHosts.hosts().map((host: AgentHost): RailItem => {
      const running: boolean = host.agent.isRunning();
      // Read the memoized `hasMessages` boolean, not `items().length`: the rail is always mounted (it
      // survives Mission Control being backgrounded), so depending on every host's transcript length
      // would rebuild the whole rail on every streaming token. The boolean is stable across a run.
      const hasMessages: boolean = host.agent.hasMessages();
      const tabIcon: Icon | undefined =
        host.tabId === null ? undefined : this.tabs.get(host.tabId)?.icon;
      // Waiting outranks running in the label: an agent that has stopped to ask is still "running" as
      // far as the session is concerned, so reporting it as Working would name the one state the user
      // cannot act on over the one they can.
      const isWaiting: boolean = waiting.has(host.agent);
      return {
        id: host.id,
        label: host.label(),
        branch: host.branch?.() ?? null,
        icon: tabIcon ?? Icon.AGENT,
        statusLabel: isWaiting ? 'Waiting' : running ? 'Working' : hasMessages ? 'Idle' : 'Ready',
        isRunning: running,
        isWaiting,
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
