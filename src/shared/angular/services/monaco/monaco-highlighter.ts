import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Settings } from '@shared/angular/services/settings/settings';
import { Monaco } from './monaco';
import { languageForExtension } from './monaco-languages';

/**
 * Maps common fenced-code info-strings that Monaco does not itself alias onto Monaco language
 * identifiers. Monaco's own alias table (consulted first) already covers most spellings — `ts`,
 * `py`, `c#` and so on — so this only fills the gaps and the shell family, which the app treats as
 * one `shell` language.
 */
const INFO_STRING_OVERRIDES: Readonly<Record<string, string>> = {
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  shell: 'shell',
  'shell-session': 'shell',
  console: 'shell',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  golang: 'go',
  'c++': 'cpp',
  'c#': 'csharp',
  yml: 'yaml',
  text: 'plaintext',
  txt: 'plaintext',
};

/**
 * Produces syntax-highlighted HTML for fenced code blocks using Monaco's colorizer, without ever
 * constructing an editor. Both the read-only surfaces (agent bubbles, markdown preview) and the
 * markdown editor's idle fences render through this, so a fence looks identical whether it is being
 * viewed or edited, and matches the code-editor tabs.
 *
 * The heavy Monaco runtime is pulled in on first use (a shared, one-time load) rather than bundled.
 * Until it is ready — and under the test runner, where it never loads — {@link colorize} yields an
 * empty string and callers fall back to plain, escaped text.
 */
@Service()
export class MonacoHighlighter {
  /**
   * Holds the Monaco loader and theme service.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the settings supplying the tab size and the current-line-highlight style that names the
   * active theme.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the lower-cased info-string/alias to Monaco language identifier map, built once from the
   * loaded Monaco language registry (plus the app's overrides).
   */
  private aliasToId: Map<string, string> | null = null;

  /**
   * Constructs the highlighter, kicking off the shared Monaco load so highlighting becomes available
   * shortly after the first code fence renders, even when no code-editor tab has been opened.
   */
  public constructor() {
    void this.monaco.ensureLoaded().catch((): void => undefined);
  }

  /**
   * Renders code to syntax-highlighted HTML for the given fence info-string, aligning the process-wide
   * Monaco theme to the current light/dark mode first so the colours match the editor tabs. Returns an
   * empty string before Monaco has loaded (so the caller keeps its plain-text fallback) and for an
   * unknown language falls back to Monaco's plain, escaped output.
   * @param code The raw code content.
   * @param lang The fence's info string (for example `ts`, `bash`, `c#`).
   * @returns Returns the highlighted HTML, or an empty string when Monaco is not yet available.
   */
  public async colorize(code: string, lang: string): Promise<string> {
    await this.monaco.ensureLoaded();
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return '';
    }
    // Aligning the theme is a no-op once it already matches the mode, so doing it per fence does not
    // churn any open editors; it only matters for the first fence rendered before any editor exists.
    monaco.editor.setTheme(this.monaco.getThemeName(this.settings.globalTextEditor().currentLineHighlight));
    return monaco.editor.colorize(code, this.resolveLanguageId(lang), {
      tabSize: this.settings.globalTextEditor().tabSize,
    });
  }

  /**
   * Resolves a fence info-string to a Monaco language identifier: its first word matched against
   * Monaco's language ids and aliases, then the app's overrides, then the file-extension table, and
   * finally `plaintext`.
   * @param lang The fence's info string.
   * @returns Returns the Monaco language identifier.
   */
  public resolveLanguageId(lang: string): string {
    const token: string = lang.trim().split(/\s+/, 1)[0].toLowerCase();
    if (token.length === 0) {
      return 'plaintext';
    }
    const map: Map<string, string> = this.ensureAliasMap();
    return map.get(token) ?? languageForExtension(token);
  }

  /**
   * Builds, once, the info-string to language-identifier map from Monaco's registered languages and
   * the app's overrides. Returns an overrides-only map when Monaco has not loaded yet, so resolution
   * still works for the common cases before the registry is available.
   * @returns Returns the alias map.
   */
  private ensureAliasMap(): Map<string, string> {
    if (this.aliasToId !== null) {
      return this.aliasToId;
    }
    const map: Map<string, string> = new Map<string, string>();
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    for (const language of monaco?.languages.getLanguages() ?? []) {
      map.set(language.id.toLowerCase(), language.id);
      for (const alias of language.aliases ?? []) {
        if (alias.length > 0) {
          map.set(alias.toLowerCase(), language.id);
        }
      }
    }
    for (const [alias, id] of Object.entries(INFO_STRING_OVERRIDES)) {
      map.set(alias, id);
    }
    // Cache only once the registry is loaded; before then the map is overrides-only and must be
    // rebuilt when Monaco becomes available.
    if (monaco !== undefined) {
      this.aliasToId = map;
    }
    return map;
  }
}
