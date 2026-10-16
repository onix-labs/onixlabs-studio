import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import {
  RepositoryInfo,
  RepositoryTrustDecision,
  SourceControlClient,
} from '@shared/api/source-control-channels';
import { Log } from '@shared/angular/services/log/log';
import { SourceControl } from '@shared/angular/services/source-control/source-control';

/**
 * A repository the user is being asked about.
 */
export interface RepositoryTrustQuestion {
  /**
   * Gets the repository's absolute root.
   */
  readonly root: string;

  /**
   * Gets the repository's display name.
   */
  readonly name: string;
}

/**
 * Owns the one question every repository is asked before version control first runs in it: "do you
 * trust this repository?" It holds the repository currently being asked (rendered by the trust host
 * mounted at the application root, in its own window like every modal), resolves each request with
 * the user's answer, and records the answer in the main process, which is what enforces it.
 *
 * A repository can carry settings and scripts its tool runs the moment it looks at the folder, so the
 * answer decides whether the tool looks at all. Declining is the default, and dismissing the window
 * means declining: nothing runs until the user says so, and a repository they declined stays that way
 * until they trust it from the panels' empty state.
 *
 * One place, so that the workspace's explorer decorations and the Repository panel — which open the
 * same repository independently — ask once between them: a second request for a repository already
 * being asked about shares the first's answer, and requests for different repositories take turns.
 */
@Service()
export class RepositoryTrust {
  /**
   * Holds the source-control client, or undefined outside Electron.
   */
  private readonly api: SourceControlClient | undefined = inject(SourceControl).client;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the repository being asked about, or null when nothing is being asked.
   */
  private readonly asking: WritableSignal<RepositoryTrustQuestion | null> =
    signal<RepositoryTrustQuestion | null>(null);

  /**
   * Holds the resolver of the question in flight, or null when nothing is being asked.
   */
  private answer: ((trusted: boolean) => void) | null = null;

  /**
   * Holds the answers in flight, keyed by repository root, so two surfaces opening one repository
   * share a single question.
   */
  private readonly inFlight: Map<string, Promise<boolean>> = new Map<string, Promise<boolean>>();

  /**
   * Holds the questions waiting their turn, so one repository is asked about at a time.
   */
  private queue: Promise<void> = Promise.resolve();

  /**
   * Gets the repository being asked about, or null when nothing is being asked.
   */
  public readonly pending: Signal<RepositoryTrustQuestion | null> = this.asking.asReadonly();

  /**
   * Makes sure the user has decided about a repository, asking them when they have not yet, and
   * reports whether version control may run in it.
   * @param info The opened repository, as the main process described it.
   * @returns Returns true when the repository is trusted.
   */
  public ensureTrusted(info: RepositoryInfo): Promise<boolean> {
    if (info.trust === 'trusted') {
      return Promise.resolve(true);
    }
    if (info.trust === 'restricted') {
      return Promise.resolve(false);
    }
    return this.ask({ root: info.root, name: info.name });
  }

  /**
   * Trusts a repository the user declined earlier, from the panels' empty state.
   * @param root The repository root.
   * @returns Returns true when the main process recorded the decision.
   */
  public async trust(root: string): Promise<boolean> {
    const decision: RepositoryTrustDecision = await this.record(root, 'trusted');
    return decision === 'trusted';
  }

  /**
   * Answers the question being asked: the repository is trusted.
   */
  public accept(): void {
    this.settle(true);
  }

  /**
   * Answers the question being asked: the repository is not trusted. Dismissing the window means the
   * same thing, and is deliberately the same outcome: nothing runs.
   */
  public decline(): void {
    this.settle(false);
  }

  /**
   * Puts the question in front of the user, sharing an answer already being sought for the same
   * repository and waiting for any other repository's question to be answered first.
   * @param question The repository to ask about.
   * @returns Returns true when the user trusts it.
   */
  private ask(question: RepositoryTrustQuestion): Promise<boolean> {
    const shared: Promise<boolean> | undefined = this.inFlight.get(question.root);
    if (shared !== undefined) {
      return shared;
    }
    const answered: Promise<boolean> = this.queue.then((): Promise<boolean> =>
      this.askNow(question),
    );
    this.inFlight.set(question.root, answered);
    this.queue = answered.then(
      (): void => undefined,
      (): void => undefined,
    );
    void answered.finally((): void => {
      this.inFlight.delete(question.root);
    });
    return answered;
  }

  /**
   * Shows the question, waits for the answer, and records it.
   * @param question The repository to ask about.
   * @returns Returns true when the user trusts it.
   */
  private async askNow(question: RepositoryTrustQuestion): Promise<boolean> {
    this.log.info('RepositoryTrust', `Asking whether ${question.root} is trusted`);
    this.asking.set(question);
    const trusted: boolean = await new Promise<boolean>(
      (resolve: (trusted: boolean) => void): void => {
        this.answer = resolve;
      },
    );
    const decision: RepositoryTrustDecision = await this.record(
      question.root,
      trusted ? 'trusted' : 'restricted',
    );
    return decision === 'trusted';
  }

  /**
   * Records a decision in the main process, which is what enforces it.
   * @param root The repository root.
   * @param decision The decision.
   * @returns Returns the decision in force afterwards.
   */
  private async record(
    root: string,
    decision: Exclude<RepositoryTrustDecision, 'unknown'>,
  ): Promise<RepositoryTrustDecision> {
    const recorded: RepositoryTrustDecision =
      (await this.api?.setTrust(root, decision)) ?? 'unknown';
    this.log.info('RepositoryTrust', `${root} is now ${recorded}`);
    return recorded;
  }

  /**
   * Resolves the question in flight, if any, and clears it.
   * @param trusted The user's answer.
   */
  private settle(trusted: boolean): void {
    const resolve: ((trusted: boolean) => void) | null = this.answer;
    this.answer = null;
    this.asking.set(null);
    resolve?.(trusted);
  }
}
