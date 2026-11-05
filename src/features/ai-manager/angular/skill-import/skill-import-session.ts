import {
  computed,
  DestroyRef,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { uniqueName, type PromptProfile } from '@shared/api/prompt-profile-channels';
import { SKILL_NAME_PATTERN } from '@shared/api/skill-channels';
import { skillProblem } from '@shared/api/skill-file';
import type {
  SkillImportAcceptedProfile,
  SkillImportAcceptedSkill,
  SkillImportDraft,
  SkillImportEntry,
  SkillImportPlan,
  SkillImportResult,
} from '@shared/api/skill-import-channels';
import { Log } from '@shared/angular/services/log/log';
import { SkillTransfer } from '@shared/angular/services/skills/skill-transfer';
import { SkillAssist, SkillAssistModel, SkillAssistResult } from '../skill-assist/skill-assist';

/**
 * How many files are improved at once after "Yes to all remaining", so the run keeps ahead of the
 * user without flooding the provider.
 */
const IMPROVE_CONCURRENCY: number = 3;

/**
 * How an accepted skill came to be what it is, shown in the end-of-run summary.
 */
export type ImportOrigin = 'as-drafted' | 'improved' | 'improved-auto' | 'converted' | 'restored';

/**
 * A skill the user accepted during the run.
 */
export interface ImportAcceptedSkill {
  /**
   * Gets the entry's source path.
   */
  readonly source: string;

  /**
   * Gets what would be written.
   */
  readonly draft: SkillImportDraft;

  /**
   * Gets whether it replaces a library skill.
   */
  readonly replace: boolean;

  /**
   * Gets how it came to be.
   */
  readonly origin: ImportOrigin;

  /**
   * Gets why an AI improvement fell back to the draft, or null when none failed. The summary shows a
   * failure as a chip; the reason is its tooltip.
   */
  readonly failure: string | null;

  /**
   * Gets whether the summary still includes it.
   */
  readonly included: boolean;
}

/**
 * A prompt profile the user accepted during the run.
 */
export interface ImportAcceptedProfile extends SkillImportAcceptedProfile {
  /**
   * Gets whether the summary still includes it.
   */
  readonly included: boolean;
}

/**
 * A file or profile that will not be imported, and why.
 */
export interface ImportLeftOut {
  /**
   * Gets what was left out: a source path, or a profile's name.
   */
  readonly label: string;

  /**
   * Gets why, in a word, for the summary's chip:
   * - `not-a-skill`: a README, licence or the like, passed over.
   * - `ignored`: the user chose Ignore.
   * - `name-taken`: its name clashed and the user chose Skip.
   * - `skipped`: it could have gone straight in, and the user chose Skip.
   */
  readonly kind: 'not-a-skill' | 'ignored' | 'name-taken' | 'skipped';

  /**
   * Gets why.
   */
  readonly reason: string;
}

/**
 * The answer to the offer to improve a file that can go straight in.
 */
export type ImproveAnswer = { readonly choice: FileChoice; readonly all: boolean } | 'cancel';

/**
 * What to do with a file that can go straight in: improve it with AI first, import it as it is, or
 * leave it out.
 */
export type FileChoice = 'improve' | 'as-is' | 'skip';

/**
 * The answer to the offer to help with a file that cannot go straight in.
 */
export type RepairAnswer = 'ai' | 'ignore' | 'cancel';

/**
 * The answer to an AI's version of a skill.
 */
export type ReviewAnswer =
  | { readonly action: 'accept'; readonly draft: SkillImportDraft }
  | { readonly action: 'draft' }
  | { readonly action: 'ignore' }
  | { readonly action: 'cancel' };

/**
 * The answer to a name clash.
 */
export type ClashAnswer =
  | { readonly action: 'replace' | 'skip'; readonly all: boolean }
  | { readonly action: 'rename'; readonly name: string; readonly all: boolean }
  | { readonly action: 'cancel' };

/**
 * The answer to the end-of-run summary.
 */
export type SummaryAnswer = 'import' | 'cancel';

/**
 * What the run is asking the user, or showing them.
 */
export type ImportPrompt =
  | { readonly kind: 'improve'; readonly entry: SkillImportEntry }
  | { readonly kind: 'repair'; readonly entry: SkillImportEntry }
  | { readonly kind: 'working'; readonly entry: SkillImportEntry; readonly label: string }
  | {
      readonly kind: 'review';
      readonly entry: SkillImportEntry;
      readonly original: SkillImportDraft;
      readonly proposed: SkillImportDraft;
      readonly purpose: 'improve' | 'repair';
    }
  | {
      readonly kind: 'ai-failed';
      readonly entry: SkillImportEntry;
      readonly reason: string;
      readonly notASkill: boolean;
      readonly canUseDraft: boolean;
    }
  | {
      readonly kind: 'clash';
      readonly subject: 'skill' | 'profile';
      readonly label: string;
      readonly name: string;
      readonly suggested: string;
      readonly withLibrary: boolean;
      readonly attempted: string | null;
      readonly error: string | null;
    }
  | { readonly kind: 'summary' }
  | { readonly kind: 'committing' };

/**
 * A question waiting on the user, with the resolver its answer settles.
 */
interface PendingPrompt {
  /**
   * Gets the prompt.
   */
  readonly prompt: ImportPrompt;

  /**
   * Settles the prompt.
   */
  readonly resolve: (answer: unknown) => void;
}

/**
 * Thrown inside the run when the user cancels, unwinding it to where the plan is discarded.
 */
class ImportCancelled extends Error {}

/**
 * Walks the user through an import one file at a time (#1263), as ruled on the epic:
 *
 * - A file that can go straight in is offered an AI improvement — Yes / No / Yes to all remaining /
 *   No to all remaining.
 * - A file that cannot is offered AI help or Ignore, and always stops to ask.
 * - An AI's version is shown for review, unless the user said "Yes to all remaining", in which case it
 *   is accepted and listed in the summary, where it can still be left out.
 * - A name clash asks Replace / Rename / Skip, with "same for all remaining clashes".
 * - Cancel, at any point, discards the whole run: nothing is written until the summary's Import.
 *
 * An export or a folder of `SKILL.md` folders comes back with no AI and no questions but clashes.
 */
@Service({ autoProvided: false })
export class SkillImportSession {
  /**
   * Holds the import and export client.
   */
  private readonly transfer: SkillTransfer = inject(SkillTransfer);

  /**
   * Holds the AI helper.
   */
  private readonly assist: SkillAssist = inject(SkillAssist);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the question waiting on the user, or null.
   */
  private readonly pendingState: WritableSignal<PendingPrompt | null> =
    signal<PendingPrompt | null>(null);

  /**
   * Holds the plan being walked, or null when no import is running.
   */
  private readonly planState: WritableSignal<SkillImportPlan | null> =
    signal<SkillImportPlan | null>(null);

  /**
   * Holds how far through the plan the run is: the 1-based number of the file being asked about.
   */
  private readonly positionState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the skills accepted so far.
   */
  private readonly acceptedState: WritableSignal<readonly ImportAcceptedSkill[]> = signal<
    readonly ImportAcceptedSkill[]
  >([]);

  /**
   * Holds the profiles accepted so far.
   */
  private readonly acceptedProfilesState: WritableSignal<readonly ImportAcceptedProfile[]> = signal<
    readonly ImportAcceptedProfile[]
  >([]);

  /**
   * Holds what was left out so far.
   */
  private readonly leftOutState: WritableSignal<readonly ImportLeftOut[]> = signal<
    readonly ImportLeftOut[]
  >([]);

  /**
   * Holds the error the last commit returned, shown on the summary.
   */
  private readonly errorState: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether the file dialog is up, so a second press does not open another.
   */
  private choosing: boolean = false;

  /**
   * Holds the controller that aborts every AI run of the import.
   */
  private abort: AbortController = new AbortController();

  /**
   * Holds the improvements started ahead of the user after "Yes to all remaining", by source.
   */
  private readonly prefetched: Map<string, Promise<SkillAssistResult>> = new Map<
    string,
    Promise<SkillAssistResult>
  >();

  /**
   * Gets the question waiting on the user, or null.
   */
  public readonly prompt: Signal<ImportPrompt | null> = computed(
    (): ImportPrompt | null => this.pendingState()?.prompt ?? null,
  );

  /**
   * Gets the plan being walked, or null when no import is running.
   */
  public readonly plan: Signal<SkillImportPlan | null> = this.planState.asReadonly();

  /**
   * Gets the 1-based number of the file being asked about.
   */
  public readonly position: Signal<number> = this.positionState.asReadonly();

  /**
   * Gets the skills accepted so far.
   */
  public readonly accepted: Signal<readonly ImportAcceptedSkill[]> =
    this.acceptedState.asReadonly();

  /**
   * Gets the profiles accepted so far.
   */
  public readonly acceptedProfiles: Signal<readonly ImportAcceptedProfile[]> =
    this.acceptedProfilesState.asReadonly();

  /**
   * Gets what was left out so far.
   */
  public readonly leftOut: Signal<readonly ImportLeftOut[]> = this.leftOutState.asReadonly();

  /**
   * Gets the error the last commit returned, or null.
   */
  public readonly error: Signal<string | null> = this.errorState.asReadonly();

  /**
   * Initializes the session, cancelling a run still going when its view goes away.
   */
  public constructor() {
    inject(DestroyRef).onDestroy((): void => this.cancel());
  }

  /**
   * Answers the question waiting on the user.
   * @param answer The answer, of the type the prompt's kind asks for.
   */
  public answer(
    answer: ImproveAnswer | RepairAnswer | ReviewAnswer | ClashAnswer | SummaryAnswer | 'retry',
  ): void {
    const pending: PendingPrompt | null = this.pendingState();
    if (pending !== null) {
      this.pendingState.set(null);
      pending.resolve(answer);
    }
  }

  /**
   * Cancels the run, whatever it is waiting on; nothing is written.
   */
  public cancel(): void {
    this.abort.abort();
    const pending: PendingPrompt | null = this.pendingState();
    this.pendingState.set(null);
    pending?.resolve('cancel');
  }

  /**
   * Includes or leaves out an accepted skill, from the summary.
   * @param source The skill's source.
   * @param included Whether it is imported.
   */
  public include(source: string, included: boolean): void {
    this.acceptedState.update(
      (accepted: readonly ImportAcceptedSkill[]): readonly ImportAcceptedSkill[] =>
        accepted.map((skill: ImportAcceptedSkill): ImportAcceptedSkill =>
          skill.source === source ? { ...skill, included } : skill,
        ),
    );
  }

  /**
   * Includes or leaves out an accepted profile, from the summary.
   * @param id The profile's id.
   * @param included Whether it is imported.
   */
  public includeProfile(id: string, included: boolean): void {
    this.acceptedProfilesState.update(
      (accepted: readonly ImportAcceptedProfile[]): readonly ImportAcceptedProfile[] =>
        accepted.map((item: ImportAcceptedProfile): ImportAcceptedProfile =>
          item.profile.id === id ? { ...item, included } : item,
        ),
    );
  }

  /**
   * Asks what to import and walks the user through importing it.
   * @param model Where AI help runs, or null when no AI is to be offered.
   * @param what Whether skills or prompt profiles are being imported.
   * @returns Returns a line saying what was imported, or null when the user cancelled.
   */
  public async start(
    model: SkillAssistModel | null,
    what: 'skills' | 'profiles' = 'skills',
  ): Promise<string | null> {
    // One import at a time: a second press while the dialog is up or a run is going does nothing.
    if (this.planState() !== null || this.choosing) {
      return null;
    }
    this.choosing = true;
    let plan: SkillImportPlan | null;
    try {
      plan =
        what === 'skills' ? await this.transfer.choose() : await this.transfer.chooseProfiles();
    } finally {
      this.choosing = false;
    }
    if (plan === null) {
      return null;
    }
    if (plan.entries.length === 0 && plan.profiles.length === 0) {
      await this.transfer.discard(plan.id);
      return what === 'skills'
        ? 'No Markdown files or skills were found there.'
        : 'No prompt profiles were found there.';
    }
    this.reset(plan);
    try {
      return await this.run(plan, model);
    } catch (error: unknown) {
      if (!(error instanceof ImportCancelled)) {
        this.log.error('SkillImportSession', 'Import failed', error);
      }
      await this.transfer.discard(plan.id);
      return error instanceof ImportCancelled
        ? null
        : 'The import stopped unexpectedly; nothing was imported.';
    } finally {
      this.abort.abort();
      this.planState.set(null);
      this.pendingState.set(null);
    }
  }

  /**
   * Walks the plan.
   * @param plan The plan.
   * @param model Where AI help runs, or null.
   * @returns Returns the summary line.
   */
  private async run(plan: SkillImportPlan, model: SkillAssistModel | null): Promise<string | null> {
    // What to do with every remaining file that can go straight in, once the user has said so; a
    // restore and a run without AI import them as they are without asking.
    let fileAll: FileChoice | null = plan.kind === 'restore' || model === null ? 'as-is' : null;
    let clashAll: 'replace' | 'skip' | 'rename' | null = null;
    for (let index: number = 0; index < plan.entries.length; index += 1) {
      const entry: SkillImportEntry = plan.entries[index];
      this.positionState.set(index + 1);
      let draft: SkillImportDraft = entry.draft;
      let origin: ImportOrigin = plan.kind === 'restore' ? 'restored' : 'as-drafted';
      let failure: string | null = null;
      if (entry.status === 'ready') {
        let choice: FileChoice | null = fileAll;
        if (choice === null) {
          const answer: ImproveAnswer = await this.ask<ImproveAnswer>({ kind: 'improve', entry });
          this.throwIfCancelled(answer);
          if (answer === 'cancel') {
            throw new ImportCancelled();
          }
          choice = answer.choice;
          if (answer.all) {
            fileAll = choice;
            if (choice === 'improve' && model !== null) {
              this.prefetch(plan.entries.slice(index), model);
            }
          } else if (choice === 'improve' && model !== null) {
            ({ draft, origin, failure } = await this.improveWithReview(entry, model));
          }
        }
        if (choice === 'skip') {
          this.leaveOut(entry.source, 'skipped', 'Left out when asked whether to improve it.');
          continue;
        }
        if (fileAll === 'improve' && model !== null) {
          this.showWorking(entry, 'Improving with AI');
          const result: SkillAssistResult = await (this.prefetched.get(entry.source) ??
            this.assist.improve(entry.draft, model, this.abort.signal));
          this.prefetched.delete(entry.source);
          this.throwIfAborted();
          if (
            result.kind === 'draft' &&
            skillProblem(result.draft.name, result.draft.description) === null
          ) {
            draft = result.draft;
            origin = 'improved-auto';
          } else {
            failure =
              result.kind === 'draft' ? 'The AI answered with an invalid skill.' : result.reason;
          }
        }
      } else {
        const answer: RepairAnswer = await this.ask<RepairAnswer>({ kind: 'repair', entry });
        this.throwIfCancelled(answer);
        if (answer === 'ignore' || model === null) {
          this.leaveOut(
            entry.source,
            entry.status === 'not-a-skill' ? 'not-a-skill' : 'ignored',
            entry.reason ?? 'Ignored.',
          );
          continue;
        }
        const repaired: SkillImportDraft | Omit<ImportLeftOut, 'label'> =
          await this.repairWithReview(entry, model);
        if ('kind' in repaired) {
          this.leaveOut(entry.source, repaired.kind, repaired.reason);
          continue;
        }
        draft = repaired;
        origin = 'converted';
      }
      // The name is settled last, once any AI has had its say on it.
      const settled: { name: string; replace: boolean } | null = await this.settleName(
        entry.source,
        draft.name,
        'skill',
        clashAll,
        (all: 'replace' | 'skip' | 'rename'): void => {
          clashAll = all;
        },
      );
      if (settled === null) {
        this.leaveOut(entry.source, 'name-taken', `A skill named ${draft.name} already exists.`);
        continue;
      }
      this.acceptedState.update(
        (accepted: readonly ImportAcceptedSkill[]): readonly ImportAcceptedSkill[] => [
          // Replacing a skill accepted earlier in this run drops the earlier one.
          ...accepted.filter(
            (skill: ImportAcceptedSkill): boolean => skill.draft.name !== settled.name,
          ),
          {
            source: entry.source,
            draft: { ...draft, name: settled.name },
            replace: settled.replace && plan.existingSkills.includes(settled.name),
            origin,
            failure,
            included: true,
          },
        ],
      );
    }
    let profileClashAll: 'replace' | 'skip' | 'rename' | null = null;
    for (const profile of plan.profiles) {
      const settled: { name: string; replace: boolean } | null = await this.settleName(
        profile.name,
        profile.id,
        'profile',
        profileClashAll,
        (all: 'replace' | 'skip' | 'rename'): void => {
          profileClashAll = all;
        },
      );
      if (settled === null) {
        this.leaveOut(profile.name, 'name-taken', 'A profile with that name already exists.');
        continue;
      }
      const filed: PromptProfile = { ...profile, id: settled.name };
      this.acceptedProfilesState.update(
        (accepted: readonly ImportAcceptedProfile[]): readonly ImportAcceptedProfile[] => [
          ...accepted.filter(
            (item: ImportAcceptedProfile): boolean => item.profile.id !== filed.id,
          ),
          {
            profile: filed,
            replace: settled.replace && plan.existingProfiles.includes(filed.id),
            included: true,
          },
        ],
      );
    }
    for (;;) {
      const answer: SummaryAnswer = await this.ask<SummaryAnswer>({ kind: 'summary' });
      this.throwIfCancelled(answer);
      const skills: readonly SkillImportAcceptedSkill[] = this.acceptedState()
        .filter((skill: ImportAcceptedSkill): boolean => skill.included)
        .map(({ source, draft, replace }: ImportAcceptedSkill): SkillImportAcceptedSkill => ({
          source,
          draft,
          replace,
        }));
      this.errorState.set(null);
      this.pendingState.set({ prompt: { kind: 'committing' }, resolve: (): void => undefined });
      const result: SkillImportResult = await this.transfer.commit({
        planId: plan.id,
        skills,
        profiles: this.acceptedProfilesState()
          .filter((item: ImportAcceptedProfile): boolean => item.included)
          .map(({ profile, replace }: ImportAcceptedProfile): SkillImportAcceptedProfile => ({
            profile,
            replace,
          })),
      });
      if (result.error === null) {
        return describe(result, this.leftOutState().length);
      }
      this.errorState.set(result.error);
    }
  }

  /**
   * Improves a file with AI and has the user review the result.
   * @param entry The file.
   * @param model Where to run.
   * @returns Returns the draft to use, how it came about, and why the AI failed when it did.
   */
  private async improveWithReview(
    entry: SkillImportEntry,
    model: SkillAssistModel,
  ): Promise<{ draft: SkillImportDraft; origin: ImportOrigin; failure: string | null }> {
    for (;;) {
      this.showWorking(entry, 'Improving with AI');
      const result: SkillAssistResult = await this.assist.improve(
        entry.draft,
        model,
        this.abort.signal,
      );
      this.throwIfAborted();
      if (result.kind !== 'draft') {
        const retry: ReviewAnswer | 'retry' = await this.ask<ReviewAnswer | 'retry'>({
          kind: 'ai-failed',
          entry,
          reason: result.reason,
          notASkill: false,
          canUseDraft: true,
        });
        this.throwIfCancelled(retry);
        if (retry === 'retry') {
          continue;
        }
        // Imported as drafted, and the summary says the improvement failed.
        return { draft: entry.draft, origin: 'as-drafted', failure: result.reason };
      }
      const review: ReviewAnswer = await this.ask<ReviewAnswer>({
        kind: 'review',
        entry,
        original: entry.draft,
        proposed: result.draft,
        purpose: 'improve',
      });
      this.throwIfCancelled(review);
      return review.action === 'accept'
        ? { draft: review.draft, origin: 'improved', failure: null }
        : { draft: entry.draft, origin: 'as-drafted', failure: null };
    }
  }

  /**
   * Converts a file the importer could not use with AI, and has the user review the result.
   * @param entry The file.
   * @param model Where to run.
   * @returns Returns the draft to use, or why the file is left out.
   */
  private async repairWithReview(
    entry: SkillImportEntry,
    model: SkillAssistModel,
  ): Promise<SkillImportDraft | Omit<ImportLeftOut, 'label'>> {
    for (;;) {
      this.showWorking(entry, 'Converting with AI');
      const result: SkillAssistResult = await this.assist.repair(
        entry.source,
        entry.draft,
        entry.reason ?? 'It is not in the skill format.',
        model,
        this.abort.signal,
      );
      this.throwIfAborted();
      if (result.kind !== 'draft') {
        const retry: ReviewAnswer | 'retry' = await this.ask<ReviewAnswer | 'retry'>({
          kind: 'ai-failed',
          entry,
          reason: result.reason,
          notASkill: result.kind === 'not-a-skill',
          canUseDraft: false,
        });
        this.throwIfCancelled(retry);
        if (retry === 'retry') {
          continue;
        }
        return {
          kind: result.kind === 'not-a-skill' ? 'not-a-skill' : 'ignored',
          reason: result.reason,
        };
      }
      const review: ReviewAnswer = await this.ask<ReviewAnswer>({
        kind: 'review',
        entry,
        original: entry.draft,
        proposed: result.draft,
        purpose: 'repair',
      });
      this.throwIfCancelled(review);
      return review.action === 'accept'
        ? review.draft
        : { kind: 'ignored', reason: entry.reason ?? 'Ignored.' };
    }
  }

  /**
   * Settles the name a skill or profile is filed under, asking when it clashes with the library or
   * with something already accepted in this run.
   * @param label What is being named, for the question.
   * @param name The name it would take.
   * @param subject Whether it is a skill or a profile.
   * @param all The answer given for all remaining clashes, or null.
   * @param remember Records an answer given for all remaining clashes.
   * @returns Returns the name and whether it replaces what holds it, or null to skip it.
   */
  private async settleName(
    label: string,
    name: string,
    subject: 'skill' | 'profile',
    all: 'replace' | 'skip' | 'rename' | null,
    remember: (all: 'replace' | 'skip' | 'rename') => void,
  ): Promise<{ name: string; replace: boolean } | null> {
    const plan: SkillImportPlan = this.planState()!;
    const library: readonly string[] =
      subject === 'skill' ? plan.existingSkills : plan.existingProfiles;
    const batch: readonly string[] =
      subject === 'skill'
        ? this.acceptedState().map((skill: ImportAcceptedSkill): string => skill.draft.name)
        : this.acceptedProfilesState().map(
            (item: ImportAcceptedProfile): string => item.profile.id,
          );
    const taken: (candidate: string) => boolean = (candidate: string): boolean =>
      library.includes(candidate) || batch.includes(candidate);
    if (!taken(name)) {
      return { name, replace: false };
    }
    const suggested: string = uniqueName(name, taken);
    if (all !== null) {
      return all === 'skip'
        ? null
        : all === 'replace'
          ? { name, replace: true }
          : { name: suggested, replace: false };
    }
    let attempted: string | null = null;
    let error: string | null = null;
    for (;;) {
      const answer: ClashAnswer = await this.ask<ClashAnswer>({
        kind: 'clash',
        subject,
        label,
        name,
        suggested,
        withLibrary: library.includes(name),
        attempted,
        error,
      });
      this.throwIfCancelled(answer);
      if (answer.action === 'cancel') {
        throw new ImportCancelled();
      }
      if (answer.all) {
        remember(answer.action);
      }
      if (answer.action !== 'rename') {
        return answer.action === 'skip' ? null : { name, replace: true };
      }
      // The name typed applies to this one; the remaining clashes take their suggested names.
      const chosen: string = answer.name.trim().toLowerCase();
      if (SKILL_NAME_PATTERN.test(chosen) && !taken(chosen)) {
        return { name: chosen, replace: false };
      }
      // Asked again, saying why, with what was typed kept for correcting.
      attempted = answer.name;
      error = !SKILL_NAME_PATTERN.test(chosen)
        ? 'Use lower-case letters, digits and hyphens.'
        : `${chosen} is taken too.`;
    }
  }

  /**
   * Starts improving the remaining ready files ahead of the user, a few at a time.
   * @param entries The entries from the current one on.
   * @param model Where to run.
   */
  private prefetch(entries: readonly SkillImportEntry[], model: SkillAssistModel): void {
    const queue: SkillImportEntry[] = entries.filter(
      (entry: SkillImportEntry): boolean => entry.status === 'ready',
    );
    const signal: AbortSignal = this.abort.signal;
    const next: () => void = (): void => {
      const entry: SkillImportEntry | undefined = queue.shift();
      if (entry === undefined || signal.aborted) {
        return;
      }
      const run: Promise<SkillAssistResult> = this.assist.improve(entry.draft, model, signal);
      this.prefetched.set(entry.source, run);
      void run.finally(next);
    };
    for (let slot: number = 0; slot < IMPROVE_CONCURRENCY; slot += 1) {
      next();
    }
  }

  /**
   * Shows that an AI is working on a file; Cancel is the one thing that can be done.
   * @param entry The file.
   * @param label What it is doing.
   */
  private showWorking(entry: SkillImportEntry, label: string): void {
    this.pendingState.set({
      prompt: { kind: 'working', entry, label },
      resolve: (): void => undefined,
    });
  }

  /**
   * Asks the user something and waits for the answer.
   * @param prompt The question.
   * @returns Returns the answer.
   */
  private ask<T>(prompt: ImportPrompt): Promise<T> {
    this.throwIfAborted();
    return new Promise<T>((resolve: (answer: T) => void): void => {
      this.pendingState.set({ prompt, resolve: resolve as (answer: unknown) => void });
    });
  }

  /**
   * Records something left out.
   * @param label What.
   * @param kind Why, in a word.
   * @param reason Why, in full.
   */
  private leaveOut(label: string, kind: ImportLeftOut['kind'], reason: string): void {
    this.leftOutState.update((leftOut: readonly ImportLeftOut[]): readonly ImportLeftOut[] => [
      ...leftOut,
      { label, kind, reason },
    ]);
  }

  /**
   * Unwinds the run when the answer was Cancel.
   * @param answer The answer.
   */
  private throwIfCancelled(answer: unknown): void {
    if (
      answer === 'cancel' ||
      (answer !== null &&
        typeof answer === 'object' &&
        (answer as { action?: unknown }).action === 'cancel')
    ) {
      throw new ImportCancelled();
    }
    this.throwIfAborted();
  }

  /**
   * Unwinds the run once it has been cancelled.
   */
  private throwIfAborted(): void {
    if (this.abort.signal.aborted) {
      throw new ImportCancelled();
    }
  }

  /**
   * Clears the state for a new run.
   * @param plan The plan.
   */
  private reset(plan: SkillImportPlan): void {
    this.abort = new AbortController();
    this.prefetched.clear();
    this.planState.set(plan);
    this.positionState.set(0);
    this.acceptedState.set([]);
    this.acceptedProfilesState.set([]);
    this.leftOutState.set([]);
    this.errorState.set(null);
  }
}

/**
 * Says what an import wrote.
 * @param result The commit's outcome.
 * @param leftOut How many files were left out.
 * @returns Returns the line.
 */
function describe(result: SkillImportResult, leftOut: number): string {
  const parts: string[] = [];
  if (result.skills > 0 || result.profiles === 0) {
    parts.push(`${result.skills} skill${result.skills === 1 ? '' : 's'}`);
  }
  if (result.profiles > 0) {
    parts.push(`${result.profiles} prompt profile${result.profiles === 1 ? '' : 's'}`);
  }
  let line: string = `Imported ${parts.join(' and ')}`;
  if (result.linksRewritten > 0) {
    line += `, with ${result.linksRewritten} link${result.linksRewritten === 1 ? '' : 's'} between them updated`;
  }
  if (leftOut > 0) {
    line += `; ${leftOut} left out`;
  }
  return `${line}.`;
}
