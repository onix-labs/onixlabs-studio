import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  model,
  ModelSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { diffLines } from 'diff';
import type { SkillImportDraft } from '@shared/api/skill-import-channels';
import { MarkdownField } from '@shared/angular/components/forms/markdown-field/markdown-field';
import {
  MultiSelect,
  MultiSelectItem,
} from '@shared/angular/components/forms/multi-select/multi-select';
import { TabList, TabListTab } from '@shared/angular/components/forms/tab-list/tab-list';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { PromptScopeEditor } from '../prompt-scope-editor/prompt-scope-editor';
import { SKILL_TAG_OPTIONS, splitSkillTags } from '../skill-tags/skill-tags';

/**
 * One line of the changes view.
 */
interface ChangeLine {
  /**
   * Gets whether the line was added, removed or kept.
   */
  readonly kind: 'added' | 'removed' | 'kept';

  /**
   * Gets the line's text.
   */
  readonly text: string;
}

/**
 * The most unchanged lines kept either side of a change; longer runs fold to a marker.
 */
const CONTEXT_LINES: number = 3;

/**
 * Shows an AI's version of a skill against what it started from (#1263), editable before it is
 * accepted: the name, the description and the instructions, with a second tab listing what changed.
 */
@Component({
  selector: 'app-skill-review',
  imports: [MarkdownField, MultiSelect, PromptScopeEditor, TabList, TextField],
  templateUrl: './skill-review.html',
  styleUrl: './skill-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillReview {
  /**
   * Gets what the AI started from.
   */
  public readonly original: InputSignal<SkillImportDraft> = input.required<SkillImportDraft>();

  /**
   * Gets or sets the version being reviewed, as the user edits it.
   */
  public readonly draft: ModelSignal<SkillImportDraft> = model.required<SkillImportDraft>();

  /**
   * Gets the options of a skill's languages and technologies.
   */
  protected readonly tagOptions: readonly MultiSelectItem[] = SKILL_TAG_OPTIONS;

  /**
   * Gets the version's languages and technologies as one selection, languages first, as the skill
   * editor shows them.
   */
  protected readonly tags: Signal<readonly string[]> = computed((): readonly string[] => [
    ...new Set<string>([...this.draft().scope.languages, ...this.draft().technologies]),
  ]);

  /**
   * Gets the tabs.
   */
  protected readonly tabs: readonly TabListTab[] = [
    { value: 'version', label: "AI's Version" },
    { value: 'changes', label: 'Changes' },
  ];

  /**
   * Holds the tab shown.
   */
  protected readonly tab: WritableSignal<string> = signal<string>('version');

  /**
   * Gets the changed lines, unchanged runs folded to their edges.
   */
  protected readonly changes: Signal<readonly ChangeLine[]> = computed(
    (): readonly ChangeLine[] => {
      const before: string = textOf(this.original());
      const after: string = textOf(this.draft());
      const lines: ChangeLine[] = [];
      for (const part of diffLines(before, after)) {
        const kind: ChangeLine['kind'] = part.added ? 'added' : part.removed ? 'removed' : 'kept';
        const texts: string[] = part.value.replace(/\n$/, '').split('\n');
        if (kind === 'kept' && texts.length > CONTEXT_LINES * 2 + 1) {
          lines.push(
            ...texts.slice(0, CONTEXT_LINES).map((text: string): ChangeLine => ({ kind, text })),
            { kind, text: `⋯ ${texts.length - CONTEXT_LINES * 2} unchanged lines ⋯` },
            ...texts.slice(-CONTEXT_LINES).map((text: string): ChangeLine => ({ kind, text })),
          );
        } else {
          lines.push(...texts.map((text: string): ChangeLine => ({ kind, text })));
        }
      }
      return lines;
    },
  );

  /**
   * Gets how many lines were added and removed.
   */
  protected readonly counts: Signal<{ added: number; removed: number }> = computed(
    (): { added: number; removed: number } => {
      let added: number = 0;
      let removed: number = 0;
      for (const part of diffLines(textOf(this.original()), textOf(this.draft()))) {
        if (part.added) {
          added += part.count ?? 0;
        } else if (part.removed) {
          removed += part.count ?? 0;
        }
      }
      return { added, removed };
    },
  );

  /**
   * Sets the languages and technologies from the one selection, split as the skill editor splits them.
   * @param ids The ids ticked.
   */
  protected setTags(ids: readonly string[]): void {
    const draft: SkillImportDraft = this.draft();
    const split: { languages: readonly string[]; technologies: readonly string[] } = splitSkillTags(
      ids,
      draft.scope.languages,
      draft.technologies,
    );
    this.edit({
      scope: { ...draft.scope, languages: split.languages },
      technologies: split.technologies,
    });
  }

  /**
   * Changes one field of the version being reviewed.
   * @param patch The fields to change.
   */
  protected edit(patch: Partial<SkillImportDraft>): void {
    this.draft.set({ ...this.draft(), ...patch });
  }
}

/**
 * Lays a draft out as the text the changes are counted over: its name, description and tags, then
 * its body.
 * @param draft The draft.
 * @returns Returns the text.
 */
function textOf(draft: SkillImportDraft): string {
  const tags: readonly string[] = [...draft.scope.languages, ...draft.technologies];
  return [
    `name: ${draft.name}`,
    `description: ${draft.description}`,
    ...(tags.length > 0 ? [`tags: ${tags.join(', ')}`] : []),
    '',
    draft.body.replace(/\s+$/, ''),
    '',
  ].join('\n');
}
