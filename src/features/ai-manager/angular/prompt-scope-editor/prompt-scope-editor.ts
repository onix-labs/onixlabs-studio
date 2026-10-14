import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';
import {
  AGENT_SURFACE_LABELS,
  AGENT_SURFACES,
  AgentSurface,
  PromptScope,
} from '@shared/api/ai-types';
import {
  MultiSelect,
  MultiSelectItem,
} from '@shared/angular/components/forms/multi-select/multi-select';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import {
  knownLanguages,
  languageDisplayName,
} from '@shared/angular/services/plugins/language-names';

/**
 * Edits a {@link PromptScope}: which surfaces, and which editor languages, a prompt profile or a skill
 * applies to. Shared by both editors so the two features cannot drift in how a scope is described —
 * the same pickers, the same wording about what "nothing ticked" means.
 */
@Component({
  selector: 'app-prompt-scope-editor',
  imports: [MultiSelect, SettingRow],
  templateUrl: './prompt-scope-editor.html',
  styleUrl: './prompt-scope-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptScopeEditor {
  /**
   * Gets the surfaces a scope may name, in display order, each under its display name.
   */
  protected readonly surfaceOptions: readonly MultiSelectItem[] = AGENT_SURFACES.map(
    (surface: AgentSurface): MultiSelectItem => ({
      value: surface,
      label: AGENT_SURFACE_LABELS[surface],
    }),
  );

  /**
   * Gets the languages offered, each under its display name.
   */
  protected readonly languageOptions: readonly MultiSelectItem[] = knownLanguages().map(
    (language: string): MultiSelectItem => ({
      value: language,
      label: languageDisplayName(language),
    }),
  );

  /**
   * Gets or sets the scope being edited.
   */
  public readonly scope: ModelSignal<PromptScope> = model.required<PromptScope>();

  /**
   * Gets whether the controls are read-only.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Sets the surfaces. The picker reports values in option order, which is {@link AGENT_SURFACES}
   * order, so the scope's surfaces stay canonically ordered without a re-sort here.
   * @param surfaces The selected surfaces.
   */
  protected onSurfaces(surfaces: readonly string[]): void {
    this.scope.set({ ...this.scope(), surfaces: surfaces as readonly AgentSurface[] });
  }

  /**
   * Sets the languages.
   * @param languages The selected language identifiers.
   */
  protected onLanguages(languages: readonly string[]): void {
    this.scope.set({ ...this.scope(), languages });
  }
}
