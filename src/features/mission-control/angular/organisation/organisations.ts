import { effect, inject, Service, signal, Signal, untracked, WritableSignal } from '@angular/core';
import {
  ForgeProject,
  ForgeProjects,
} from '@shared/angular/services/forge-projects/forge-projects';
import { Log } from '@shared/angular/services/log/log';
import { OrganisationFiles } from '@shared/angular/services/organisation-files/organisation-files';
import {
  BUILT_IN_ROLES,
  MAX_AGENTS,
  MAX_NAME_LENGTH,
  Organisation,
  OrganisationAgent,
  OrganisationAgentState,
  OrganisationRole,
  OrganisationUser,
} from '@shared/api/organisation';
import { OrganisationSnapshot } from '@shared/api/organisation-channels';

/**
 * One project's organisation, as held in the renderer.
 */
export interface ProjectOrganisation {
  /**
   * Gets a value indicating whether the project's files have been read.
   */
  readonly loaded: boolean;

  /**
   * Gets the committed roster and roles.
   */
  readonly organisation: Organisation;

  /**
   * Gets the per-developer state: assignments and conversations.
   */
  readonly user: OrganisationUser;
}

/**
 * The organisation of a project whose files have not been read: the built-in roles and nobody on the
 * roster.
 */
const UNREAD: ProjectOrganisation = {
  loaded: false,
  organisation: { roles: BUILT_IN_ROLES, agents: [] },
  user: { agents: [] },
};

/**
 * Holds every open project's organisation — its named agents, their roles, and what each is assigned
 * to (epic #788, P2) — and is the one place that changes it.
 *
 * Every change is applied here at once, so the views answer immediately, and then written through the
 * main process, which parses it before writing and returns what it wrote; that sanitised copy replaces
 * the optimistic one. Writes to one project are serialised, so two quick changes cannot land in the
 * wrong order. Files are read as soon as a project opens: they are two small local files, and the
 * organisation is wanted by every face.
 */
@Service()
export class MissionControlOrganisations {
  /**
   * Holds the organisation-file client.
   */
  private readonly files: OrganisationFiles = inject(OrganisationFiles);

  /**
   * Holds the registry of open projects.
   */
  private readonly forgeProjects: ForgeProjects = inject(ForgeProjects);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds each open project's organisation, keyed by project.
   */
  private readonly stateMap: WritableSignal<ReadonlyMap<string, ProjectOrganisation>> = signal<
    ReadonlyMap<string, ProjectOrganisation>
  >(new Map<string, ProjectOrganisation>());

  /**
   * Holds the tail of each project's write queue.
   */
  private readonly writes: Map<string, Promise<void>> = new Map<string, Promise<void>>();

  /**
   * Gets each open project's organisation, keyed by project.
   */
  public readonly states: Signal<ReadonlyMap<string, ProjectOrganisation>> =
    this.stateMap.asReadonly();

  /**
   * Initializes a new instance of the {@link MissionControlOrganisations} class: a project that opens
   * is read, and a project that closes is forgotten.
   */
  public constructor() {
    effect((): void => {
      const projects: readonly ForgeProject[] = this.forgeProjects.projects();
      untracked((): void => {
        const open: ReadonlySet<string> = new Set<string>(
          projects.map((project: ForgeProject): string => project.key),
        );
        const current: ReadonlyMap<string, ProjectOrganisation> = this.stateMap();
        if ([...current.keys()].some((key: string): boolean => !open.has(key))) {
          this.stateMap.set(
            new Map<string, ProjectOrganisation>(
              [...current].filter(([key]: [string, ProjectOrganisation]): boolean => open.has(key)),
            ),
          );
        }
        for (const project of projects) {
          if (!this.stateMap().has(project.key)) {
            void this.load(project);
          }
        }
      });
    });
  }

  /**
   * Gets one project's organisation.
   * @param key The project's key.
   * @returns Returns the organisation; a project not yet read reports the built-in roles and no agents.
   */
  public stateFor(key: string): ProjectOrganisation {
    return this.stateMap().get(key) ?? UNREAD;
  }

  /**
   * Resolves a role on a project.
   * @param key The project's key.
   * @param roleId The role's identifier.
   * @returns Returns the role, or undefined when the project has no such role.
   */
  public roleFor(key: string, roleId: string): OrganisationRole | undefined {
    return this.stateFor(key).organisation.roles.find(
      (role: OrganisationRole): boolean => role.id === roleId,
    );
  }

  /**
   * Gets an agent's per-developer state.
   * @param key The project's key.
   * @param agentId The agent's identifier.
   * @returns Returns the state; an agent with none is unassigned with no conversation.
   */
  public agentState(key: string, agentId: string): OrganisationAgentState {
    return (
      this.stateFor(key).user.agents.find(
        (state: OrganisationAgentState): boolean => state.agentId === agentId,
      ) ?? { agentId, workItem: null, conversationId: null }
    );
  }

  /**
   * Gets the agents assigned to a work item.
   * @param key The project's key.
   * @param workItem The work item's number.
   * @returns Returns the agents, in roster order.
   */
  public assignedTo(key: string, workItem: number): readonly OrganisationAgent[] {
    const project: ProjectOrganisation = this.stateFor(key);
    return project.organisation.agents.filter(
      (agent: OrganisationAgent): boolean => this.agentState(key, agent.id).workItem === workItem,
    );
  }

  /**
   * Hires a named agent onto a project's roster.
   * @param project The project.
   * @param name The agent's name.
   * @param roleId The role the agent holds.
   * @returns Returns the agent, or null when the name is blank, the role unknown, or the roster full.
   */
  public addAgent(project: ForgeProject, name: string, roleId: string): OrganisationAgent | null {
    const current: Organisation = this.stateFor(project.key).organisation;
    const trimmed: string = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
    if (
      trimmed.length === 0 ||
      this.roleFor(project.key, roleId) === undefined ||
      current.agents.length >= MAX_AGENTS
    ) {
      return null;
    }
    const agent: OrganisationAgent = { id: crypto.randomUUID(), name: trimmed, roleId };
    this.log.info('mission-control', 'Agent hired', project.key, agent.id, roleId);
    this.saveOrganisation(project, { ...current, agents: [...current.agents, agent] });
    return agent;
  }

  /**
   * Renames an agent.
   * @param project The project.
   * @param agentId The agent's identifier.
   * @param name The new name; a blank one changes nothing.
   */
  public rename(project: ForgeProject, agentId: string, name: string): void {
    const trimmed: string = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
    if (trimmed.length > 0) {
      this.updateAgent(project, agentId, { name: trimmed });
    }
  }

  /**
   * Moves an agent to another role.
   * @param project The project.
   * @param agentId The agent's identifier.
   * @param roleId The new role; an unknown one changes nothing.
   */
  public setRole(project: ForgeProject, agentId: string, roleId: string): void {
    if (this.roleFor(project.key, roleId) !== undefined) {
      this.updateAgent(project, agentId, { roleId });
    }
  }

  /**
   * Lets an agent go: off the roster, with its assignment and conversation link dropped.
   * @param project The project.
   * @param agentId The agent's identifier.
   */
  public remove(project: ForgeProject, agentId: string): void {
    const state: ProjectOrganisation = this.stateFor(project.key);
    this.log.info('mission-control', 'Agent let go', project.key, agentId);
    this.saveOrganisation(project, {
      ...state.organisation,
      agents: state.organisation.agents.filter(
        (agent: OrganisationAgent): boolean => agent.id !== agentId,
      ),
    });
    this.updateAgentState(project, agentId, { workItem: null, conversationId: null });
  }

  /**
   * Assigns an agent to a work item, moving it off any other; null unassigns it.
   * @param project The project.
   * @param agentId The agent's identifier.
   * @param workItem The work item's number, or null.
   */
  public assign(project: ForgeProject, agentId: string, workItem: number | null): void {
    this.log.info('mission-control', 'Agent assigned', project.key, agentId, workItem);
    this.updateAgentState(project, agentId, { workItem });
  }

  /**
   * Records the conversation an agent is carrying, so it resumes after a restart.
   * @param project The project.
   * @param agentId The agent's identifier.
   * @param conversationId The conversation's identifier, or null to forget it.
   */
  public rememberConversation(
    project: ForgeProject,
    agentId: string,
    conversationId: string | null,
  ): void {
    if (this.agentState(project.key, agentId).conversationId !== conversationId) {
      this.updateAgentState(project, agentId, { conversationId });
    }
  }

  /**
   * Reads a project's organisation files. The views hold changes back until a project is loaded, so
   * nothing applied in the meantime can be overwritten by the read.
   * @param project The project.
   * @returns Returns a promise that resolves once read.
   */
  private async load(project: ForgeProject): Promise<void> {
    const placeholder: ProjectOrganisation = { ...UNREAD };
    this.put(project.key, placeholder);
    const snapshot: OrganisationSnapshot | null = await this.files.load(project.root);
    // The project may have closed, or closed and reopened, while the read was in flight.
    if (this.stateMap().get(project.key) !== placeholder) {
      return;
    }
    if (snapshot === null) {
      this.log.warn('mission-control', 'Could not read the organisation', project.key);
      return;
    }
    this.put(project.key, { loaded: true, ...snapshot });
  }

  /**
   * Changes one agent's committed fields.
   * @param project The project.
   * @param agentId The agent's identifier.
   * @param change The fields to change.
   */
  private updateAgent(
    project: ForgeProject,
    agentId: string,
    change: Partial<Omit<OrganisationAgent, 'id'>>,
  ): void {
    const current: Organisation = this.stateFor(project.key).organisation;
    if (!current.agents.some((agent: OrganisationAgent): boolean => agent.id === agentId)) {
      return;
    }
    this.saveOrganisation(project, {
      ...current,
      agents: current.agents.map((agent: OrganisationAgent): OrganisationAgent =>
        agent.id === agentId ? { ...agent, ...change } : agent,
      ),
    });
  }

  /**
   * Changes one agent's per-developer state, dropping the entry once it holds nothing.
   * @param project The project.
   * @param agentId The agent's identifier.
   * @param change The fields to change.
   */
  private updateAgentState(
    project: ForgeProject,
    agentId: string,
    change: Partial<Omit<OrganisationAgentState, 'agentId'>>,
  ): void {
    const user: OrganisationUser = this.stateFor(project.key).user;
    const next: OrganisationAgentState = { ...this.agentState(project.key, agentId), ...change };
    const others: readonly OrganisationAgentState[] = user.agents.filter(
      (state: OrganisationAgentState): boolean => state.agentId !== agentId,
    );
    const empty: boolean = next.workItem === null && next.conversationId === null;
    this.saveUser(project, { agents: empty ? others : [...others, next] });
  }

  /**
   * Applies a committed organisation at once and writes it, then adopts what was written.
   * @param project The project.
   * @param organisation The organisation.
   */
  private saveOrganisation(project: ForgeProject, organisation: Organisation): void {
    this.put(project.key, { ...this.stateFor(project.key), organisation });
    this.enqueue(project, async (): Promise<void> => {
      const written: Organisation | null = await this.files.save(project.root, organisation);
      if (written === null) {
        this.log.warn('mission-control', 'Could not save the organisation', project.key);
      } else if (this.stateMap().get(project.key)?.organisation === organisation) {
        // Adopted only while nothing newer has been applied: a later change has its own write queued
        // behind this one, and would otherwise flicker back to this copy until that write lands.
        this.put(project.key, { ...this.stateFor(project.key), organisation: written });
      }
    });
  }

  /**
   * Applies per-developer state at once and writes it, then adopts what was written.
   * @param project The project.
   * @param user The state.
   */
  private saveUser(project: ForgeProject, user: OrganisationUser): void {
    this.put(project.key, { ...this.stateFor(project.key), user });
    this.enqueue(project, async (): Promise<void> => {
      const written: OrganisationUser | null = await this.files.saveUser(project.root, user);
      if (written === null) {
        this.log.warn('mission-control', 'Could not save the organisation state', project.key);
      } else if (this.stateMap().get(project.key)?.user === user) {
        this.put(project.key, { ...this.stateFor(project.key), user: written });
      }
    });
  }

  /**
   * Queues a write behind the project's earlier ones.
   * @param project The project.
   * @param write The write.
   */
  private enqueue(project: ForgeProject, write: () => Promise<void>): void {
    const tail: Promise<void> = (this.writes.get(project.key) ?? Promise.resolve())
      .then(write)
      .catch((error: unknown): void => {
        this.log.error('mission-control', 'Organisation write failed', project.key, error);
      });
    this.writes.set(project.key, tail);
  }

  /**
   * Replaces one project's organisation.
   * @param key The project's key.
   * @param state The new organisation.
   */
  private put(key: string, state: ProjectOrganisation): void {
    this.stateMap.update(
      (
        current: ReadonlyMap<string, ProjectOrganisation>,
      ): ReadonlyMap<string, ProjectOrganisation> =>
        new Map<string, ProjectOrganisation>(current).set(key, state),
    );
  }
}
