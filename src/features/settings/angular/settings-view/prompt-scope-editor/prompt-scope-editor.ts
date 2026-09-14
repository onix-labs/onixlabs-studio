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
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { LanguageSelect } from '@shared/angular/components/forms/language-select/language-select';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { knownLanguages } from '@shared/angular/services/plugins/language-names';

/**
 * Edits a {@link PromptScope}: which surfaces, and which editor languages, a prompt profile or a skill
 * applies to. Shared by both editors so the two features cannot drift in how a scope is described —
 * the same checkboxes, the same wording about what "none ticked" means.
 */
@Component({
  selector: 'app-prompt-scope-editor',
  imports: [Checkbox, LanguageSelect, SettingRow],
  templateUrl: './prompt-scope-editor.html',
  styleUrl: './prompt-scope-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptScopeEditor {
  /**
   * Gets the surfaces a scope may name, in display order.
   */
  protected readonly surfaces: readonly AgentSurface[] = AGENT_SURFACES;

  /**
   * Gets the display name of each surface.
   */
  protected readonly labels: Readonly<Record<AgentSurface, string>> = AGENT_SURFACE_LABELS;

  /**
   * Gets the language identifiers offered.
   */
  protected readonly languageOptions: readonly string[] = knownLanguages();

  /**
   * Gets or sets the scope being edited.
   */
  public readonly scope: ModelSignal<PromptScope> = model.required<PromptScope>();

  /**
   * Gets whether the controls are read-only.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Determines whether a surface is in the scope.
   * @param surface The surface.
   * @returns Returns true when it is named.
   */
  protected has(surface: AgentSurface): boolean {
    return this.scope().surfaces.includes(surface);
  }

  /**
   * Adds or removes a surface.
   * @param surface The surface.
   * @param on Whether it should be in the scope.
   */
  protected toggle(surface: AgentSurface, on: boolean): void {
    const current: PromptScope = this.scope();
    const surfaces: readonly AgentSurface[] = on
      ? AGENT_SURFACES.filter(
          (candidate: AgentSurface): boolean =>
            candidate === surface || current.surfaces.includes(candidate),
        )
      : current.surfaces.filter((candidate: AgentSurface): boolean => candidate !== surface);
    this.scope.set({ ...current, surfaces });
  }

  /**
   * Sets the languages.
   * @param languages The selected language identifiers.
   */
  protected onLanguages(languages: readonly string[]): void {
    this.scope.set({ ...this.scope(), languages });
  }
}
