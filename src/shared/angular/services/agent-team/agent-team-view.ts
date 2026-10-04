import { InjectionToken } from '@angular/core';
import type { TeamWorkerState } from '@shared/api/ai/ai-team-tools';
import type { Agent, AgentItem } from '@shared/angular/services/agent/agent';

/**
 * One worker as the lead's conversation shows it (#788): what it is doing, where, and what — if
 * anything — it is waiting on the user for.
 */
export interface TeamWorkerView {
  /**
   * Gets the worker's id, as the lead's tools name it.
   */
  readonly id: string;

  /**
   * Gets the task's short name.
   */
  readonly title: string;

  /**
   * Gets the branch the worker works on.
   */
  readonly branch: string;

  /**
   * Gets where the worker is in its task.
   */
  readonly state: TeamWorkerState;

  /**
   * Gets what the worker reported — its summary, or why it failed — or null before it reports.
   */
  readonly summary: string | null;

  /**
   * Gets the pull request the worker reported opening, or null.
   */
  readonly pullRequest: string | null;

  /**
   * Gets the worker's agent once its checkout is open, or null before.
   */
  readonly agent: Agent | null;

  /**
   * Gets the oldest request the worker is waiting on the user for, or null when it waits on nothing.
   */
  readonly pending: AgentItem | null;
}

/**
 * What a host offers the agent panel about the team its agent leads (#788). Provided by a host that
 * runs teams — a worktree container — and absent everywhere else, which is what keeps the panel's
 * team strip out of every other conversation.
 */
export interface AgentTeamView {
  /**
   * Gets the workers an agent leads, newest last, read reactively.
   * @param lead The lead's agent.
   * @returns Returns the workers, empty when the agent leads none.
   */
  workersLedBy(lead: Agent): readonly TeamWorkerView[];

  /**
   * Shows a worker's checkout — its files, terminals and its own conversation.
   * @param id The worker's id.
   */
  open(id: string): void;

  /**
   * Stops a worker on the user's behalf; its lead is told.
   * @param id The worker's id.
   */
  stop(id: string): void;
}

/**
 * Carries the {@link AgentTeamView} of the host the panel sits in, when it has one.
 */
export const AGENT_TEAM_VIEW: InjectionToken<AgentTeamView> = new InjectionToken<AgentTeamView>(
  'AGENT_TEAM_VIEW',
);

/**
 * Says in a few words what a pending request asks of the user.
 * @param item The pending transcript item.
 * @returns Returns the description.
 */
export function describeRequest(item: AgentItem): string {
  switch (item.kind) {
    case 'permission':
      return `permission to use ${item.permissionName ?? 'a tool'}${item.permissionDetail ? ` (${item.permissionDetail})` : ''}`;
    case 'input-request':
      return `an answer to "${item.inputQuestion ?? ''}"`;
    default:
      return `a decision on an edit to ${item.decisionName ?? 'a file'}`;
  }
}
