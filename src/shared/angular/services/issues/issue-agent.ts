import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ForgeIssue, ForgeRepositoryRef } from '@shared/api/forge-types';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';
import { Log } from '@shared/angular/services/log/log';

/**
 * Starts a conversation about an issue in this view's agent.
 *
 * Asking for this is now possible from two places — the issue's row in the rail and the issue's own
 * document — and both mean exactly the same thing, so both ask through here rather than each holding
 * their own copy of the opening message and their own idea of when to warn. The confirmation is part
 * of that: it is the SERVICE that knows a transcript is about to be discarded, so the pending issue
 * lives here and {@link import('../../components/panels/issue-agent-confirm/issue-agent-confirm').IssueAgentConfirm}
 * draws it wherever it is asked from.
 *
 * Provided per view, beside {@link Agent} and {@link DockReveal}: the conversation it replaces and
 * the dock it reveals into both belong to one workspace tab. Deliberately not auto-provided — a root
 * instance would reveal into a dock nobody renders, and failing loudly on the missing provider is
 * better than a click that silently does nothing.
 */
@Service({ autoProvided: false })
export class IssueAgent {
  /**
   * Holds this view's agent, whose transcript a new conversation replaces.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Holds this view's conversation, which owns starting a fresh one.
   */
  private readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Holds the forge's view of the repository, so the opening message can name it.
   */
  private readonly forge: ForgeRepository = inject(ForgeRepository);

  /**
   * Holds this view's dock reveal helper, used to bring the agent panel forward once a conversation
   * has been started — starting one the user cannot see would be a strange thing to do.
   */
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the issue awaiting the user's confirmation to replace the current conversation, or null
   * when none is.
   */
  private readonly awaiting: WritableSignal<ForgeIssue | null> = signal<ForgeIssue | null>(null);

  /**
   * Gets the issue awaiting confirmation, or null when nothing is being asked.
   */
  public readonly pending: Signal<ForgeIssue | null> = this.awaiting.asReadonly();

  /**
   * Opens an issue in this view's agent, starting a fresh conversation about it.
   *
   * A conversation that already holds anything is not replaced silently: starting a new one discards
   * the transcript, and doing that from a click the user may have half-aimed would lose work. The
   * check is on the transcript rather than on a run being in flight — a settled conversation is every
   * bit as much a thing to lose.
   *
   * @param issue The issue to open.
   */
  public open(issue: ForgeIssue): void {
    if (this.agent.hasMessages()) {
      this.awaiting.set(issue);
      return;
    }
    this.start(issue);
  }

  /**
   * Confirms replacing the current conversation with one about the pending issue.
   */
  public confirm(): void {
    const issue: ForgeIssue | null = this.awaiting();
    this.awaiting.set(null);
    if (issue !== null) {
      this.start(issue);
    }
  }

  /**
   * Dismisses the prompt, leaving the current conversation alone.
   */
  public dismiss(): void {
    this.awaiting.set(null);
  }

  /**
   * Starts a fresh conversation about an issue and brings the agent panel forward.
   * @param issue The issue to open.
   */
  private start(issue: ForgeIssue): void {
    this.log.info('forge', `Opening issue #${issue.number} in the agent`);
    this.conversation.newChat();
    this.agent.send(agentPromptFor(issue, this.forge.repositoryRef()));
    // The agent panel is in both built-in layout presets; a user who has closed it can bring it back
    // from View → Panels, and the conversation is waiting when they do.
    this.dockReveal.reveal('agent');
  }
}

/**
 * Builds the message a conversation about an issue opens with.
 *
 * It names the issue, quotes its title, and gives the URL — the agent has the tools to read the body
 * itself, and fetching it here would be a request per issue for text nobody may ask about. The
 * closing instruction is deliberate: a conversation started by one click should arrive at an
 * understanding of the issue, not at a working tree full of edits nobody asked for.
 *
 * @param issue The issue the conversation is about.
 * @param repository The repository it belongs to, or null when the forge is not known.
 * @returns Returns the opening message.
 */
export function agentPromptFor(issue: ForgeIssue, repository: ForgeRepositoryRef | null): string {
  const where: string = repository === null ? '' : ` in ${repository.owner}/${repository.name}`;
  const link: string = issue.url.length === 0 ? '' : `\n${issue.url}`;
  return (
    `Read GitHub issue #${issue.number}${where} — "${issue.title}".${link}\n\n` +
    'Summarise what it asks for, then tell me how you would approach it in this codebase. ' +
    "Don't make any changes yet."
  );
}
