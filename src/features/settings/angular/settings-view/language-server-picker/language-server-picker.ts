import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { LspServerSummary } from '@shared/api/lsp-channels';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';

/**
 * The languages a choice can exist for. A language only appears when the user has installed more than
 * one plugin providing a server for it, so the list is usually empty and grows as they install
 * alternatives.
 */
const LANGUAGES: readonly string[] = [
  'typescript',
  'javascript',
  'python',
  'csharp',
  'cpp',
  'c',
  'java',
  'kotlin',
  'rust',
  'go',
];

/**
 * Display names for the languages a choice can be made for.
 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  java: 'Java',
  kotlin: 'Kotlin',
  rust: 'Rust',
  go: 'Go',
};

/**
 * Describes one language the user can choose a server for.
 */
interface LanguageChoice {
  /**
   * Gets the language identifier.
   */
  readonly language: string;

  /**
   * Gets the display name.
   */
  readonly name: string;

  /**
   * Gets the installed servers offered for the language.
   */
  readonly options: readonly DropdownOption[];

  /**
   * Gets the server currently serving the language.
   */
  readonly selected: string;
}

/**
 * Lets the user choose which installed language server serves each language — the third layer of the
 * plugin model, and the reason to install a second implementation at all.
 *
 * Shows a language **only when two or more installed plugins provide a server for it**. A choice
 * between one thing is not a choice, and a choice between things the user has not installed would be
 * a menu of downloads; both belong in the Plugin Manager instead. So this section is empty on a fresh
 * installation and fills in as the user installs alternatives.
 */
@Component({
  selector: 'app-language-server-picker',
  imports: [Dropdown],
  templateUrl: './language-server-picker.html',
  styleUrl: './language-server-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageServerPicker {
  /**
   * Holds the language-server settings the choice is read from and written to.
   */
  private readonly lspSettings: LspSettings = inject(LspSettings);

  /**
   * Gets the languages that have a choice to make, with their installed servers.
   */
  protected readonly choices: Signal<readonly LanguageChoice[]> = computed(
    (): readonly LanguageChoice[] =>
      LANGUAGES.map((language: string): LanguageChoice => {
        const servers: readonly LspServerSummary[] = this.lspSettings.serversForLanguage(language);
        return {
          language,
          name: LANGUAGE_NAMES[language] ?? language,
          options: servers.map(
            (server: LspServerSummary): DropdownOption => ({
              value: server.id,
              label: server.displayName,
            }),
          ),
          selected: this.lspSettings.serverForLanguage(language) ?? '',
        };
      }).filter((choice: LanguageChoice): boolean => choice.options.length > 1),
  );

  /**
   * Gets whether any language has a choice to make, gating the empty state.
   */
  protected readonly hasChoices: Signal<boolean> = computed(
    (): boolean => this.choices().length > 0,
  );

  /**
   * Chooses which server serves a language.
   * @param language The language identifier.
   * @param serverId The chosen server.
   */
  protected choose(language: string, serverId: string): void {
    void this.lspSettings.setServerForLanguage(language, serverId);
  }
}
