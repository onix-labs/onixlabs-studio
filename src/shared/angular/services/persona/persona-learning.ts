import { DestroyRef, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  buildLearningPrompt,
  parseLearningProposal,
  PersonaLearningChannel,
  type PersonaRebuildEstimate,
  type PersonaRebuildJob,
  type PersonaRebuildRequest,
  type PersonaReviewMode,
  type PersonaSnapshot,
  type LearningBatch,
  type LearningOutcome,
  type LearningProposal,
  type LearningState,
} from '@shared/api/persona-learning-protocol';
import { AiOneShot, AiOneShotResult } from '@shared/angular/services/ai-runtime/ai-one-shot';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * How often persona learning looks for conversations to read.
 */
const TICK_MS: number = 5 * 60_000;

/**
 * How long the learning model may take over one batch.
 */
const RUN_TIMEOUT_MS: number = 5 * 60_000;

/**
 * How many batches one run reads before it stops until the next tick, so a long backlog is worked
 * through a little at a time rather than in one long burst.
 */
const BATCHES_PER_RUN: number = 4;

/**
 * A day, for the once-a-day schedule.
 */
const DAY_MS: number = 24 * 60 * 60_000;

/**
 * The records shown before the first read.
 */
const NO_STATE: LearningState = {
  recent: [],
  pending: [],
  ruledOut: [],
  questions: [],
  lastRun: 0,
  rebuild: null,
};

/**
 * What a run did, summed over its batches.
 */
export interface LearningRunSummary {
  readonly applied: number;
  readonly pending: number;
  readonly refused: number;
  readonly messagesRead: number;
  readonly error: string | null;
}

/**
 * Persona learning in the renderer (#1516): runs the model over what the user typed, in the background, on the
 * connection the user chose for it. The main process decides what it reads and what of its answer
 * lands; this only asks the model, because the AI runtime lives here.
 *
 * It runs after a conversation has been idle for a while (or once a day), and on demand for one
 * conversation. Nothing runs until a connection is chosen, or while it is paused. Every window has a
 * copy; the main process hands each batch to one of them.
 */
@Service()
export class PersonaLearning {
  /**
   * Holds the bridge, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the settings.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the one-shot model call.
   */
  private readonly oneShot: AiOneShot = inject(AiOneShot);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the learning records.
   */
  private readonly stateValue: WritableSignal<LearningState> = signal<LearningState>(NO_STATE);

  /**
   * Holds whether a run is going.
   */
  private readonly runningState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the review of learned changes is open (#1517).
   */
  private readonly reviewState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the rebuild under way has been asked to stop.
   */
  private rebuildCancelled: boolean = false;

  /**
   * Holds the timer, or undefined when not started.
   */
  private timer: ReturnType<typeof setInterval> | undefined;

  /**
   * Gets the learning records: recent changes, changes awaiting review, ruled-out topics, open questions.
   */
  public readonly state: Signal<LearningState> = this.stateValue.asReadonly();

  /**
   * Gets whether a run is going.
   */
  public readonly running: Signal<boolean> = this.runningState.asReadonly();

  /**
   * Gets whether the review of learned changes is open.
   */
  public readonly reviewOpen: Signal<boolean> = this.reviewState.asReadonly();

  /**
   * Called with what each finished run did, for the review notification (#1517).
   */
  private readonly finishedListeners: Set<(summary: LearningRunSummary) => void> = new Set<
    (summary: LearningRunSummary) => void
  >();

  /**
   * Initializes the service: reads the learning records and follows changes to them.
   */
  public constructor() {
    void this.refresh();
    const unfollow: (() => void) | undefined = this.bridge?.on(
      PersonaLearningChannel.Changed,
      (): void => {
        void this.refresh();
      },
    );
    inject(DestroyRef).onDestroy((): void => {
      unfollow?.();
      this.stop();
    });
  }

  /**
   * Gets whether persona learning can run: a connection is chosen and it is not paused.
   * @returns Returns true when it can.
   */
  public isOn(): boolean {
    return (
      this.bridge !== undefined &&
      this.oneShot.isAvailable &&
      this.settings.get('persona.learningConnectionId').length > 0 &&
      !this.settings.get('persona.learningPaused')
    );
  }

  /**
   * Opens the review of learned changes, wherever the Persona page is shown.
   */
  public openReview(): void {
    this.reviewState.set(true);
  }

  /**
   * Closes the review. Changes not decided on wait for the next one.
   */
  public closeReview(): void {
    this.reviewState.set(false);
  }

  /**
   * Starts looking for conversations to read, on a timer. Safe to call more than once.
   */
  public start(): void {
    if (this.timer !== undefined || this.bridge === undefined) {
      return;
    }
    this.timer = setInterval((): void => void this.tick(), TICK_MS);
    // A rebuild Studio was closed part way through carries on where it left off (#1518).
    setTimeout((): void => void this.tick(), 10_000);
  }

  /**
   * Stops the timer.
   */
  public stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Listens for finished runs.
   * @param listener Called with each run's summary.
   * @returns Returns a function that stops listening.
   */
  public onFinished(listener: (summary: LearningRunSummary) => void): () => void {
    this.finishedListeners.add(listener);
    return (): void => void this.finishedListeners.delete(listener);
  }

  /**
   * Runs when the schedule says it is time.
   * @returns Resolves once the run has finished, or there was nothing to do.
   */
  public async tick(): Promise<void> {
    if (
      this.runningState() ||
      this.bridge === undefined ||
      this.settings.get('persona.learningPaused')
    ) {
      return;
    }
    await this.refresh();
    const job: PersonaRebuildJob | null = this.stateValue().rebuild;
    if (job !== null) {
      await this.run({ conversationId: null, rebuild: job });
      return;
    }
    if (!this.isOn()) {
      return;
    }
    if (
      this.settings.get('persona.learningSchedule') === 'daily' &&
      Date.now() - this.stateValue().lastRun < DAY_MS
    ) {
      return;
    }
    await this.run({ conversationId: null, rebuild: null });
  }

  /**
   * Reads one conversation now, idle or not: "Learn from this conversation now".
   * @param conversationId The conversation.
   * @returns Returns what was done.
   */
  public learnNow(conversationId: string): Promise<LearningRunSummary> {
    if (!this.isOn()) {
      return Promise.resolve(
        failed(
          'Choose a connection for persona learning in Settings › AI Manager › Persona first.',
        ),
      );
    }
    if (this.runningState()) {
      return Promise.resolve(failed('Already reading; try again in a moment.'));
    }
    return this.run({ conversationId, rebuild: null });
  }

  /**
   * Re-reads the learning records.
   * @returns Resolves once current.
   */
  public async refresh(): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    try {
      this.stateValue.set(await this.bridge.invoke<LearningState>(PersonaLearningChannel.State));
    } catch (error: unknown) {
      this.log.warn('PersonaLearning', 'Could not read the learning records', error);
    }
  }

  /**
   * Undoes a change persona learning made.
   * @param changeId The change.
   * @returns Returns true when it was undone.
   */
  public async undo(changeId: string): Promise<boolean> {
    return (await this.bridge?.invoke<boolean>(PersonaLearningChannel.Undo, changeId)) ?? false;
  }

  /**
   * Accepts and rejects changes waiting for review.
   * @param accept The changes to apply.
   * @param reject The changes to drop.
   * @returns Returns how many were applied.
   */
  public async review(accept: readonly string[], reject: readonly string[]): Promise<number> {
    return (
      (await this.bridge?.invoke<number>(PersonaLearningChannel.Review, { accept, reject })) ?? 0
    );
  }

  /**
   * Counts what a full rebuild would read, for the estimate shown before it starts (#1518).
   * @returns Returns the estimate, or null outside the desktop app.
   */
  public async estimateRebuild(): Promise<PersonaRebuildEstimate | null> {
    return (
      (await this.bridge?.invoke<PersonaRebuildEstimate>(PersonaLearningChannel.EstimateRebuild)) ??
      null
    );
  }

  /**
   * Starts a full rebuild over every conversation, and runs it. It carries on in the background, and
   * after a restart, until it has read everything or is cancelled.
   * @param request What to start.
   * @returns Returns null once started, or why it was not.
   */
  public async startRebuild(request: PersonaRebuildRequest): Promise<string | null> {
    const bridge: Bridge | undefined = this.bridge;
    if (bridge === undefined) {
      return 'Rebuilding runs only in the desktop app.';
    }
    if (this.runningState()) {
      return 'Already reading; try again in a moment.';
    }
    const error: string | null = await bridge.invoke<string | null>(
      PersonaLearningChannel.StartRebuild,
      request,
    );
    if (error !== null) {
      return error;
    }
    await this.refresh();
    void this.tick();
    return null;
  }

  /**
   * Cancels the rebuild under way. What it already learned stays.
   * @returns Resolves once cancelled.
   */
  public async cancelRebuild(): Promise<void> {
    this.rebuildCancelled = true;
    await this.bridge?.invoke<void>(PersonaLearningChannel.CancelRebuild);
    await this.refresh();
  }

  /**
   * Lists the copies of the persona kept when a rebuild started fresh, newest first.
   * @returns Returns them.
   */
  public async snapshots(): Promise<readonly PersonaSnapshot[]> {
    const copies: unknown = await this.bridge?.invoke<unknown>(
      PersonaLearningChannel.ListSnapshots,
    );
    return Array.isArray(copies) ? (copies as readonly PersonaSnapshot[]) : [];
  }

  /**
   * Puts a kept copy of the persona back; what stood before is kept as a copy of its own.
   * @param id The copy.
   * @returns Returns true when it was put back.
   */
  public async restoreSnapshot(id: string): Promise<boolean> {
    return (
      (await this.bridge?.invoke<boolean>(PersonaLearningChannel.RestoreSnapshot, id)) ?? false
    );
  }

  /**
   * Sets the topics persona learning never learns about.
   * @param topics The topics.
   * @returns Resolves once recorded.
   */
  public async ruleOut(topics: readonly string[]): Promise<void> {
    await this.bridge?.invoke<void>(PersonaLearningChannel.RuleOut, topics);
  }

  /**
   * Answers one of the open questions; an empty answer dismisses it.
   * @param questionId The question.
   * @param answer The answer.
   * @returns Returns true when the question was there.
   */
  public async answer(questionId: string, answer: string): Promise<boolean> {
    return (
      (await this.bridge?.invoke<boolean>(PersonaLearningChannel.AnswerQuestion, {
        questionId,
        answer,
      })) ?? false
    );
  }

  /**
   * Works through batches until there are none, or the run has read enough for now.
   * A rebuild reads until nothing is left, or it is cancelled; any other run reads a few batches and
   * leaves the rest for the next tick.
   * @param plan What to read: one conversation, every idle one, or the rebuild's.
   * @returns Returns what was done.
   */
  private async run(plan: RunPlan): Promise<LearningRunSummary> {
    const conversationId: string | null = plan.conversationId;
    const bridge: Bridge | undefined = this.bridge;
    if (bridge === undefined) {
      return failed('Persona learning runs only in the desktop app.');
    }
    this.runningState.set(true);
    let summary: LearningRunSummary = {
      applied: 0,
      pending: 0,
      refused: 0,
      messagesRead: 0,
      error: null,
    };
    try {
      this.rebuildCancelled = false;
      for (let index: number = 0; plan.rebuild !== null || index < BATCHES_PER_RUN; index += 1) {
        if (
          plan.rebuild !== null &&
          (this.rebuildCancelled || this.settings.get('persona.learningPaused'))
        ) {
          break;
        }
        const batch: LearningBatch | null = await bridge.invoke<LearningBatch | null>(
          PersonaLearningChannel.Begin,
          {
            idleMinutes:
              conversationId === null ? this.settings.get('persona.learningIdleMinutes') : 0,
            conversationId,
            rebuild: plan.rebuild !== null,
          },
        );
        if (batch === null || this.rebuildCancelled) {
          if (batch !== null) {
            await bridge.invoke<void>(PersonaLearningChannel.Abandon, batch.batchId);
          }
          break;
        }
        const outcome: LearningOutcome | string = await this.read(
          bridge,
          batch,
          plan.rebuild ?? {
            connectionId: this.settings.get('persona.learningConnectionId'),
            model: this.settings.get('persona.learningModel'),
          },
        );
        if (typeof outcome === 'string') {
          summary = { ...summary, error: outcome };
          break;
        }
        summary = {
          applied: summary.applied + outcome.applied,
          pending: summary.pending + outcome.pending,
          refused: summary.refused + outcome.refused,
          messagesRead: summary.messagesRead + outcome.messagesRead,
          error: null,
        };
      }
    } catch (error: unknown) {
      this.log.warn('PersonaLearning', 'A run failed', error);
      summary = { ...summary, error: 'Could not finish reading.' };
    } finally {
      this.runningState.set(false);
    }
    if (summary.messagesRead > 0 || summary.error !== null) {
      this.log.info(
        'PersonaLearning',
        `Read ${summary.messagesRead} message(s): ${summary.applied} applied, ${summary.pending} for review, ${summary.refused} refused${summary.error === null ? '' : `; ${summary.error}`}`,
      );
      for (const listener of this.finishedListeners) {
        listener(summary);
      }
    }
    return summary;
  }

  /**
   * Has the model read one batch, and hands its answer back.
   * @param bridge The bridge.
   * @param batch The batch.
   * @param model The connection and model to read it with.
   * @returns Returns what was done, or why nothing was.
   */
  private async read(
    bridge: Bridge,
    batch: LearningBatch,
    model: LearningModel,
  ): Promise<LearningOutcome | string> {
    const result: AiOneShotResult = await this.oneShot.complete({
      providerId: model.connectionId,
      model: model.model,
      prompt: buildLearningPrompt(batch),
      surface: 'models',
      timeoutMs: RUN_TIMEOUT_MS,
    });
    const proposal: LearningProposal | null =
      result.text === null ? null : parseLearningProposal(result.text);
    if (proposal === null) {
      await bridge.invoke<void>(PersonaLearningChannel.Abandon, batch.batchId);
      return result.error ?? 'The model did not answer in the expected form.';
    }
    const review: PersonaReviewMode = this.settings.get('persona.review');
    const outcome: LearningOutcome | null = await bridge.invoke<LearningOutcome | null>(
      PersonaLearningChannel.Finish,
      {
        batchId: batch.batchId,
        proposal,
        review,
      },
    );
    return outcome ?? 'The batch expired before it was finished.';
  }
}

/**
 * The connection and model a batch is read with.
 */
interface LearningModel {
  readonly connectionId: string;
  readonly model: string;
}

/**
 * What one run reads.
 */
interface RunPlan {
  /**
   * Gets the one conversation to read, or null for every idle one.
   */
  readonly conversationId: string | null;

  /**
   * Gets the rebuild being run, or null for an everyday run.
   */
  readonly rebuild: PersonaRebuildJob | null;
}

/**
 * A run that did nothing, and why.
 * @param error Why.
 * @returns Returns the summary.
 */
function failed(error: string): LearningRunSummary {
  return { applied: 0, pending: 0, refused: 0, messagesRead: 0, error };
}
