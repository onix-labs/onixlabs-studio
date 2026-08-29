import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ForgeIssue, ForgeIssueComment } from '@shared/api/forge-types';
import { Log } from '@shared/angular/services/log/log';

/**
 * Holds one opened issue: the entry the list gave us, and the conversation once it has been read.
 */
export interface OpenIssue {
  /**
   * Gets the issue itself, as the list read it.
   */
  readonly issue: ForgeIssue;

  /**
   * Gets the comments, or null while they have not been read.
   */
  readonly comments: readonly ForgeIssueComment[] | null;

  /**
   * Gets a value indicating whether the comments are being read.
   */
  readonly loading: boolean;

  /**
   * Gets why the comments could not be read, or null when nothing went wrong.
   */
  readonly error: string | null;
}

/**
 * Holds the issues opened as documents, keyed by the dock panel id showing each.
 *
 * The diff store's sibling, and for the same reason: a panel resolved from a dock id needs somewhere
 * to resolve from that does not itself reference a component. An issue's body arrives with the list
 * entry, so a panel can render the moment it opens; its conversation is fetched afterwards and filled
 * in here.
 */
@Service()
export class IssueStore {
  /**
   * Holds the open issues, keyed by dock panel id.
   */
  private readonly entries: WritableSignal<ReadonlyMap<string, OpenIssue>> = signal<
    ReadonlyMap<string, OpenIssue>
  >(new Map<string, OpenIssue>());

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the open issues, keyed by dock panel id.
   */
  public readonly opened: Signal<ReadonlyMap<string, OpenIssue>> = computed(
    (): ReadonlyMap<string, OpenIssue> => this.entries(),
  );

  /**
   * Builds the stable dock panel id for an issue, so reopening the same one reuses its tab.
   * @param issueNumber The issue number.
   * @returns Returns the panel id.
   */
  public idForIssue(issueNumber: number): string {
    return `issue:${issueNumber}`;
  }

  /**
   * Records an opened issue, keeping any conversation already read for it.
   *
   * The comments survive a re-open because the issue itself is what the list refreshes; dropping the
   * conversation every time the panel re-read its section would mean fetching it again to show the
   * same thing.
   *
   * @param id The dock panel id.
   * @param issue The issue to show.
   */
  public put(id: string, issue: ForgeIssue): void {
    const existing: OpenIssue | undefined = this.entries().get(id);
    this.entries.update((current: ReadonlyMap<string, OpenIssue>): ReadonlyMap<string, OpenIssue> =>
      new Map<string, OpenIssue>(current).set(id, {
        issue,
        comments: existing?.comments ?? null,
        loading: existing?.loading ?? false,
        error: existing?.error ?? null,
      }),
    );
  }

  /**
   * Marks an issue's conversation as being read.
   * @param id The dock panel id.
   */
  public markLoading(id: string): void {
    this.patch(id, { loading: true, error: null });
  }

  /**
   * Records an issue's conversation.
   * @param id The dock panel id.
   * @param comments The comments read.
   */
  public putComments(id: string, comments: readonly ForgeIssueComment[]): void {
    this.patch(id, { comments, loading: false, error: null });
  }

  /**
   * Records why an issue's conversation could not be read.
   * @param id The dock panel id.
   * @param error The failure to report.
   */
  public putCommentsError(id: string, error: string): void {
    this.log.warn('IssueStore', `Could not read the comments for ${id}`, error);
    this.patch(id, { loading: false, error });
  }

  /**
   * Reads the issue shown by a panel id.
   * @param id The dock panel id.
   * @returns Returns the open issue, or null when the panel shows none.
   */
  public get(id: string): OpenIssue | null {
    return this.entries().get(id) ?? null;
  }

  /**
   * Determines whether a panel id has an issue.
   * @param id The dock panel id.
   * @returns Returns true when it does.
   */
  public has(id: string): boolean {
    return this.entries().has(id);
  }

  /**
   * Drops the records for issue panels no longer present in the layout, so closed issues are not
   * retained. Issue ids are namespaced (`issue:`), so non-issue panel ids are ignored.
   * @param present The set of panel ids still present in the dock layout.
   */
  public removeMissing(present: ReadonlySet<string>): void {
    const current: ReadonlyMap<string, OpenIssue> = this.entries();
    const survivors: Map<string, OpenIssue> = new Map<string, OpenIssue>();
    for (const [id, entry] of current) {
      if (present.has(id)) {
        survivors.set(id, entry);
      }
    }
    if (survivors.size !== current.size) {
      this.entries.set(survivors);
    }
  }

  /**
   * Replaces part of an entry, doing nothing when the panel holds no issue.
   * @param id The dock panel id.
   * @param patch The fields to replace.
   */
  private patch(id: string, patch: Partial<OpenIssue>): void {
    const existing: OpenIssue | undefined = this.entries().get(id);
    if (existing === undefined) {
      return;
    }
    this.entries.update((current: ReadonlyMap<string, OpenIssue>): ReadonlyMap<string, OpenIssue> =>
      new Map<string, OpenIssue>(current).set(id, { ...existing, ...patch }),
    );
  }
}
