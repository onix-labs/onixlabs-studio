import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { SkillImportDraft, SkillImportEntry } from '@shared/api/skill-import-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Icon } from '@shared/angular/icons/icon';
import { SkillReview } from '../skill-review/skill-review';
import {
  ImportAcceptedSkill,
  ImportOrigin,
  ImportPrompt,
  SkillImportSession,
} from './skill-import-session';

/**
 * The labels an accepted skill's origin is shown with in the summary.
 */
const ORIGIN_LABELS: Readonly<Record<ImportOrigin, string | null>> = {
  'as-drafted': null,
  improved: 'Improved with AI',
  'improved-auto': 'Improved with AI, not reviewed',
  converted: 'Converted with AI',
  restored: null,
};

/**
 * The dialogs of an import (#1263): the per-file question, the AI's version under review, and the
 * end-of-run summary, each drawn from what {@link SkillImportSession} is waiting on. The small
 * questions and the large review sit in separate dialogs so a yes-or-no is not asked in a window
 * sized for reading a whole skill.
 */
@Component({
  selector: 'app-skill-import-modal',
  imports: [AppIcon, Button, ButtonRow, Checkbox, Modal, ModalContent, SkillReview, TextField],
  templateUrl: './skill-import-modal.html',
  styleUrl: './skill-import-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillImportModal {
  /**
   * Gets the name of the connection AI help runs through, or null when there is none.
   */
  public readonly aiLabel: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the glyph that turns while an AI works.
   */
  protected readonly spinner: Icon = Icon.SPINNER;

  /**
   * Holds the session the dialogs show.
   */
  protected readonly session: SkillImportSession = inject(SkillImportSession);

  /**
   * Gets the prompt shown, or null.
   */
  protected readonly prompt: Signal<ImportPrompt | null> = this.session.prompt;

  /**
   * Gets whether a small question is shown.
   */
  protected readonly questionOpen: Signal<boolean> = computed((): boolean => {
    const kind: ImportPrompt['kind'] | undefined = this.prompt()?.kind;
    return kind !== undefined && kind !== 'review' && kind !== 'summary';
  });

  /**
   * Gets whether the review or the summary is shown.
   */
  protected readonly largeOpen: Signal<boolean> = computed((): boolean => {
    const kind: ImportPrompt['kind'] | undefined = this.prompt()?.kind;
    return kind === 'review' || kind === 'summary';
  });

  /**
   * Holds the version under review, as the user edits it.
   */
  protected readonly reviewed: WritableSignal<SkillImportDraft | null> =
    signal<SkillImportDraft | null>(null);

  /**
   * Holds the name typed for a rename.
   */
  protected readonly rename: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether the answer to the offer to improve applies to all remaining files.
   */
  protected readonly improveAll: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether a clash answer applies to all remaining clashes.
   */
  protected readonly clashAll: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the total number of files in the run.
   */
  protected readonly total: Signal<number> = computed(
    (): number => this.session.plan()?.entries.length ?? 0,
  );

  /**
   * Gets the accepted skills still included.
   */
  protected readonly included: Signal<number> = computed(
    (): number =>
      this.session.accepted().filter((skill: ImportAcceptedSkill): boolean => skill.included)
        .length,
  );

  /**
   * Gets the summary's opening line: how many skills are selected, and the profiles coming with them.
   */
  protected readonly selectionLine: Signal<string> = computed((): string => {
    const profiles: number = this.session.acceptedProfiles().length;
    const skills: string = `${this.included()} of ${this.session.accepted().length} skills selected`;
    return profiles === 0
      ? `${skills}.`
      : `${skills}, and ${profiles} prompt profile${profiles === 1 ? '' : 's'}.`;
  });

  /**
   * Initializes the component, seeding the editable state from each new prompt.
   */
  public constructor() {
    effect((): void => {
      const prompt: ImportPrompt | null = this.prompt();
      if (prompt?.kind === 'review') {
        this.reviewed.set(prompt.proposed);
      }
      if (prompt?.kind === 'improve') {
        this.improveAll.set(false);
      }
      if (prompt?.kind === 'clash') {
        this.rename.set(prompt.suggested);
        this.clashAll.set(false);
      }
    });
  }

  /**
   * Gets the label shown for an accepted skill's origin.
   * @param origin The origin.
   * @returns Returns the label, or null for none.
   */
  protected originLabel(origin: ImportOrigin): string | null {
    return ORIGIN_LABELS[origin];
  }

  /**
   * Gets the entry a prompt is about, or null.
   * @param prompt The prompt.
   * @returns Returns the entry.
   */
  protected entryOf(prompt: ImportPrompt): SkillImportEntry | null {
    return 'entry' in prompt ? prompt.entry : null;
  }

  /**
   * Accepts the version under review.
   */
  protected accept(): void {
    const draft: SkillImportDraft | null = this.reviewed();
    if (draft !== null) {
      this.session.answer({ action: 'accept', draft });
    }
  }

  /**
   * Answers the offer to improve a file, for it alone or for all remaining files.
   * @param improve Whether to improve it.
   */
  protected answerImprove(improve: boolean): void {
    const all: boolean = this.improveAll();
    this.session.answer(improve ? (all ? 'yes-all' : 'yes') : all ? 'no-all' : 'no');
  }

  /**
   * Answers a clash.
   * @param action The action.
   */
  protected resolveClash(action: 'replace' | 'rename' | 'skip'): void {
    const all: boolean = this.clashAll();
    this.session.answer(
      action === 'rename' ? { action, name: this.rename(), all } : { action, all },
    );
  }

  /**
   * Cancels the whole import.
   */
  protected cancel(): void {
    this.session.cancel();
  }
}
