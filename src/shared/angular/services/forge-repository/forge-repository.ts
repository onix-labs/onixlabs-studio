import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Forge } from '@shared/angular/services/forge/forge';
import { Log } from '@shared/angular/services/log/log';
import { Repository } from '@shared/angular/services/repository/repository';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
import { GitRemote } from '@shared/angular/services/repository/repository-data';
import { ForgePullRequest, ForgeRepositoryRef, ForgeResult } from '@shared/api/forge-types';

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
  | 'no-repository'
  | 'no-forge'
  | 'unauthorized'
  | 'loading'
  | 'error'
  | 'ready';

/**
 * Holds one forge-backed section's data and the state it is in.
 */
export interface ForgeSection<T> {
  /**
   * Gets what the section is currently showing.
   */
  readonly state: ForgeSectionState;

  /**
   * Gets the items read, which is empty in every state but `ready`.
   */
  readonly items: readonly T[];

  /**
   * Gets the message explaining an unhappy state, or null when there is nothing to explain.
   */
  readonly message: string | null;
}

/**
 * The empty section, before anything has been asked for.
 */
const IDLE: ForgeSection<never> = { state: 'no-repository', items: [], message: null };

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
   * Gets the pull-request section.
   */
  public readonly pullRequests: Signal<ForgeSection<ForgePullRequest>> =
    this.pullRequestSection.asReadonly();

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
  public async loadPullRequests(): Promise<void> {
    if (!this.repository.isBound()) {
      this.pullRequestSection.set(IDLE);
      return;
    }
    const reference: ForgeRepositoryRef | null = this.detected() ?? (await this.detect());
    if (reference === null) {
      this.pullRequestSection.set({
        state: 'no-forge',
        items: [],
        message: 'This repository has no remote on a supported forge.',
      });
      return;
    }
    this.pullRequestSection.set({ state: 'loading', items: [], message: null });
    const result: ForgeResult<readonly ForgePullRequest[]> =
      await this.forge.pullRequests(reference);
    this.pullRequestSection.set(sectionFor(result));
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
   * Clears everything read, for a view whose repository has gone away.
   */
  public reset(): void {
    this.detected.set(null);
    this.detectedRemote.set(null);
    this.pullRequestSection.set(IDLE);
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
 * Maps a forge read onto a section state. An authentication failure is kept distinct from any other
 * failure, because the two are answered differently: one by signing in, the other by trying again.
 * @param result The read's outcome.
 * @returns Returns the section.
 */
function sectionFor<T>(result: ForgeResult<readonly T[]>): ForgeSection<T> {
  if (result.ok) {
    return { state: 'ready', items: result.value, message: null };
  }
  return {
    state: result.unauthorized ? 'unauthorized' : 'error',
    items: [],
    message: result.error,
  };
}
