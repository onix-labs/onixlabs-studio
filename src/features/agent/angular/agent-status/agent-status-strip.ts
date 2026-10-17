import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentPhase } from '@shared/angular/services/agent/agent-controls';
import { formatCost, formatTokens } from '@shared/angular/services/agent/token-format';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { AiModelInfo } from '@shared/api/ai/ai-provider-types';

/**
 * The words each conversation phase is reported in, for the phases worth reporting: an idle or empty
 * conversation has nothing to say.
 */
const PHASE_LABELS: Partial<Record<AgentPhase, string>> = {
  working: 'Working',
  waiting: 'Waiting for you',
};

/**
 * The Agent tab's status-strip readout (#882). On the left, what is answering: the connection, then
 * the model. On the right, what is going on, most telling first so a narrow strip keeps it longest:
 * whether a turn is running or waiting on the user, the mode, how much of the context window the
 * conversation fills, what it has cost (on a connection billed by the token — a subscription's flat fee
 * has no per-turn cost, whatever the provider reports), and any background tasks.
 * Read-only, like every segment of the window strip; the ribbon is where these are chosen.
 *
 * Mounted by the status strip through the active agent view's injector, so it reads that tab's own
 * {@link Agent}; it is destroyed when another tab is activated.
 */
@Component({
  selector: 'app-agent-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentStatusStrip {
  /**
   * Holds the owning tab's agent.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Gets the start-aligned segments: the connection, then the model.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const connection: string | null = this.agent.providerLabel();
      if (connection === null) {
        return [];
      }
      const id: string = this.agent.model();
      const model: AiModelInfo | undefined = this.agent
        .models()
        .find((candidate: AiModelInfo): boolean => candidate.id === id);
      const segments: StatusSegment[] = [
        {
          id: 'agent-connection',
          text: connection,
          title: `Connection: ${connection}`,
          shrink: 'end',
        },
      ];
      if (model !== undefined) {
        segments.push({ id: 'agent-model', text: model.label, title: `Model: ${model.label}` });
      }
      return segments;
    },
  );

  /**
   * Gets the end-aligned segments: the phase while not idle, the mode, the context in use, the cost
   * when reported, and the background tasks while there are any.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const segments: StatusSegment[] = [];
      const phase: string | undefined = PHASE_LABELS[this.agent.phase()];
      if (phase !== undefined) {
        segments.push({ id: 'agent-phase', text: phase });
      }
      segments.push({
        id: 'agent-mode',
        text: this.agent.mode() === 'chat' ? 'Chat mode' : 'Agent mode',
      });
      const used: number = this.agent.contextTokens();
      const window: number = this.agent.contextWindow();
      if (window > 0) {
        const percent: number = Math.round((used / window) * 100);
        segments.push({
          id: 'agent-context',
          text: `${formatTokens(used)} / ${formatTokens(window)} tokens (${percent}%)`,
          title: 'Context window in use',
        });
      }
      // Spend only for a connection billed by the token: a subscription's reported cost is notional.
      const cost: number = this.agent.billedPerToken() ? this.agent.costUsd() : 0;
      if (cost > 0) {
        segments.push({
          id: 'agent-cost',
          text: formatCost(cost),
          title: 'Cost of this conversation',
        });
      }
      const tasks: number = this.agent.visibleTaskCount();
      if (tasks > 0) {
        segments.push({
          id: 'agent-tasks',
          text: tasks === 1 ? '1 task running' : `${tasks} tasks running`,
        });
      }
      return segments;
    },
  );
}
