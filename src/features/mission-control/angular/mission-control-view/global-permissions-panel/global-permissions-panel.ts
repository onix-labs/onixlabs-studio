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
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * The two tabs of the Global Permissions panel: the live pending requests, and the (draft) standing
 * rules.
 */
type PermissionsTab = 'requests' | 'rules';

/**
 * A group of pending requests attributed to one source (a tab, or the shared agent panels), for the
 * grouped requests list.
 */
interface RequestGroup {
  /**
   * Gets the source's display label.
   */
  readonly label: string;

  /**
   * Gets the identifier of the source tab, or null for the shared agent panels, so the group can be
   * activated.
   */
  readonly tabId: string | null;

  /**
   * Gets the pending requests belonging to the source.
   */
  readonly entries: readonly AgentRequestEntry[];
}

/**
 * An illustrative standing rule shown on the (draft) Rules tab. The rule store is not yet exposed to
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
 * The Mission Control left column: one place to see and answer every open tab's pending agent
 * requests (permissions, questions, edit decisions), mirroring the title strip's inbox but as a
 * persistent panel. The Requests tab is live — it reads the app-wide {@link AgentRequests} registry
 * and answers drive the same methods on the same transcript items, so the origin tab settles too. The
 * Rules tab is a draft: standing allow/deny rules and a project scope are previewed here (the backing
 * store is not yet exposed to the renderer), while the Policy mode selector below is wired to the real
 * global permission posture setting.
 */
@Component({
  selector: 'app-global-permissions-panel',
  imports: [AppIcon, Dropdown],
  templateUrl: './global-permissions-panel.html',
  styleUrl: './global-permissions-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalPermissionsPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the app-wide agent-requests registry the panel surfaces.
   */
  private readonly agentRequests: AgentRequests = inject(AgentRequests);

  /**
   * Holds the tab registry, used to attribute and activate requests.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the settings service backing the policy-mode selector.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the currently selected tab of the panel.
   */
  protected readonly activeTab: WritableSignal<PermissionsTab> = signal<PermissionsTab>('requests');

  /**
   * Gets the pending requests grouped by their source, so each renders under its tab's heading.
   */
  protected readonly requestGroups: Signal<readonly RequestGroup[]> = computed(
    (): readonly RequestGroup[] => {
      const byTab: Map<string, AgentRequestEntry[]> = new Map<string, AgentRequestEntry[]>();
      const unattributed: AgentRequestEntry[] = [];
      for (const entry of this.agentRequests.entries()) {
        if (entry.tabId === null) {
          unattributed.push(entry);
        } else {
          const list: AgentRequestEntry[] = byTab.get(entry.tabId) ?? [];
          list.push(entry);
          byTab.set(entry.tabId, list);
        }
      }

      const groups: RequestGroup[] = [];
      for (const tab of this.tabs.tabs()) {
        const entries: AgentRequestEntry[] | undefined = byTab.get(tab.id);
        if (entries !== undefined && entries.length > 0) {
          groups.push({ label: tab.title, tabId: tab.id, entries });
        }
      }
      if (unattributed.length > 0) {
        groups.push({ label: 'Agent panels', tabId: null, entries: unattributed });
      }
      return groups;
    },
  );

  /**
   * Gets the total number of pending requests.
   */
  protected readonly requestCount: Signal<number> = this.agentRequests.count;

  /**
   * Gets the draft standing rules previewed on the Rules tab.
   */
  protected readonly rules: readonly RulePreview[] = [
    { mode: 'allow', title: 'Allow file read', detail: '**/*.cs, **/*.md' },
    { mode: 'allow', title: 'Allow terminal', detail: 'dotnet build, dotnet test' },
    { mode: 'deny', title: 'Deny file write', detail: '**/bin/**, **/obj/**' },
    { mode: 'deny', title: 'Deny network', detail: 'api.openai.com' },
  ];

  /**
   * Gets the project-scope options previewed on the Rules tab.
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
   * Selects a tab of the panel.
   * @param tab The tab to select.
   */
  protected select(tab: PermissionsTab): void {
    this.activeTab.set(tab);
  }

  /**
   * Renders the heading line of a request entry: what kind of request it is.
   * @param entry The request entry.
   * @returns Returns the heading.
   */
  protected requestHeading(entry: AgentRequestEntry): string {
    switch (entry.item.kind) {
      case 'permission':
        return `Allow ${entry.item.permissionName ?? 'a tool'}?`;
      case 'edit-decision':
        return `Apply an edit to ${entry.item.decisionName ?? 'a document'}?`;
      default:
        return entry.item.inputQuestion ?? 'The agent has a question.';
    }
  }

  /**
   * Answers a permission request (a one-off grant or denial).
   * @param entry The request entry.
   * @param granted Whether the user granted permission.
   */
  protected onPermission(entry: AgentRequestEntry, granted: boolean): void {
    entry.agent.respondPermission(entry.item, granted);
  }

  /**
   * Answers an edit decision.
   * @param entry The request entry.
   * @param choice The decision.
   */
  protected onEditDecision(entry: AgentRequestEntry, choice: 'yes' | 'yes-auto' | 'no'): void {
    entry.agent.respondEditDecision(entry.item, choice);
  }

  /**
   * Answers a question with one of its choices, or declines it.
   * @param entry The request entry.
   * @param answer The chosen answer, or null to decline.
   */
  protected onAnswer(entry: AgentRequestEntry, answer: string | null): void {
    entry.agent.respondInput(entry.item, answer);
  }

  /**
   * Activates the tab hosting a request group, so it can be handled in context.
   * @param group The request group.
   */
  protected onActivate(group: RequestGroup): void {
    if (group.tabId !== null) {
      this.tabs.activate(group.tabId);
    }
  }

  /**
   * Sets the global permission posture from the policy-mode selector.
   * @param value The chosen posture.
   */
  protected onPolicyChange(value: string): void {
    this.settings.setAiPermissionPosture(value as AiPermissionPosture);
  }

  /**
   * Opens the settings tab, where the full agent-permission configuration lives.
   */
  protected onOpenSettings(): void {
    this.tabs.open('settings');
  }
}
