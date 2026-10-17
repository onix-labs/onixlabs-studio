import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { Agent } from '@shared/angular/services/agent/agent';
import { formatCost } from '@shared/angular/services/agent/token-format';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';

/**
 * Mission Control's status-strip readout (#882): totals across every agent in the app, at the end of
 * the strip. First how many agents there are — always shown, so it is the last to drop out of a narrow
 * strip — then, each only while it applies, how many are working, how many are waiting on an answer,
 * and what they have cost together — counting only agents on a connection billed by the token, since a
 * subscription is a flat fee whatever its provider reports a turn would have cost. The tiles say which
 * agent is which; this is the sum.
 *
 * Waiting is read as the Mission Control rail reads it — from the outstanding requests — and an agent
 * waiting is not also counted as working, so the two counts never overlap.
 */
@Component({
  selector: 'app-mission-control-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionControlStatusStrip {
  /**
   * Holds every agent in the app.
   */
  private readonly agentHosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds the questions agents are waiting on the user to answer.
   */
  private readonly agentRequests: AgentRequests = inject(AgentRequests);

  /**
   * Gets the end-aligned segments: the agent count, then the working and waiting counts and the total
   * cost, each while it applies.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const hosts: readonly AgentHost[] = this.agentHosts.hosts();
      const waiting: ReadonlySet<Agent> = new Set<Agent>(
        this.agentRequests.entries().map((entry: AgentRequestEntry): Agent => entry.agent),
      );
      let working: number = 0;
      let waitingCount: number = 0;
      let cost: number = 0;
      for (const host of hosts) {
        if (waiting.has(host.agent)) {
          waitingCount += 1;
        } else if (host.agent.isRunning()) {
          working += 1;
        }
        // Spend only from connections billed by the token: a subscription's reported cost is notional.
        if (host.agent.billedPerToken()) {
          cost += host.agent.costUsd();
        }
      }
      const segments: StatusSegment[] = [
        { id: 'mission-agents', text: hosts.length === 1 ? '1 agent' : `${hosts.length} agents` },
      ];
      if (working > 0) {
        segments.push({ id: 'mission-working', text: `${working} working` });
      }
      if (waitingCount > 0) {
        segments.push({ id: 'mission-waiting', text: `${waitingCount} waiting for you` });
      }
      if (cost > 0) {
        segments.push({
          id: 'mission-cost',
          text: formatCost(cost),
          title: 'What every agent has cost together',
        });
      }
      return segments;
    },
  );
}
