import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AiPermissionPosture } from '@shared/api/ai-types';
import type { Agent } from '@shared/angular/services/agent/agent';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { AgentRequestCard } from '@shared/angular/components/agent-request-card/agent-request-card';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';
import { SettingsNavigation } from '@shared/angular/services/settings-navigation/settings-navigation';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { MissionControlTiles } from '../mission-control-tiles';

/**
 * The two tabs of the Mission Control panel: the live agent rail, and the (part-draft) settings mirror.
 */
type PanelTab = 'agents' | 'settings';

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
 * An illustrative standing rule shown on the (draft) Settings tab. The rule store is not yet exposed to
 * the renderer, so these are static previews of the model we are moving toward.
 */
interface RulePreview {
  /**
   * Gets whether the rule allows or denies.
   */
  readonly mode: 'allow' | 'deny';

  /**
   * Gets the rule's title.
   */
  readonly title: string;

  /**
   * Gets the rule's pattern or scope detail.
   */
  readonly detail: string;
}

/**
 * The Mission Control left column: a live rail of every agent alongside the columns it drives. The
 * **Agents** tab lists one row per live {@link AgentHost} (the same set the columns mirror); clicking a
 * row scrolls its column into view, and a row hosts that agent's pending requests inline so a permission
 * can be answered without hunting for the column. When the "show permissions at the top" setting is on,
 * agents awaiting a request float to the top of the list (the columns keep their order). Requests from
 * an agent with no column fall into an "Other requests" group so none are ever dropped. The **Settings**
 * tab mirrors the permission settings (a live policy-mode selector plus a draft rules preview) as a
 * mini-panel; the header gear deep-links to the full Mission Control settings category.
 */
@Component({
  selector: 'app-mission-control-panel',
  imports: [AppIcon, AgentRequestCard, Dropdown],
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
   * Holds the settings service backing the policy-mode selector and the reorder preference.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the settings deep-link seam, so the gear opens the Mission Control settings category.
   */
  private readonly settingsNavigation: SettingsNavigation = inject(SettingsNavigation);

  /**
   * Holds the currently selected tab of the panel.
   */
  protected readonly activeTab: WritableSignal<PanelTab> = signal<PanelTab>('agents');

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
      const count: number = host.agent.items().length;
      const tabIcon: Icon | undefined =
        host.tabId === null ? undefined : this.tabs.get(host.tabId)?.icon;
      return {
        id: host.id,
        label: host.label(),
        icon: tabIcon ?? Icon.AGENT,
        statusLabel: running ? 'Working' : count > 0 ? 'Idle' : 'Ready',
        isRunning: running,
        entries: byAgent.get(host.agent) ?? [],
      };
    });
  });

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
   * Gets the total number of pending requests, driving the Agents tab badge.
   */
  protected readonly requestCount: Signal<number> = this.agentRequests.count;

  /**
   * Gets the draft standing rules previewed on the Settings tab.
   */
  protected readonly rules: readonly RulePreview[] = [
    { mode: 'allow', title: 'Allow file read', detail: '**/*.cs, **/*.md' },
    { mode: 'allow', title: 'Allow terminal', detail: 'dotnet build, dotnet test' },
    { mode: 'deny', title: 'Deny file write', detail: '**/bin/**, **/obj/**' },
    { mode: 'deny', title: 'Deny network', detail: 'api.openai.com' },
  ];

  /**
   * Gets the project-scope options previewed on the Settings tab.
   */
  protected readonly scopeOptions: readonly DropdownOption[] = [
    { value: 'all', label: 'Applies to all projects' },
    { value: 'active', label: 'Applies to the active project' },
  ];

  /**
   * Gets the policy-mode options, matching the global permission posture setting.
   */
  protected readonly policyOptions: readonly DropdownOption[] = [
    { value: 'prompt', label: 'Prompt' },
    { value: 'auto-edits', label: 'Auto-allow edits' },
    { value: 'auto-all', label: 'Auto-allow everything' },
  ];

  /**
   * Gets the current policy mode from the global permission posture setting.
   */
  protected readonly policyMode: Signal<AiPermissionPosture> = this.settings.aiPermissionPosture;

  /**
   * Gets the helper text describing the current policy mode.
   */
  protected readonly policyHelp: Signal<string> = computed((): string => {
    switch (this.settings.aiPermissionPosture()) {
      case 'auto-all':
        return 'Agents act without asking. Use with caution.';
      case 'auto-edits':
        return 'Agents apply file edits automatically; other actions still ask.';
      default:
        return 'Agents ask before actions that require approval.';
    }
  });

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
   * Selects a tab of the panel.
   * @param tab The tab to select.
   */
  protected select(tab: PanelTab): void {
    this.activeTab.set(tab);
  }

  /**
   * Scrolls the column for a rail row into view.
   * @param id The host id of the row.
   */
  protected onReveal(id: string): void {
    this.tiles.reveal(id);
  }

  /**
   * Sets the global permission posture from the policy-mode selector.
   * @param value The chosen posture.
   */
  protected onPolicyChange(value: string): void {
    this.settings.setAiPermissionPosture(value as AiPermissionPosture);
  }

  /**
   * Opens the Settings tab at the Mission Control category, where the full configuration lives.
   */
  protected onOpenSettings(): void {
    this.settingsNavigation.open('mission-control');
  }
}
