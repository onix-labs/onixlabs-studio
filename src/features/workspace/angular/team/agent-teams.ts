import { inject, Service } from '@angular/core';
import type { AiBridgeScope } from '@shared/api/ai-types';
import {
  TEAM_COMPLETE_TASK,
  TEAM_FAIL_TASK,
  TEAM_INSTRUCT_WORKER,
  TEAM_POST_TO_BOARD,
  TEAM_READ_BOARD,
  TEAM_START_WORKER,
  TEAM_STOP_WORKER,
  TEAM_WORKER_STATUS,
  TeamToolReply,
} from '@shared/api/ai/ai-team-tools';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';

/**
 * The capabilities the team tools reach, one per tool.
 */
const TEAM_CAPABILITIES: readonly string[] = [
  TEAM_START_WORKER,
  TEAM_WORKER_STATUS,
  TEAM_INSTRUCT_WORKER,
  TEAM_STOP_WORKER,
  TEAM_READ_BOARD,
  TEAM_POST_TO_BOARD,
  TEAM_COMPLETE_TASK,
  TEAM_FAIL_TASK,
];

/**
 * What the registry needs of a team.
 */
export interface TeamEndpoint {
  /**
   * Determines whether a run's workspace root is one of the team's checkouts.
   * @param root The run's stamped workspace root.
   * @returns Returns true when the run belongs to the team.
   */
  owns(root: string | null): boolean;

  /**
   * Answers a team tool's request.
   * @param capability The tool's name.
   * @param input The tool's input, untrusted.
   * @param scope The calling run's stamped scope.
   * @returns Returns what the model is told.
   */
  handle(capability: string, input: unknown, scope: AiBridgeScope): Promise<TeamToolReply>;
}

/**
 * Routes the team tools' requests to the team they belong to (#788).
 *
 * A capability has one handler app-wide, but every worktree container has a team of its own; the
 * request's stamped workspace root — the calling agent's checkout, set by the main process from the
 * run's own request — says which. A run in no container reaches no team.
 */
@Service()
export class AgentTeams {
  /**
   * Holds the open teams.
   */
  private readonly teams: Set<TeamEndpoint> = new Set<TeamEndpoint>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Initializes a new instance of the {@link AgentTeams} class, registering the team capabilities.
   */
  public constructor() {
    const runtime: AiRuntime = inject(AiRuntime);
    for (const capability of TEAM_CAPABILITIES) {
      runtime.registerCapability(
        capability,
        (input: unknown, scope: AiBridgeScope): Promise<TeamToolReply> =>
          this.route(capability, input, scope),
      );
    }
  }

  /**
   * Adds a team to the registry.
   * @param team The team.
   * @returns Returns a function that removes it.
   */
  public join(team: TeamEndpoint): () => void {
    this.teams.add(team);
    return (): void => {
      this.teams.delete(team);
    };
  }

  /**
   * Hands a request to the team that owns the calling run.
   * @param capability The tool's name.
   * @param input The tool's input.
   * @param scope The calling run's stamped scope.
   * @returns Returns what the model is told.
   */
  private route(capability: string, input: unknown, scope: AiBridgeScope): Promise<TeamToolReply> {
    for (const team of this.teams) {
      if (team.owns(scope.workspaceRoot)) {
        return team.handle(capability, input, scope);
      }
    }
    this.log.warn('AgentTeams', `${capability} from a run in no team`, scope.workspaceRoot);
    return Promise.resolve({
      ok: false,
      text: 'This agent is not in a worktree container, so it has no team.',
    });
  }
}
