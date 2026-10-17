import { inject, Service, signal, WritableSignal } from '@angular/core';
import { contextIdOf, StoredAgentConversation } from '@shared/api/agent-conversation-channels';
import type { NewProjectOutcome, NewProjectRepository } from '@shared/api/new-project-channels';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Log } from '@shared/angular/services/log/log';
import { NewProject } from '@shared/angular/services/new-project/new-project';
import { ProjectDestination } from '@shared/angular/services/new-project/project-destination';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * The brief the new workspace's agent works under: it starts a project that has just been made.
 */
const HANDOFF_BRIEF: string =
  'This conversation continues a project that was planned with the user in an agent tab and has ' +
  'just been made. The plan, the decisions made and what to do first are in handoff.md: work from ' +
  'it rather than asking again what it already answers. Ask before creating files.';

/**
 * Words the new workspace's first message.
 * @param name The project's name.
 * @param path Where it was made.
 * @returns Returns the message.
 */
function handoffMessage(name: string, path: string): string {
  return (
    `I've created the project ${name} at ${path}. Read handoff.md first: it holds the plan we ` +
    'agreed, the decisions we made and what to do first. Then tell me briefly what you will start ' +
    'with.'
  );
}

/**
 * Makes the workspace an agent tab's agent offered (#876), from its card: makes the project with the
 * handoff written into it, files the planning conversation under the new workspace, opens the
 * workspace with its agent starting from the handoff, and closes the agent tab.
 *
 * Provided by the agent tab, beside its {@link Agent} and {@link AgentConversation}: the conversation
 * it moves and the tab it closes are that tab's. Not auto-provided, so a card shown anywhere else
 * offers nothing it cannot do.
 */
@Service({ autoProvided: false })
export class WorkspaceProposals {
  /**
   * Holds the agent tab's agent, whose proposal is settled.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Holds the agent tab's conversation, which moves to the workspace.
   */
  private readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Holds the conversation store the moved conversation is filed in.
   */
  private readonly store: AgentConversations = inject(AgentConversations);

  /**
   * Holds the client that makes the project.
   */
  private readonly newProject: NewProject = inject(NewProject);

  /**
   * Holds the opener the workspace is opened through.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the tab registry the agent tab is closed through.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the agent tab's id, once the tab has said it.
   */
  private readonly tabId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Records which tab these proposals belong to.
   * @param tabId The agent tab's id.
   */
  public bind(tabId: string): void {
    this.tabId.set(tabId);
  }

  /**
   * Makes the workspace a proposal offered, where the user said.
   * @param item The proposal.
   * @param destination Where it goes and what it starts with.
   * @returns Returns null once it is open, or why it is not.
   */
  public async create(item: AgentItem, destination: ProjectDestination): Promise<string | null> {
    const problem: string | null = destination.problem();
    const repository: NewProjectRepository | null = destination.repositoryRequest();
    if (problem !== null || repository === null) {
      return problem ?? 'Finish the details first.';
    }
    const name: string = destination.name().trim();
    this.log.info('WorkspaceProposals', `Creating ${name} from the agent tab's plan`);
    const outcome: NewProjectOutcome = await this.newProject.create({
      name,
      repository,
      ...(item.proposalHandoff === undefined ? {} : { handoff: item.proposalHandoff }),
    });
    if (!outcome.ok) {
      return outcome.error;
    }
    this.agent.settleProposal(item, 'created', outcome.path);
    const id: string | null = await this.conversation.flush();
    if (id !== null) {
      await this.fileUnder(id, outcome.path, name);
    }
    const opened: boolean = await this.fileOpener.reopenDirectory(outcome.path, {
      prompt: handoffMessage(name, outcome.path),
      brief: HANDOFF_BRIEF,
    });
    if (!opened) {
      return `${name} was made at ${outcome.path}, but it could not be opened.`;
    }
    const tabId: string | null = this.tabId();
    if (tabId !== null) {
      this.tabs.close(tabId);
    }
    return null;
  }

  /**
   * Puts a proposal aside: the card says so, and nothing is made.
   * @param item The proposal.
   */
  public dismiss(item: AgentItem): void {
    this.agent.settleProposal(item, 'dismissed');
  }

  /**
   * Files the planning conversation under the new workspace, so it is listed there in History. The
   * same record is saved again under the workspace's context; the agent tab is closed straight after,
   * so nothing saves it back.
   * @param id The conversation's id.
   * @param path The workspace's folder.
   * @param name The project's name.
   * @returns Resolves once it is saved.
   */
  private async fileUnder(id: string, path: string, name: string): Promise<void> {
    const record: StoredAgentConversation | null = await this.store.load(id);
    if (record === null) {
      return;
    }
    await this.store.save({
      ...record,
      contextId: contextIdOf({ kind: 'workspace', key: path }),
      agentType: 'workspace',
      contextLabel: name,
    });
  }
}
