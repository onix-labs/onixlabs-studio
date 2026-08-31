import { computed, effect, inject, Service, Signal, untracked } from '@angular/core';
import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { Log } from '@shared/angular/services/log/log';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Lights the attention dot on any tab whose agent is waiting on the user, from the app-wide pending
 * requests registry.
 *
 * One bridge for every surface, rather than each chat lighting its own tab. A conversation's chat
 * panel is a dock tool that is torn down when another tool activates, and several surfaces never told
 * their chat which tab they were in at all — so a per-chat effect lit the dot for some tab types,
 * lit it and never cleared it for others, and did nothing for the rest. The requests registry already
 * knows every live conversation and the tab that owns it (a view registers up front, for the tab's
 * whole life), which makes it the one place the answer is complete.
 *
 * The active tab is excluded: its conversation is on screen, so the ask is already in front of the
 * user and a dot on the tab they are looking at says nothing.
 */
@Service()
export class AgentTabAttention {
  /**
   * Holds the app-wide pending-requests registry the dots are driven from.
   */
  private readonly requests: AgentRequests = inject(AgentRequests);

  /**
   * Holds the tab registry the attention claim is raised on.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the tabs this bridge has marked, so it clears its own marks and nothing else. The registry
   * drops a tab's entries the moment its conversation unregisters, which would otherwise leave a
   * closed-over dot lit with nothing left to clear it.
   */
  private marked: ReadonlySet<string> = new Set<string>();

  /**
   * Gets the tabs that should be showing an agent dot: those with a pending ask, less the active one.
   */
  private readonly waitingTabs: Signal<ReadonlySet<string>> = computed((): ReadonlySet<string> => {
    const active: string | undefined = this.tabs.activeTabId();
    return new Set<string>(
      [...this.requests.tabIds()].filter((id: string): boolean => id !== active),
    );
  });

  /**
   * Keeps each tab's agent claim in step with the asks waiting on it.
   */
  private readonly sync: ReturnType<typeof effect> = effect((): void => {
    const waiting: ReadonlySet<string> = this.waitingTabs();
    untracked((): void => {
      for (const id of this.marked) {
        if (!waiting.has(id)) {
          this.tabs.setAttention(id, 'agent', false);
        }
      }
      for (const id of waiting) {
        if (!this.marked.has(id)) {
          this.tabs.setAttention(id, 'agent', true);
          this.log.trace('AgentTabAttention', 'Tab is waiting on the user', id);
        }
      }
      this.marked = waiting;
    });
  });
}
