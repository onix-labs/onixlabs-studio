import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import {
  ForgeCloseReason,
  ForgeIssue,
  ForgeIssueComment,
  ForgeResult,
} from '@shared/api/forge-types';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { IssueStore } from './issue-store';

/**
 * Describes a change of state waiting on the user's confirmation.
 */
export interface PendingIssueState {
  /**
   * Gets the issue to change.
   */
  readonly issue: ForgeIssue;

  /**
   * Gets the state it would be put in.
   */
  readonly state: 'open' | 'closed';
}

/**
 * Closes, reopens and comments on an issue as the user (#890).
 *
 * The issue's document asks; this owns the question and carries out the answer, then keeps the
 * document current: a changed state replaces the issue it shows, and a posted comment re-reads the
 * conversation, so what is on screen is what the host now holds.
 *
 * Provided per view, beside {@link IssueStore} and the view's {@link ForgeRepository}: the issue it
 * changes belongs to one workspace tab's repository. Deliberately not auto-provided — a root instance
 * would reach a repository nothing has detected and refuse every request, and failing loudly on the
 * missing provider is better than a button that only ever reports an error.
 */
@Service({ autoProvided: false })
export class IssueActions {
  /**
   * Holds the forge-backed repository the requests go through.
   */
  private readonly forgeRepository: ForgeRepository = inject(ForgeRepository);

  /**
   * Holds the store the issue documents resolve from.
   */
  private readonly issues: IssueStore = inject(IssueStore);

  /**
   * Holds the notifications a failure is reported through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the change waiting on confirmation, or null when nothing is being asked.
   */
  private readonly pendingState: WritableSignal<PendingIssueState | null> =
    signal<PendingIssueState | null>(null);

  /**
   * Gets the change waiting on confirmation, or null when nothing is being asked.
   */
  public readonly pending: Signal<PendingIssueState | null> = this.pendingState.asReadonly();

  /**
   * Holds the numbers of the issues with a request in flight.
   */
  private readonly busyState: WritableSignal<ReadonlySet<number>> = signal<ReadonlySet<number>>(
    new Set<number>(),
  );

  /**
   * Gets the numbers of the issues with a request in flight, so their controls can wait.
   */
  public readonly busy: Signal<ReadonlySet<number>> = this.busyState.asReadonly();

  /**
   * Asks to close an open issue, or reopen a closed one.
   * @param issue The issue.
   */
  public requestToggle(issue: ForgeIssue): void {
    this.pendingState.set({ issue, state: issue.state === 'open' ? 'closed' : 'open' });
  }

  /**
   * Drops the question unanswered.
   */
  public dismiss(): void {
    this.pendingState.set(null);
  }

  /**
   * Carries out the change being asked about.
   * @param reason Why the issue is being closed; ignored when reopening.
   * @param duplicateOf The original issue's number, when closing as a duplicate.
   * @returns Returns a promise that resolves once the host has answered.
   */
  public async confirm(reason?: ForgeCloseReason, duplicateOf?: number): Promise<void> {
    const pending: PendingIssueState | null = this.pendingState();
    if (pending === null) {
      return;
    }
    this.pendingState.set(null);
    const { issue, state } = pending;
    const result: ForgeResult<ForgeIssue> = await this.whileBusy(issue.number, () =>
      this.forgeRepository.setIssueState(issue.number, state, reason, duplicateOf),
    );
    if (result.ok) {
      this.issues.put(this.issues.idForIssue(issue.number), result.value);
    } else {
      this.notifications.notify({
        severity: 'error',
        title: `Could not ${state === 'closed' ? 'close' : 'reopen'} #${issue.number}`,
        detail: result.error,
      });
    }
  }

  /**
   * Posts a comment, then re-reads the conversation so it shows the comment as the host stored it.
   * @param issue The issue.
   * @param body The comment, as Markdown.
   * @returns Returns true once it is posted, or false when it could not be (the reason is notified).
   */
  public async comment(issue: ForgeIssue, body: string): Promise<boolean> {
    const result: ForgeResult<ForgeIssueComment> = await this.whileBusy(issue.number, () =>
      this.forgeRepository.commentOnIssue(issue.number, body),
    );
    if (!result.ok) {
      this.notifications.notify({
        severity: 'error',
        title: `Could not comment on #${issue.number}`,
        detail: result.error,
      });
      return false;
    }
    await this.reloadComments(issue);
    return true;
  }

  /**
   * Re-reads an issue's conversation into the store, keeping its comment count in step.
   * @param issue The issue.
   * @returns Returns a promise that resolves once the conversation is read.
   */
  private async reloadComments(issue: ForgeIssue): Promise<void> {
    const id: string = this.issues.idForIssue(issue.number);
    this.issues.markLoading(id);
    const result: ForgeResult<readonly ForgeIssueComment[]> =
      await this.forgeRepository.issueComments(issue.number);
    if (!result.ok) {
      this.issues.putCommentsError(id, result.error);
      return;
    }
    const current: ForgeIssue = this.issues.get(id)?.issue ?? issue;
    this.issues.put(id, { ...current, commentCount: result.value.length });
    this.issues.putComments(id, result.value);
  }

  /**
   * Marks an issue busy for the length of a request.
   * @param issueNumber The issue.
   * @param request The request.
   * @returns Returns the request's result.
   */
  private async whileBusy<T>(issueNumber: number, request: () => Promise<T>): Promise<T> {
    this.busyState.update((busy: ReadonlySet<number>): ReadonlySet<number> =>
      new Set<number>(busy).add(issueNumber),
    );
    try {
      return await request();
    } finally {
      this.busyState.update((busy: ReadonlySet<number>): ReadonlySet<number> => {
        const next: Set<number> = new Set<number>(busy);
        next.delete(issueNumber);
        return next;
      });
    }
  }
}
