import { effect, inject, Service } from '@angular/core';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Notifications } from './notifications';

/**
 * Bridges pending agent requests into toasts, behind the `notifications.agentRequestToasts`
 * setting. The toast is a pointer, not an answering surface: answering stays in the requests inbox
 * and the conversation, and the toast's Show action jumps to the asking tab.
 *
 * The bridge is reactive to the pending entries, the setting, and the active tab: an ask whose
 * conversation is on screen (its own tab, or Mission Control) stays silent, switching away while it
 * still waits raises its toast, and switching back — or answering it anywhere — retracts it.
 */
@Service()
export class AgentRequestToasts {
  /**
   * Holds the app-wide pending-requests registry the bridge observes.
   */
  private readonly requests: AgentRequests = inject(AgentRequests);

  /**
   * Holds the notification store the asks are raised to.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the settings store, read for the ask-toast toggle.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the tab registry, consulted for the active tab and driven by a toast's Show action.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the entry keys currently surfaced as toasts, so a settled or re-covered ask retracts its
   * toast and a manually dismissed toast is not raised again while its ask still waits.
   */
  private readonly raised: Set<string> = new Set<string>();

  /**
   * Keeps the toast set in step with the pending asks that deserve one.
   */
  private readonly sync: ReturnType<typeof effect> = effect((): void => {
    const wanted: ReadonlyMap<string, AgentRequestEntry> = this.wantedEntries();
    for (const key of [...this.raised]) {
      if (!wanted.has(key)) {
        this.raised.delete(key);
        this.notifications.dismissByKey(`agent-ask:${key}`);
      }
    }
    for (const [key, entry] of wanted) {
      if (!this.raised.has(key)) {
        this.raised.add(key);
        this.raise(entry);
      }
    }
  });

  /**
   * Collects the pending asks that should be surfaced right now: the feature is enabled and the
   * ask's conversation is not already on screen.
   * @returns Returns the deserving entries, keyed by entry key.
   */
  private wantedEntries(): ReadonlyMap<string, AgentRequestEntry> {
    const wanted: Map<string, AgentRequestEntry> = new Map<string, AgentRequestEntry>();
    if (!this.settings.value('notifications.agentRequestToasts')()) {
      return wanted;
    }
    const active: Tab | undefined = this.tabs.activeTab();
    if (active?.type === 'mission-control') {
      return wanted;
    }
    for (const entry of this.requests.entries()) {
      if (entry.tabId === null || entry.tabId !== active?.id) {
        wanted.set(entry.key, entry);
      }
    }
    return wanted;
  }

  /**
   * Raises the toast for a pending ask.
   * @param entry The pending request entry.
   */
  private raise(entry: AgentRequestEntry): void {
    const tabId: string | null = entry.tabId;
    this.notifications.notify({
      severity: 'info',
      title: `Agent asks — ${entry.label}`,
      detail: this.heading(entry),
      sticky: true,
      route: 'toast-only',
      key: `agent-ask:${entry.key}`,
      actions:
        tabId === null ? [] : [{ label: 'Show', run: (): void => this.tabs.activate(tabId) }],
    });
  }

  /**
   * Renders the one-line description of what the agent is asking, mirroring the requests inbox.
   * @param entry The pending request entry.
   * @returns Returns the description.
   */
  private heading(entry: AgentRequestEntry): string {
    switch (entry.item.kind) {
      case 'permission':
        return `Allow ${entry.item.permissionName ?? 'a tool'}?`;
      case 'edit-decision':
        return `Apply an edit to ${entry.item.decisionName ?? 'a document'}?`;
      default:
        return entry.item.inputQuestion ?? 'The agent has a question.';
    }
  }
}
