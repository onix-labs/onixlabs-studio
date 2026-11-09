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
import { Alert } from '@shared/angular/components/alert/alert';
import { skillProblem } from '@shared/api/skill-file';
import type { SkillImportDraft } from '@shared/api/skill-import-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Chip } from '@shared/angular/components/chip/chip';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Icon } from '@shared/angular/icons/icon';
import { SkillReview } from '../skill-review/skill-review';
import {
  FileChoice,
  ImportAcceptedProfile,
  ImportAcceptedSkill,
  ImportLeftOut,
  ImportPrompt,
  SkillImportSession,
} from './skill-import-session';

/**
 * One row of the summary's table: a skill or profile to import, or a file left out.
 */
type SummaryEntry =
  | { readonly kind: 'skill'; readonly skill: ImportAcceptedSkill }
  | { readonly kind: 'profile'; readonly item: ImportAcceptedProfile }
  | { readonly kind: 'left-out'; readonly item: ImportLeftOut };

/**
 * The summary table's columns.
 */
const SUMMARY_COLUMNS: readonly TableColumn[] = [
  { id: 'include', header: '', width: '2.75rem' },
  { id: 'name', header: 'Name', width: '24%' },
  { id: 'file', header: 'File' },
  { id: 'info', header: 'Info', width: '36%' },
];

/**
 * The chip each kind of left-out entry is shown with in the summary.
 */
const LEFT_OUT_LABELS: Readonly<Record<ImportLeftOut['kind'], string>> = {
  'not-a-skill': 'Not a skill',
  ignored: 'Ignored',
  'name-taken': 'Name taken',
  skipped: 'Skipped',
};

/**
 * The dialogs of an import (#1263): the per-file question, the AI's version under review, and the
 * end-of-run summary, each drawn from what {@link SkillImportSession} is waiting on. The small
 * questions and the large review sit in separate dialogs so a yes-or-no is not asked in a window
 * sized for reading a whole skill.
 */
@Component({
  selector: 'app-skill-import-modal',
  imports: [
    Alert,
    AppIcon,
    Button,
    ButtonRow,
    Checkbox,
    SettingRow,
    Toggle,
    Chip,
    Modal,
    ModalContent,
    SkillReview,
    Table,
    TableRowDef,
    TextField,
  ],
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
   * Gets why the version under review cannot be accepted — a name that is not a valid folder name, a
   * missing or over-long description — or null when it can.
   */
  protected readonly reviewProblem: Signal<string | null> = computed((): string | null => {
    const draft: SkillImportDraft | null = this.reviewed();
    return draft === null ? null : skillProblem(draft.name.trim(), draft.description.trim());
  });

  /**
   * Holds the name typed for a rename.
   */
  protected readonly rename: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether the answer to the offer to improve applies to all remaining files.
   */
  protected readonly fileAll: WritableSignal<boolean> = signal<boolean>(false);

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
    const parts: string[] = [];
    if (this.session.accepted().length > 0) {
      parts.push(`${this.included()} of ${this.session.accepted().length} skills`);
    }
    if (this.session.acceptedProfiles().length > 0) {
      parts.push(
        `${this.includedProfiles()} of ${this.session.acceptedProfiles().length} prompt profiles`,
      );
    }
    return `${parts.join(' and ')} selected.`;
  });

  /**
   * Gets the accepted profiles still included.
   */
  protected readonly includedProfiles: Signal<number> = computed(
    (): number =>
      this.session
        .acceptedProfiles()
        .filter((item: ImportAcceptedProfile): boolean => item.included).length,
  );

  /**
   * Gets the summary's Import button label: what it will write.
   */
  protected readonly importLabel: Signal<string> = computed((): string => {
    const skills: number = this.included();
    const profiles: number = this.includedProfiles();
    if (skills > 0 && profiles > 0) {
      return 'Import';
    }
    return profiles > 0
      ? `Import ${profiles} ${profiles === 1 ? 'Profile' : 'Profiles'}`
      : `Import ${skills} ${skills === 1 ? 'Skill' : 'Skills'}`;
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
        this.fileAll.set(false);
      }
      if (prompt?.kind === 'clash') {
        this.rename.set(prompt.attempted ?? prompt.suggested);
        this.clashAll.set(false);
      }
    });
  }

  /**
   * Gets the summary table's columns.
   */
  protected readonly summaryColumns: readonly TableColumn[] = SUMMARY_COLUMNS;

  /**
   * Gets the summary table's rows: the skills, then the profiles, then what was left out.
   */
  protected readonly summaryRows: Signal<readonly TableRow[]> = computed(
    (): readonly TableRow[] => [
      ...this.session.accepted().map((skill: ImportAcceptedSkill): TableRow => ({
        id: `skill:${skill.source}`,
        data: { kind: 'skill', skill } satisfies SummaryEntry,
      })),
      ...this.session.acceptedProfiles().map((item: ImportAcceptedProfile): TableRow => ({
        id: `profile:${item.profile.id}`,
        data: { kind: 'profile', item } satisfies SummaryEntry,
      })),
      ...this.session.leftOut().map((item: ImportLeftOut, index: number): TableRow => ({
        id: `left-out:${index}`,
        data: { kind: 'left-out', item } satisfies SummaryEntry,
      })),
    ],
  );

  /**
   * Gets, for each skill to import, the files it links to that will not be in the library — left
   * out, unticked, or never part of the import — by its source.
   */
  protected readonly brokenLinks: Signal<ReadonlyMap<string, readonly string[]>> = computed(
    (): ReadonlyMap<string, readonly string[]> => {
      const coming: ReadonlySet<string> = new Set(
        this.session
          .accepted()
          .filter((skill: ImportAcceptedSkill): boolean => skill.included)
          .map((skill: ImportAcceptedSkill): string => skill.source),
      );
      const broken: Map<string, readonly string[]> = new Map<string, readonly string[]>();
      for (const entry of this.session.plan()?.entries ?? []) {
        const missing: readonly string[] = entry.links.filter(
          (link: string): boolean => !coming.has(link),
        );
        if (missing.length > 0) {
          broken.set(entry.source, missing);
        }
      }
      return broken;
    },
  );

  /**
   * Gets the broken-links chip's label for a skill, or null when its links all hold.
   * @param source The skill's source.
   * @returns Returns the label.
   */
  protected brokenLabel(source: string): string | null {
    const count: number = this.brokenLinks().get(source)?.length ?? 0;
    return count === 0 ? null : `${count} broken link${count === 1 ? '' : 's'}`;
  }

  /**
   * Gets the broken-links chip's tooltip: the files the links point at.
   * @param source The skill's source.
   * @returns Returns the tooltip.
   */
  protected brokenTitle(source: string): string {
    return `Links to files that will not be imported: ${(this.brokenLinks().get(source) ?? []).join(', ')}`;
  }

  /**
   * Reads a summary row's entry.
   * @param row The row.
   * @returns Returns the entry.
   */
  protected summaryOf(row: TableRow): SummaryEntry {
    return row.data as SummaryEntry;
  }

  /**
   * Gets the chip a left-out entry is shown with.
   * @param kind Why it was left out.
   * @returns Returns the chip's label.
   */
  protected leftOutLabel(kind: ImportLeftOut['kind']): string {
    return LEFT_OUT_LABELS[kind];
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
   * Answers the question about a file that can go straight in, for it alone or for all remaining.
   * @param choice Improve it, import it as it is, or skip it.
   */
  protected answerImprove(choice: FileChoice): void {
    this.session.answer({ choice, all: this.fileAll() });
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
