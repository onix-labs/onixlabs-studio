import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { TeamWorkerState } from '@shared/api/ai/ai-team-tools';
import { Icon } from '@shared/angular/icons/icon';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import {
  AGENT_TEAM_VIEW,
  AgentTeamView,
  describeRequest,
  TeamWorkerView,
} from '@shared/angular/services/agent-team/agent-team-view';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';

/**
 * What the strip shows for each worker state: its label and glyph, and whether the glyph spins.
 */
const STATE_DISPLAY: Readonly<
  Record<TeamWorkerState, { readonly label: string; readonly icon: Icon; readonly spin: boolean }>
> = {
  starting: { label: 'Starting', icon: Icon.SPINNER, spin: true },
  working: { label: 'Working', icon: Icon.SPINNER, spin: true },
  input_required: { label: 'Needs you', icon: Icon.WARNING_FILL, spin: false },
  idle: { label: 'Idle', icon: Icon.PAUSE, spin: false },
  completed: { label: 'Done', icon: Icon.CHECK, spin: false },
  failed: { label: 'Failed', icon: Icon.ERROR, spin: false },
  cancelled: { label: 'Stopped', icon: Icon.STOP, spin: false },
};

/**
 * The workers the conversation's agent leads (#788), shown above its transcript: one row each, with
 * its task, branch and state — and, when it waits on the user, what for, answerable in place for a
 * permission and one click from its own conversation otherwise.
 *
 * ⛔ The user answers a worker's request here or in the worker's own conversation; the lead never
 * answers for them. Answering here drives the worker's own transcript item, so both places settle.
 *
 * Renders nothing outside a host that runs teams, or while the agent leads no workers.
 */
@Component({
  selector: 'app-agent-team-strip',
  imports: [AppIcon, Button],
  templateUrl: './agent-team-strip.html',
  styleUrl: './agent-team-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentTeamStrip {
  /**
   * Holds the icon set, for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the host's team, or null where there is none.
   */
  private readonly team: AgentTeamView | null = inject(AGENT_TEAM_VIEW, { optional: true });

  /**
   * Holds the conversation's agent: the lead whose workers are shown.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Gets the workers the agent leads.
   */
  protected readonly workers: Signal<readonly TeamWorkerView[]> = computed(
    (): readonly TeamWorkerView[] => this.team?.workersLedBy(this.agent) ?? [],
  );

  /**
   * Gets how many workers wait on the user, for the heading.
   */
  protected readonly waiting: Signal<number> = computed(
    (): number =>
      this.workers().filter((worker: TeamWorkerView): boolean => worker.pending !== null).length,
  );

  /**
   * Gets how a worker's state is shown.
   * @param worker The worker.
   * @returns Returns the label, glyph and spin.
   */
  protected display(worker: TeamWorkerView): {
    readonly label: string;
    readonly icon: Icon;
    readonly spin: boolean;
  } {
    return STATE_DISPLAY[worker.state];
  }

  /**
   * Gets the line beneath a worker's title: what it waits on, else what it reported, else nothing —
   * the title line already carries its state and branch.
   * @param worker The worker.
   * @returns Returns the line, or null for none.
   */
  protected detail(worker: TeamWorkerView): string | null {
    if (worker.pending !== null) {
      return `Waiting on you for ${describeRequest(worker.pending)}`;
    }
    return worker.summary;
  }

  /**
   * Determines whether a worker's pending request is a permission, which is answered in place.
   * @param worker The worker.
   * @returns Returns true for a pending permission.
   */
  protected isPermission(worker: TeamWorkerView): boolean {
    return worker.pending?.kind === 'permission';
  }

  /**
   * Determines whether a worker is still running its task.
   * @param worker The worker.
   * @returns Returns true until it completes, fails or is stopped.
   */
  protected isActive(worker: TeamWorkerView): boolean {
    return (
      worker.state !== 'completed' && worker.state !== 'failed' && worker.state !== 'cancelled'
    );
  }

  /**
   * Answers a worker's pending permission for this one use.
   * @param worker The worker.
   * @param granted Whether the user allows it.
   */
  protected respond(worker: TeamWorkerView, granted: boolean): void {
    const item: AgentItem | null = worker.pending;
    if (item !== null && worker.agent !== null) {
      worker.agent.respondPermission(item, granted);
    }
  }

  /**
   * Shows a worker's checkout and its own conversation.
   * @param worker The worker.
   */
  protected open(worker: TeamWorkerView): void {
    this.team?.open(worker.id);
  }

  /**
   * Stops a worker.
   * @param worker The worker.
   */
  protected stop(worker: TeamWorkerView): void {
    this.team?.stop(worker.id);
  }
}
