import {
  computed,
  createEnvironmentInjector,
  DestroyRef,
  effect,
  EnvironmentInjector,
  inject,
  runInInjectionContext,
  Service,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Agent } from '@shared/angular/services/agent/agent';
import { AGENT_RUN_OWNER } from '@shared/angular/services/agent/agent-run-owner';
import { AGENT_WORKSPACE_ROOT } from '@shared/angular/services/agent/agent-workspace-root';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import {
  AGENT_CONVERSATION_CONTEXT,
  AGENT_CONVERSATION_KIND,
} from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import {
  ForgeProject,
  ForgeProjects,
} from '@shared/angular/services/forge-projects/forge-projects';
import { Log } from '@shared/angular/services/log/log';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import {
  OrganisationAgent,
  OrganisationAgentState,
  OrganisationRole,
} from '@shared/api/organisation';
import { MissionControlOrganisations } from './organisations';

/**
 * A named agent Studio is hosting: its live session, in an injector of its own.
 */
export interface HostedOrgAgent {
  /**
   * Gets the project the agent works on.
   */
  readonly projectKey: string;

  /**
   * Gets the agent's identifier.
   */
  readonly agentId: string;

  /**
   * Gets the agent's live session.
   */
  readonly agent: Agent;

  /**
   * Gets the agent's conversation.
   */
  readonly conversation: AgentConversation;
}

/**
 * A hosted agent together with the injector that owns it.
 */
type HostedEntry = HostedOrgAgent & {
  /**
   * Gets the injector the agent's session lives in, destroyed when it is let go.
   */
  readonly injector: EnvironmentInjector;
};

/**
 * Builds the key a hosted agent is held under.
 * @param projectKey The project's key.
 * @param agentId The agent's identifier.
 * @returns Returns the key.
 */
function hostKey(projectKey: string, agentId: string): string {
  return `${projectKey}::${agentId}`;
}

/**
 * Composes a named agent's standing brief: who it is, the job its role describes, and what it is
 * assigned to. Read at the start of every turn, so a rename, a role change or a new assignment reaches
 * the agent on its next turn.
 * @param agent The agent.
 * @param role The role it holds.
 * @param workItem The number of the work item it is assigned to, or null.
 * @returns Returns the brief.
 */
export function composeBrief(
  agent: OrganisationAgent,
  role: OrganisationRole | undefined,
  workItem: number | null,
): string {
  const lines: string[] = [
    `Your name is ${agent.name}. You hold the ${role?.title ?? 'unassigned'} role in this project's agent organisation.`,
  ];
  if (role !== undefined && role.brief.length > 0) {
    lines.push(role.brief);
  }
  lines.push(
    workItem === null
      ? 'You have no work item assigned yet.'
      : `You are assigned to issue #${workItem} in this repository.`,
  );
  return lines.join('\n\n');
}

/**
 * Hosts the named agents of every open project (epic #788, P2): each one a live {@link Agent} and
 * {@link AgentConversation} in an injector of its own, registered with the app-wide agent and request
 * registries exactly as a workspace's own agent is — so it appears in Mission Control's Agents face,
 * raises its permission prompts there, and stops with Stop All.
 *
 * A named agent belongs to no view. It works in its project's workspace (its runs name that
 * workspace's root and view scope, so its tools act there and nowhere else), carries its role brief on
 * every turn, and resumes the conversation it was last carrying. It is hosted on demand and let go when
 * its project closes or it leaves the roster.
 *
 * This is the seam epic #769 replaces: when agents outlive Studio, hosting moves to the agent host and
 * this becomes a view over its sessions.
 */
@Service()
export class MissionControlOrgAgents {
  /**
   * Holds the injector each hosted agent's own injector descends from.
   */
  private readonly parent: EnvironmentInjector = inject(EnvironmentInjector);

  /**
   * Holds every open project's organisation.
   */
  private readonly organisations: MissionControlOrganisations = inject(MissionControlOrganisations);

  /**
   * Holds the registry of open projects.
   */
  private readonly forgeProjects: ForgeProjects = inject(ForgeProjects);

  /**
   * Holds the app-wide live-agent registry.
   */
  private readonly agentHosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds the app-wide registry of agents that can raise requests.
   */
  private readonly agentRequests: AgentRequests = inject(AgentRequests);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the hosted agents with their injectors, keyed by project and agent.
   */
  private readonly hostedMap: WritableSignal<ReadonlyMap<string, HostedEntry>> = signal<
    ReadonlyMap<string, HostedEntry>
  >(new Map<string, HostedEntry>());

  /**
   * Gets every hosted agent.
   */
  public readonly hosted: Signal<readonly HostedOrgAgent[]> = computed(
    (): readonly HostedOrgAgent[] => [...this.hostedMap().values()],
  );

  /**
   * Initializes a new instance of the {@link MissionControlOrgAgents} class: a hosted agent whose
   * project closes, or who leaves the roster, is let go.
   */
  public constructor() {
    effect((): void => {
      const open: ReadonlySet<string> = new Set<string>(
        this.forgeProjects.projects().map((project: ForgeProject): string => project.key),
      );
      const states: ReadonlyMap<string, unknown> = this.organisations.states();
      untracked((): void => {
        for (const hosted of this.hostedMap().values()) {
          const onRoster: boolean =
            !states.has(hosted.projectKey) ||
            !this.organisations.stateFor(hosted.projectKey).loaded ||
            this.organisations
              .stateFor(hosted.projectKey)
              .organisation.agents.some(
                (agent: OrganisationAgent): boolean => agent.id === hosted.agentId,
              );
          if (!open.has(hosted.projectKey) || !onRoster) {
            this.close(hosted.projectKey, hosted.agentId);
          }
        }
      });
    });
  }

  /**
   * Gets a hosted agent.
   * @param projectKey The project's key.
   * @param agentId The agent's identifier.
   * @returns Returns the hosted agent, or undefined when it is not hosted.
   */
  public hostFor(projectKey: string, agentId: string): HostedOrgAgent | undefined {
    return this.hostedMap().get(hostKey(projectKey, agentId));
  }

  /**
   * Hosts a named agent, or returns it when it is hosted already.
   * @param project The project the agent works on.
   * @param agent The agent.
   * @returns Returns the hosted agent.
   */
  public open(project: ForgeProject, agent: OrganisationAgent): HostedOrgAgent {
    const existing: HostedOrgAgent | undefined = this.hostFor(project.key, agent.id);
    if (existing !== undefined) {
      return existing;
    }
    const context: ConversationContext = { kind: 'workspace', key: project.root };
    const injector: EnvironmentInjector = createEnvironmentInjector(
      [
        Agent,
        AgentConversation,
        { provide: AGENT_CONVERSATION_KIND, useValue: 'workspace' },
        { provide: AGENT_CONVERSATION_CONTEXT, useValue: (): ConversationContext => context },
        { provide: AGENT_WORKSPACE_ROOT, useValue: (): string | null => project.root },
        { provide: AGENT_RUN_OWNER, useValue: (): string => project.scope },
      ],
      this.parent,
      `org-agent:${agent.id}`,
    );
    const session: Agent = injector.get(Agent);
    const conversation: AgentConversation = injector.get(AgentConversation);
    const current: () => OrganisationAgent = (): OrganisationAgent =>
      this.organisations
        .stateFor(project.key)
        .organisation.agents.find((member: OrganisationAgent): boolean => member.id === agent.id) ??
      agent;

    session.bindStandingBrief((): string => {
      const member: OrganisationAgent = current();
      const state: OrganisationAgentState = this.organisations.agentState(project.key, agent.id);
      return composeBrief(
        member,
        this.organisations.roleFor(project.key, member.roleId),
        state.workItem,
      );
    });
    // A role that may not touch the code starts its conversation in read-only chat. Enforcing the
    // isolation belongs to the main process (P3); this only sets where the conversation begins.
    if (this.organisations.roleFor(project.key, agent.roleId)?.isolation === 'readonly') {
      session.setMode('chat');
    }

    const label: Signal<string> = computed((): string => {
      const member: OrganisationAgent = current();
      const role: OrganisationRole | undefined = this.organisations.roleFor(
        project.key,
        member.roleId,
      );
      return role === undefined ? member.name : `${member.name} · ${role.title}`;
    });
    const destroyRef: DestroyRef = injector.get(DestroyRef);
    destroyRef.onDestroy(
      this.agentRequests.register({
        agent: session,
        tabId: (): string | null => null,
        label: (): string => label(),
      }),
    );
    destroyRef.onDestroy(
      this.agentHosts.register({
        tabId: null,
        label,
        surface: 'workspace',
        agent: session,
        conversation,
        isActive: signal<boolean>(false).asReadonly(),
      }),
    );

    const resume: string | null = this.organisations.agentState(
      project.key,
      agent.id,
    ).conversationId;
    if (resume !== null) {
      void conversation.open(resume);
    }
    // Remember the conversation the agent is carrying, so it resumes after a restart. Only an id is
    // remembered: the conversation reads as unsaved (null) until its first save, and forgetting it then
    // would lose the one being resumed.
    runInInjectionContext(injector, (): void => {
      effect((): void => {
        const id: string | null = conversation.currentId();
        if (id !== null) {
          untracked((): void => this.organisations.rememberConversation(project, agent.id, id));
        }
      });
    });

    const hosted: HostedEntry = {
      projectKey: project.key,
      agentId: agent.id,
      agent: session,
      conversation,
      injector,
    };
    this.hostedMap.update(
      (current: ReadonlyMap<string, HostedEntry>): ReadonlyMap<string, HostedEntry> =>
        new Map<string, HostedEntry>(current).set(hostKey(project.key, agent.id), hosted),
    );
    this.log.info('mission-control', 'Hosting named agent', project.key, agent.id);
    return hosted;
  }

  /**
   * Lets a hosted agent go: stops any run, and drops it from the registries.
   * @param projectKey The project's key.
   * @param agentId The agent's identifier.
   */
  public close(projectKey: string, agentId: string): void {
    const key: string = hostKey(projectKey, agentId);
    const hosted: HostedEntry | undefined = this.hostedMap().get(key);
    if (hosted === undefined) {
      return;
    }
    this.hostedMap.update(
      (current: ReadonlyMap<string, HostedEntry>): ReadonlyMap<string, HostedEntry> => {
        const next: Map<string, HostedEntry> = new Map<string, HostedEntry>(current);
        next.delete(key);
        return next;
      },
    );
    if (hosted.agent.isRunning()) {
      hosted.agent.stop();
    }
    hosted.injector.destroy();
    this.log.info('mission-control', 'Released named agent', projectKey, agentId);
  }
}
