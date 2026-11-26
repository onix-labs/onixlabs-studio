import {
  computed,
  DestroyRef,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { Bridge } from '@shared/api/bridge';
import type { RepositoryInfo, RepositoryTrustDecision } from '@shared/api/source-control-channels';
import {
  TrustChannel,
  type TrustAnswer,
  type TrustChange,
  type TrustQuestion,
  type TrustQuestionRequest,
  type TrustScanRequest,
} from '@shared/api/trust-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * The renderer's side of the trust question (#1504). Nothing runs from a folder until the user trusts
 * it: no language server, no project tool, no version control, no package manager.
 *
 * The main process owns the question: it decides when to ask, one folder at a time, and records the
 * answer. This service asks for the question on a surface's behalf, shows the one being asked (the
 * trust dialog at the application root renders {@link pending}), sends back the user's answer, and
 * follows what changes. Every folder Studio opens is asked about once, whatever plugins are installed;
 * a folder the user did not trust stays that way until they choose Trust from the status bar or a
 * panel.
 */
@Service()
export class RepositoryTrust {
  /**
   * Holds the generic transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the question the main process is asking, or null when none is.
   */
  private readonly asking: WritableSignal<TrustQuestionRequest | null> =
    signal<TrustQuestionRequest | null>(null);

  /**
   * Gets the folder being asked about, or null when nothing is being asked.
   */
  public readonly pending: Signal<TrustQuestion | null> = computed(
    (): TrustQuestion | null => this.asking()?.question ?? null,
  );

  /**
   * Holds the last change to any folder's trust, or null before one.
   */
  private readonly lastChange: WritableSignal<TrustChange | null> = signal<TrustChange | null>(
    null,
  );

  /**
   * Gets the last change to any folder's trust, or null before one: what a surface waiting on a
   * folder's trust follows, to start once it is trusted.
   */
  public readonly changed: Signal<TrustChange | null> = this.lastChange.asReadonly();

  /**
   * Holds the last folder the user asked to have scanned before deciding, or null before one.
   */
  private readonly lastScanRequest: WritableSignal<TrustScanRequest | null> =
    signal<TrustScanRequest | null>(null);

  /**
   * Gets the last folder the user asked to have scanned before deciding, or null before one: what the
   * workspace showing that folder follows, to start its scanning agent.
   */
  public readonly scanRequested: Signal<TrustScanRequest | null> =
    this.lastScanRequest.asReadonly();

  /**
   * Initializes a new instance of the {@link RepositoryTrust} class, following the main process's
   * announcements of changed decisions until the service is destroyed.
   */
  public constructor() {
    const stop: (() => void) | undefined = this.bridge?.on(
      TrustChannel.Changed,
      (change: unknown): void => {
        const typed: TrustChange = change as TrustChange;
        this.log.info('RepositoryTrust', `${typed.folder} is now ${typed.decision}`);
        this.lastChange.set(typed);
      },
    );
    const stopQuestions: (() => void) | undefined = this.bridge?.on(
      TrustChannel.Question,
      (request: unknown): void => {
        this.asking.set(request as TrustQuestionRequest);
      },
    );
    const stopScans: (() => void) | undefined = this.bridge?.on(
      TrustChannel.ScanRequested,
      (request: unknown): void => {
        const typed: TrustScanRequest = request as TrustScanRequest;
        this.log.info('RepositoryTrust', `A scan of ${typed.folder} was asked for`);
        this.lastScanRequest.set(typed);
      },
    );
    inject(DestroyRef).onDestroy((): void => {
      stop?.();
      stopQuestions?.();
      stopScans?.();
    });
  }

  /**
   * Sends the user's answer to the question being asked, and puts the question away.
   * @param answer The button the user pressed; dismissing the dialog is not trusting the folder.
   */
  public answer(answer: TrustAnswer): void {
    const request: TrustQuestionRequest | null = this.asking();
    if (request === null) {
      return;
    }
    this.asking.set(null);
    this.log.info('RepositoryTrust', `${request.question.folder}: ${answer}`);
    void this.bridge?.invoke<boolean>(TrustChannel.Answer, request.id, answer);
  }

  /**
   * Gets what the user decided about a folder, asking nothing.
   * @param folder The folder.
   * @returns Returns the decision; `unknown` outside Electron.
   */
  public async state(folder: string): Promise<RepositoryTrustDecision> {
    return (
      (await this.bridge?.invoke<RepositoryTrustDecision>(TrustChannel.State, folder)) ?? 'unknown'
    );
  }

  /**
   * Makes sure the user has been asked about a folder Studio opened: asks when nothing has been
   * decided, and leaves a decision already made alone. What a workspace calls as its folder opens.
   * @param folder The folder.
   * @returns Returns the decision in force afterwards.
   */
  public async ensureAsked(folder: string): Promise<RepositoryTrustDecision> {
    const decision: RepositoryTrustDecision = await this.state(folder);
    return decision === 'unknown' ? this.ask(folder) : decision;
  }

  /**
   * Makes sure the user has decided about a repository before its version control runs, asking them
   * when they have not, and reports whether it may run.
   * @param info The opened repository, as the main process described it.
   * @returns Returns true when the repository is trusted.
   */
  public async ensureTrusted(info: RepositoryInfo): Promise<boolean> {
    if (info.trust === 'trusted') {
      return true;
    }
    if (info.trust === 'restricted') {
      return false;
    }
    return (await this.ask(info.root)) === 'trusted';
  }

  /**
   * Asks the user again whether they trust a folder they declined, from a Trust button.
   * @param folder The folder.
   * @returns Returns true when they now trust it.
   */
  public async trust(folder: string): Promise<boolean> {
    return (await this.ask(folder)) === 'trusted';
  }

  /**
   * Has the main process ask the user, and answers with the decision it recorded.
   * @param folder The folder.
   * @returns Returns the decision in force afterwards; `unknown` outside Electron.
   */
  private async ask(folder: string): Promise<RepositoryTrustDecision> {
    this.log.info('RepositoryTrust', `Asking whether ${folder} is trusted`);
    return (
      (await this.bridge?.invoke<RepositoryTrustDecision>(TrustChannel.Ask, folder)) ?? 'unknown'
    );
  }
}
