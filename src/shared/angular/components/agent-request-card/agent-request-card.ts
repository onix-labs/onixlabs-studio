import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AgentRequestEntry } from '@shared/angular/services/agent-requests/agent-requests';

/**
 * A single pending agent request rendered as a card: a heading describing what is being asked, an
 * optional detail line, and the inline actions that answer it. Answering drives the respond methods on
 * the request's own {@link import('@shared/angular/services/agent/agent').Agent} and transcript item, so
 * every surface showing the same request (the origin tab, the Mission Control tile, this card) settles
 * together. Shared by the Mission Control panel's request inbox and its per-agent rail.
 */
@Component({
  selector: 'app-agent-request-card',
  templateUrl: './agent-request-card.html',
  styleUrl: './agent-request-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentRequestCard {
  /**
   * Gets the pending request the card renders and answers.
   */
  public readonly entry: InputSignal<AgentRequestEntry> = input.required<AgentRequestEntry>();

  /**
   * Gets the heading line for the request: what kind of decision it asks for.
   * @returns Returns the heading.
   */
  protected heading(): string {
    const entry: AgentRequestEntry = this.entry();
    switch (entry.item.kind) {
      case 'permission':
        return `Allow ${entry.item.permissionName ?? 'a tool'}?`;
      case 'edit-decision':
        return `Apply an edit to ${entry.item.decisionName ?? 'a document'}?`;
      default:
        return entry.item.inputQuestion ?? 'The agent has a question.';
    }
  }

  /**
   * Answers a permission request (a one-off grant or denial).
   * @param granted Whether the user granted permission.
   */
  protected onPermission(granted: boolean): void {
    const entry: AgentRequestEntry = this.entry();
    entry.agent.respondPermission(entry.item, granted);
  }

  /**
   * Answers an edit decision.
   * @param choice The decision.
   */
  protected onEditDecision(choice: 'yes' | 'yes-auto' | 'no'): void {
    const entry: AgentRequestEntry = this.entry();
    entry.agent.respondEditDecision(entry.item, choice);
  }

  /**
   * Answers a question with one of its choices, or declines it.
   * @param answer The chosen answer, or null to decline.
   */
  protected onAnswer(answer: string | null): void {
    const entry: AgentRequestEntry = this.entry();
    entry.agent.respondInput(entry.item, answer);
  }
}
