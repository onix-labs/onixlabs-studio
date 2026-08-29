import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Forge } from '@shared/angular/services/forge/forge';
import { Log } from '@shared/angular/services/log/log';
import { Repository } from '@shared/angular/services/repository/repository';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
import { GitRemote } from '@shared/angular/services/repository/repository-data';
import {
  ForgeIssue,
  ForgeIssueComment,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';

/**
 * The remote names preferred when a repository has several, in order. A fork typically has both, and
 * the pull requests a contributor cares about are the ones on the repository they push to.
 */
const PREFERRED_REMOTES: readonly string[] = ['origin', 'upstream'];

/**
 * Identifies what a forge-backed section is currently showing, so the panel can render one of four
 * genuinely different situations rather than collapsing them all into an empty list.
 */
export type ForgeSectionState =
  'no-repository' | 'no-forge' | 'unauthorized' | 'rate-limited' | 'loading' | 'error' | 'ready';

/**
 * Holds one forge-backed section's data and the state it is in.
 */
export interface ForgeSection<T> {
  /**
   * Gets what the section is currently showing.
   */
  readonly state: ForgeSectionState;

  /**
   * Gets the items read. A transient failure keeps the last good ones rather than emptying the
   * section — data that was true a minute ago is worth more than a blank list — so this can be
   * populated in a state other than `ready`. {@link stale} is what says which.
   */
  readonly items: readonly T[];

  /**
   * Gets a value indicating whether {@link items} are left over from an earlier read that has since
   * failed, so the panel can show them while saying they are not current.
   */
  readonly stale: boolean;

  /**
   * Gets the message explaining an unhappy state, or null when there is nothing to explain.
   */
  readonly message: string | null;
}

/**
 * The empty section, before anything has been asked for.
 */
const IDLE: ForgeSection<never> = {
  state: 'no-repository',
  items: [],
  message: null,
  stale: false,
};

/**
 * How often a watched section is re-read. Long enough that an idle workspace is not chattering at the
 * forge, short enough that a pull request opened elsewhere shows up without being asked for. The cost
 * of a tick is near zero either way: the request is conditional, and GitHub does not charge a 304
 * against the budget.
 */
const POLL_INTERVAL_MS: number = 60_000;

/**
 * Holds this workspace's forge-backed view of its repository: which repository the remote names on a
 * forge, and what that forge says about it (#433).
 *
 * Provided per view alongside {@link Repository}, for the same reason: a dock panel is destroyed when
 * another tool in its stack activates, so state owned by the Pull Requests section would be thrown
 * away and re-fetched every time the user switched tools — which on a rate-limited API is not merely
 * wasteful but self-defeating.
 *
 * Detection follows the repository's remotes, so the sections come and go with the folder the tab has
 * open, and a repository with no forge remote reports that rather than showing sections that could
 * never populate.
 */
@Service()
export class ForgeRepository {
  /**
   * Holds the forge client.
   */
  private readonly forge: Forge = inject(Forge);

  /**
   * Holds this view's repository, whose remotes name the forge repository.
   */
  private readonly repository: Repository = inject(Repository);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Reads the current time, for describing how long a rate limit has left. Overridable in tests.
   */
  protected now: () => number = Date.now;

  /**
   * Holds the detected forge repository, or null when the remotes name none.
   */
  private readonly detected: WritableSignal<ForgeRepositoryRef | null> =
    signal<ForgeRepositoryRef | null>(null);

  /**
   * Holds the pull-request section's state.
   */
  private readonly pullRequestSection: WritableSignal<ForgeSection<ForgePullRequest>> =
    signal<ForgeSection<ForgePullRequest>>(IDLE);

  /**
   * Gets the detected forge repository, or null when the remotes name none.
   */
  public readonly repositoryRef: Signal<ForgeRepositoryRef | null> = this.detected.asReadonly();

  /**
   * Holds the issue section's state.
   */
  private readonly issueSection: WritableSignal<ForgeSection<ForgeIssue>> =
    signal<ForgeSection<ForgeIssue>>(IDLE);

  /**
   * Holds the workflow-run section's state.
   */
  private readonly runSection: WritableSignal<ForgeSection<ForgeWorkflowRun>> =
    signal<ForgeSection<ForgeWorkflowRun>>(IDLE);

  /**
   * Gets the pull-request section.
   */
  public readonly pullRequests: Signal<ForgeSection<ForgePullRequest>> =
    this.pullRequestSection.asReadonly();

  /**
   * Gets the issue section.
   */
  public readonly issues: Signal<ForgeSection<ForgeIssue>> = this.issueSection.asReadonly();

  /**
   * Gets the workflow-run section.
   */
  public readonly workflowRuns: Signal<ForgeSection<ForgeWorkflowRun>> =
    this.runSection.asReadonly();

  /**
   * Gets the remote the detected repository was found on, which is where a pull request's head is
   * fetched from. Null when nothing was detected.
   */
  private readonly detectedRemote: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets a value indicating whether the forge backend is reachable at all.
   */
  public readonly isAvailable: boolean = this.forge.isAvailable;

  /**
   * Resolves which repository this workspace's remotes name on a forge, remembering it for the
   * listing calls. Safe to call repeatedly; the answer only changes when the remotes do.
   * @returns Returns the detected repository, or null when the remotes name none.
   */
  public async detect(): Promise<ForgeRepositoryRef | null> {
    const remotes: readonly GitRemote[] = this.repository.remotes();
    const ordered: readonly GitRemote[] = [...remotes].sort(
      (left: GitRemote, right: GitRemote): number => rank(left.name) - rank(right.name),
    );
    for (const remote of ordered) {
      if (remote.url.length === 0) {
        continue;
      }
      const reference: ForgeRepositoryRef | null = await this.forge.detect(remote.url);
      if (reference !== null) {
        this.log.debug(
          'forge',
          `Remote '${remote.name}' is ${reference.owner}/${reference.name} on ${reference.kind}`,
        );
        this.detected.set(reference);
        this.detectedRemote.set(remote.name);
        return reference;
      }
    }
    this.detected.set(null);
    this.detectedRemote.set(null);
    return null;
  }

  /**
   * Reads the repository's open pull requests into {@link pullRequests}, detecting the forge first
   * when it has not been already.
   * @returns Returns a promise that resolves once the section has settled.
   */
  public loadPullRequests(): Promise<void> {
    return this.load(this.pullRequestSection, (reference: ForgeRepositoryRef) =>
      this.forge.pullRequests(reference),
    );
  }

  /**
   * Reads the repository's open issues into {@link issues}.
   * @returns Returns a promise that resolves once the section has settled.
   */
  public loadIssues(): Promise<void> {
    return this.load(this.issueSection, (reference: ForgeRepositoryRef) =>
      this.forge.issues(reference),
    );
  }

  /**
   * Reads one issue's comments.
   *
   * Not a section: a section is something the panel keeps current, and a conversation is read when an
   * issue is opened and then left alone. The detected repository is required, so this answers a
   * failure rather than detecting on demand — anything with an issue in front of it has detected one
   * already.
   *
   * @param issueNumber The issue whose comments to read.
   * @returns Returns the comments, or the reason they could not be read.
   */
  public issueComments(issueNumber: number): Promise<ForgeResult<readonly ForgeIssueComment[]>> {
    const reference: ForgeRepositoryRef | null = this.detected();
    if (reference === null) {
      return Promise.resolve({
        ok: false,
        error: 'This repository has no remote on a supported forge.',
        unauthorized: false,
      });
    }
    return this.forge.issueComments(reference, issueNumber);
  }

  /**
   * Reads the repository's recent CI/CD workflow runs into {@link workflowRuns}.
   * @returns Returns a promise that resolves once the section has settled.
   */
  public loadWorkflowRuns(): Promise<void> {
    return this.load(this.runSection, (reference: ForgeRepositoryRef) =>
      this.forge.workflowRuns(reference),
    );
  }

  /**
   * Reads one section, detecting the forge first when it has not been already. Shared by all three so
   * their states cannot drift apart — a section that reported "no forge" differently from its
   * neighbours would be a puzzle rather than a panel.
   * @param section The section to fill.
   * @param read The forge read that fills it.
   * @returns Returns a promise that resolves once the section has settled.
   */
  private async load<T>(
    section: WritableSignal<ForgeSection<T>>,
    read: (reference: ForgeRepositoryRef) => Promise<ForgeResult<readonly T[]>>,
  ): Promise<void> {
    if (!this.repository.isBound()) {
      section.set(IDLE);
      return;
    }
    const reference: ForgeRepositoryRef | null = this.detected() ?? (await this.detect());
    if (reference === null) {
      section.set({
        state: 'no-forge',
        items: [],
        message: 'This repository has no remote on a supported forge.',
        stale: false,
      });
      return;
    }
    const previous: ForgeSection<T> = section();
    // Loading keeps whatever is on screen rather than blanking it. A poll that emptied the section
    // for the length of a request would make an idle panel flicker once a minute.
    section.set({ ...previous, state: 'loading', message: null });
    section.set(sectionFor(await read(reference), previous, this.now()));
  }

  /**
   * Checks out a pull request's head as a local branch.
   *
   * The head is fetched from the remote the repository was detected on, under the ref the forge
   * publishes it as — not by branch name, which would fail for every pull request opened from a fork.
   *
   * @param pullRequest The pull request to check out.
   * @returns Returns the outcome, or a failure when there is nothing to check out against.
   */
  public checkout(pullRequest: ForgePullRequest): Promise<MutationResult> {
    const remote: string | null = this.detectedRemote();
    if (remote === null) {
      return Promise.resolve({ success: false, error: 'No forge remote for this repository.' });
    }
    // Named for the branch the contributor opened it from, falling back to the number when the forge
    // did not say — a local branch called `pull-request` would be useless with two of them open.
    const local: string =
      pullRequest.headRef.length > 0 ? pullRequest.headRef : `pr-${pullRequest.number}`;
    this.log.info('forge', `Checking out pull request #${pullRequest.number} as '${local}'`);
    return this.repository.checkoutRef(remote, pullRequest.headRefspec, local);
  }

  /**
   * Re-runs a workflow run, then re-reads the section — the forge starts a *new* run rather than
   * mutating this one, so the list is what shows the result.
   * @param run The run to re-run.
   * @returns Returns the outcome.
   */
  public rerun(run: ForgeWorkflowRun): Promise<ForgeResult<void>> {
    return this.command((reference: ForgeRepositoryRef) =>
      this.forge.rerunWorkflowRun(reference, run.id),
    );
  }

  /**
   * Cancels a workflow run in flight, then re-reads the section.
   * @param run The run to cancel.
   * @returns Returns the outcome.
   */
  public cancel(run: ForgeWorkflowRun): Promise<ForgeResult<void>> {
    return this.command((reference: ForgeRepositoryRef) =>
      this.forge.cancelWorkflowRun(reference, run.id),
    );
  }

  /**
   * Runs a workflow-run command against the detected repository and re-reads the run list, so the
   * panel shows what the command did rather than what it showed before.
   * @param act The command to run.
   * @returns Returns the outcome.
   */
  private async command(
    act: (reference: ForgeRepositoryRef) => Promise<ForgeResult<void>>,
  ): Promise<ForgeResult<void>> {
    const reference: ForgeRepositoryRef | null = this.detected();
    if (reference === null) {
      return { ok: false, error: 'No forge repository for this workspace.', unauthorized: false };
    }
    const result: ForgeResult<void> = await act(reference);
    if (result.ok) {
      await this.loadWorkflowRuns();
    } else {
      this.log.error('forge', 'Workflow run command failed', result.error);
    }
    return result;
  }

  /**
   * Holds the section keys currently being watched — those a user has open in front of them.
   */
  private readonly watched: Set<string> = new Set<string>();

  /**
   * Holds the poll timer, or null while nothing is being watched.
   */
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Holds whether the view this belongs to is the one the user is looking at.
   */
  private viewActive: boolean = true;

  /**
   * Holds the reads a section key runs, so the poll can re-run whichever are watched.
   */
  private readonly readers: ReadonlyMap<string, () => Promise<void>> = new Map<
    string,
    () => Promise<void>
  >([
    ['pullRequests', (): Promise<void> => this.loadPullRequests()],
    ['issues', (): Promise<void> => this.loadIssues()],
    ['actions', (): Promise<void> => this.loadWorkflowRuns()],
  ]);

  /**
   * Begins watching a section, so it is kept current while the user has it open.
   * @param key The section key.
   */
  public watch(key: string): void {
    if (!this.readers.has(key)) {
      return;
    }
    this.watched.add(key);
    this.syncPoll();
  }

  /**
   * Stops watching a section.
   * @param key The section key.
   */
  public unwatch(key: string): void {
    this.watched.delete(key);
    this.syncPoll();
  }

  /**
   * Stops watching everything, for a panel going away.
   */
  public unwatchAll(): void {
    this.watched.clear();
    this.syncPoll();
  }

  /**
   * Records whether the view this belongs to is the active tab. A workspace in the background keeps
   * its panel mounted — the shell mounts every view and hides the inactive ones — so the panel being
   * alive is not enough to mean anyone is looking at it.
   * @param active Whether the view is active.
   */
  public setActive(active: boolean): void {
    if (this.viewActive === active) {
      return;
    }
    this.viewActive = active;
    this.syncPoll();
  }

  /**
   * Starts or stops the poll to match what is being watched. Nothing watched, or nobody looking,
   * means no timer at all — an idle workspace must not talk to the forge.
   */
  private syncPoll(): void {
    const wanted: boolean = this.viewActive && this.watched.size > 0;
    if (wanted && this.timer === null) {
      this.timer = setInterval((): void => this.poll(), POLL_INTERVAL_MS);
    } else if (!wanted && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Re-reads every watched section. Cheap by construction: each read is conditional, so an unchanged
   * section costs no rate-limit budget, and a section whose budget *is* spent is refused in the main
   * process without a request — which is also how it recovers, once the window rolls over.
   */
  private poll(): void {
    for (const key of this.watched) {
      void this.readers.get(key)?.();
    }
  }

  /**
   * Stops the poll and forgets what was being watched. Called when the view is destroyed.
   */
  public dispose(): void {
    this.unwatchAll();
  }

  /**
   * Clears everything read, for a view whose repository has gone away.
   */
  public reset(): void {
    this.detected.set(null);
    this.detectedRemote.set(null);
    this.pullRequestSection.set(IDLE);
    this.issueSection.set(IDLE);
    this.runSection.set(IDLE);
  }

  /**
   * Gets a value indicating whether any forge section is worth showing at all — that is, whether the
   * repository is on a forge Studio can talk to.
   */
  public readonly hasForge: Signal<boolean> = computed((): boolean => this.detected() !== null);
}

/**
 * Ranks a remote name against the preferred order, so `origin` is tried before anything else.
 * @param name The remote name.
 * @returns Returns the rank; unlisted remotes sort last.
 */
function rank(name: string): number {
  const index: number = PREFERRED_REMOTES.indexOf(name);
  return index === -1 ? PREFERRED_REMOTES.length : index;
}

/**
 * Maps a forge read onto a section state.
 *
 * A failure keeps whatever the section last held, marked stale, rather than replacing it with an
 * error: the pull requests read a minute ago are still the best answer available, and blanking them
 * because the network blinked would lose more than it tells. The exception is an authentication
 * failure, which clears — data the credential can no longer see should not stay on screen.
 *
 * The three failure kinds stay distinct because each is answered differently: sign in, wait, or retry.
 *
 * @param result The read's outcome.
 * @param previous The section as it was, whose items survive a transient failure.
 * @param now The clock, for describing how long a rate limit has left to run.
 * @returns Returns the section.
 */
function sectionFor<T>(
  result: ForgeResult<readonly T[]>,
  previous: ForgeSection<T>,
  now: number,
): ForgeSection<T> {
  if (result.ok) {
    return { state: 'ready', items: result.value, message: null, stale: false };
  }
  if (result.unauthorized) {
    return { state: 'unauthorized', items: [], message: result.error, stale: false };
  }
  const kept: readonly T[] = previous.items;
  if (result.retryAt !== undefined) {
    return {
      state: 'rate-limited',
      items: kept,
      message: `${result.error} Trying again ${describeWait(result.retryAt, now)}.`,
      stale: kept.length > 0,
    };
  }
  return { state: 'error', items: kept, message: result.error, stale: kept.length > 0 };
}

/**
 * Describes how long there is to wait, in the terms a person would use.
 * @param retryAt The epoch milliseconds to wait until.
 * @param now The current epoch milliseconds.
 * @returns Returns the phrase.
 */
function describeWait(retryAt: number, now: number): string {
  const minutes: number = Math.ceil((retryAt - now) / 60_000);
  if (minutes <= 1) {
    return 'in under a minute';
  }
  return minutes < 60 ? `in ${minutes} minutes` : 'in about an hour';
}
