import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { languageDisplayName } from '@shared/angular/services/plugins/language-names';
import { LanguageServerSettings } from '@features/settings/angular/settings-view/language-server-settings/language-server-settings';

/**
 * The setup wizard's step for one language's tooling: which installed server serves it, whether it
 * runs, its arguments, and the runtime it needs.
 *
 * A leaf beneath the Language Servers step, one per language with an installed server, exactly as
 * the settings tree grows them. The content is the settings view's own page for the language, not a
 * copy: what there is to decide about a language server is the same question wherever it is asked,
 * and a second rendering of it in the wizard would be a second thing to keep right.
 */
@Component({
  selector: 'app-setup-step-language',
  imports: [LanguageServerSettings],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-language-server-settings [language]="language()" [languageName]="languageName()" />
  `,
})
export class SetupStepLanguage {
  /**
   * Gets the Monaco language identifier this step configures.
   */
  public readonly language: InputSignal<string> = input.required<string>();

  /**
   * Gets the language's display name.
   */
  protected readonly languageName: Signal<string> = computed((): string =>
    languageDisplayName(this.language()),
  );
}
