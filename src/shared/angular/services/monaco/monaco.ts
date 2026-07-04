import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import {
  CurrentLineHighlightStyle,
  Settings,
  TextEditorSettings,
} from '@shared/angular/services/settings/settings';
import { ResolvedThemeMode, Theme } from '@shared/angular/services/theme/theme';
import {
  extensionForLanguage,
  LanguageInfo,
  languageForExtension,
  supportedLanguages,
} from './monaco-languages';
import {
  buildHeuristicSemanticTokens,
  HEURISTIC_SEMANTIC_TOKEN_LANGUAGES,
  HEURISTIC_SEMANTIC_TOKEN_LEGEND,
} from './monaco-heuristic-tokens';
import { defineThemes } from './monaco-themes';

// Re-exported so consumers keep importing these from `./monaco` (the split is internal): `LanguageInfo`
// is used by the code ribbon, and `MonarchToken`/`buildHeuristicSemanticTokens` by the spec.
export type { LanguageInfo } from './monaco-languages';
export type { MonarchToken } from './monaco-heuristic-tokens';
export { buildHeuristicSemanticTokens } from './monaco-heuristic-tokens';

declare global {
  /**
   * Augments the global window with the Monaco loader hooks and the loaded instance.
   */
  interface Window {
    /**
     * Holds the Monaco worker environment configuration.
     */
    MonacoEnvironment?: {
      /**
       * Resolves the worker script URL for a given Monaco language label.
       */
      getWorkerUrl?: (moduleId: string, label: string) => string;
    };

    /**
     * Holds the loaded Monaco namespace.
     */
    monaco?: typeof MonacoApi;
  }
}

/**
 * A minimal view of a Monaco language's service defaults, exposing only the diagnostics toggle. The
 * `monaco-editor` ESM type for `languages.typescript` is `any`, so this typed shape lets the
 * application turn diagnostics off without resorting to unsafe member access.
 */
interface MonacoDiagnosticsDefaults {
  /**
   * Sets the diagnostics options for the language.
   * @param options The diagnostics toggles to apply.
   */
  setDiagnosticsOptions(options: {
    readonly noSemanticValidation: boolean;
    readonly noSyntaxValidation: boolean;
    readonly noSuggestionDiagnostics: boolean;
  }): void;
}

/**
 * The shape of Monaco's TypeScript/JavaScript language contribution used to disable their built-in
 * diagnostics.
 */
interface MonacoTypescriptContribution {
  /**
   * Gets the TypeScript language service defaults.
   */
  readonly typescriptDefaults: MonacoDiagnosticsDefaults;

  /**
   * Gets the JavaScript language service defaults.
   */
  readonly javascriptDefaults: MonacoDiagnosticsDefaults;
}

/**
 * Loads and configures Monaco for the code editor: bootstraps the AMD loader, wires the worker
 * environment, registers the application's themes (built from the `--gray-*` palette), and exposes
 * language detection and default editor options derived from settings.
 *
 * Monaco is consumed through its runtime AMD loader rather than bundled, so the heavy editor never
 * enters the application's JavaScript bundle; only its type definitions are imported. The language
 * tables, the heuristic semantic-token scan, and the theme definitions live in sibling modules
 * (`monaco-languages`, `monaco-heuristic-tokens`, `monaco-themes`); this service loads Monaco and
 * orchestrates them.
 */
@Service()
export class Monaco {
  /**
   * Holds the settings service supplying editor preferences.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the theme service supplying the resolved light/dark mode.
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Holds a value indicating whether Monaco has finished loading.
   */
  private readonly loadedSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the in-flight load promise, so concurrent callers share a single load.
   */
  private loadPromise: Promise<void> | null = null;

  /**
   * Holds predicates that suppress the heuristic semantic tokens for the models they own. A language
   * server registers one (via {@link suppressHeuristicTokensWhen}) so its accurate tokens are never
   * second-guessed by the heuristic for documents it serves.
   */
  private readonly heuristicTokenSuppressors: Set<(model: MonacoApi.editor.ITextModel) => boolean> =
    new Set<(model: MonacoApi.editor.ITextModel) => boolean>();

  /**
   * Gets a value indicating whether Monaco has finished loading.
   */
  public readonly isLoaded: Signal<boolean> = this.loadedSignal.asReadonly();

  /**
   * Ensures Monaco is loaded, configuring the worker environment and registering themes on first
   * call. Subsequent calls share the original load.
   * @returns Returns a promise that resolves once Monaco is ready.
   */
  public ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.load();
    return this.loadPromise;
  }

  /**
   * Gets the loaded Monaco namespace, or undefined when it has not loaded yet.
   * @returns Returns the Monaco namespace, or undefined.
   */
  public getMonaco(): typeof MonacoApi | undefined {
    return window.monaco;
  }

  /**
   * Resolves the Monaco language identifier for a file extension.
   * @param extension The file extension, with or without a leading dot.
   * @returns Returns the Monaco language identifier, or `plaintext` when the extension is unknown.
   */
  public getLanguageForExtension(extension: string): string {
    return languageForExtension(extension);
  }

  /**
   * Resolves the canonical file extension for a Monaco language identifier (the first extension
   * registered for it), used to suggest a file name when saving a new document.
   * @param language The Monaco language identifier.
   * @returns Returns the extension with a leading dot, or an empty string for plaintext or a language
   * with no registered extension.
   */
  public getExtensionForLanguage(language: string): string {
    return extensionForLanguage(language);
  }

  /**
   * Disables Monaco's built-in diagnostics for a language, so a language server can be the sole
   * source of that language's diagnostics. Only TypeScript and JavaScript have a built-in Monaco
   * diagnostics worker; other languages have none, so this is a no-op for them. The change is global
   * (Monaco's language defaults are process-wide) and idempotent, and only takes effect once Monaco
   * has loaded.
   * @param languageId The Monaco language identifier whose built-in diagnostics are disabled.
   */
  public suppressBuiltInDiagnostics(languageId: string): void {
    const monaco: typeof MonacoApi | undefined = window.monaco;
    if (monaco === undefined) {
      return;
    }
    const typescript: MonacoTypescriptContribution | undefined = (
      monaco.languages as unknown as { typescript?: MonacoTypescriptContribution }
    ).typescript;
    if (typescript === undefined) {
      return;
    }
    const defaults: MonacoDiagnosticsDefaults | null =
      languageId === 'typescript'
        ? typescript.typescriptDefaults
        : languageId === 'javascript'
          ? typescript.javascriptDefaults
          : null;
    defaults?.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    });
  }

  /**
   * Gets the supported languages with their display names, sorted by display name.
   * @returns Returns the supported languages.
   */
  public getSupportedLanguages(): readonly LanguageInfo[] {
    return supportedLanguages();
  }

  /**
   * Builds the Monaco theme name for the current resolved mode and the given line-highlight style.
   * @param highlightStyle The current-line highlight style.
   * @returns Returns the registered theme name (for example `onix-dark-filled`).
   */
  public getThemeName(highlightStyle: CurrentLineHighlightStyle): string {
    const mode: ResolvedThemeMode = this.theme.resolvedMode();
    const suffix: string = highlightStyle === 'filled' ? 'filled' : 'outline';
    return `onix-${mode}-${suffix}`;
  }

  /**
   * Builds the Monaco construction options from the current settings, resolving per-language profile
   * overrides when a language is provided.
   * @param language The Monaco language identifier, used to resolve profile overrides.
   * @returns Returns the editor construction options.
   */
  public getEditorOptions(language: string): MonacoApi.editor.IStandaloneEditorConstructionOptions {
    const resolved: TextEditorSettings = this.settings.resolveSettingsForLanguage(language);
    return {
      theme: this.getThemeName(resolved.currentLineHighlight),
      automaticLayout: true,
      minimap: { enabled: resolved.showMinimap },
      fontSize: resolved.fontSize,
      fontFamily: `"${resolved.fontFamily}", monospace`,
      lineNumbers: resolved.showLineNumbers ? 'on' : 'off',
      // Widen the line-decorations lane to ~1rem so the change-margin bars sit in a clear gap between
      // the line numbers and the code, rather than hard against the text.
      lineDecorationsWidth: 16,
      wordWrap: resolved.wordWrap ? 'on' : 'off',
      stickyScroll: { enabled: resolved.stickyScroll },
      renderLineHighlight: resolved.currentLineHighlight === 'filled' ? 'all' : 'line',
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: resolved.tabSize,
      insertSpaces: resolved.insertSpaces,
      // Honour the configured indent verbatim rather than inferring it from file contents, so the
      // tab-size and tabs/spaces settings are authoritative.
      detectIndentation: false,
      cursorBlinking: resolved.cursorBlinking,
      cursorSmoothCaretAnimation: resolved.cursorSmoothCaretAnimation,
      smoothScrolling: true,
      padding: { top: 16 },
      // Colour language-server semantic tokens (types, members, parameters) for every theme, not only
      // the languages with a built-in Monaco worker.
      'semanticHighlighting.enabled': true,
    };
  }

  /**
   * Builds the Monaco diff-editor construction options from the current global settings. Shared by
   * every diff surface so the read-only, side-by-side comparison view resolves the same theme and font
   * as the single-editor pages. The caller supplies the `renderSideBySide` flag, which is a per-view
   * (inline vs side-by-side) choice rather than a global setting.
   * @returns Returns the diff-editor construction options.
   */
  public getDiffEditorOptions(): MonacoApi.editor.IStandaloneDiffEditorConstructionOptions {
    const resolved: TextEditorSettings = this.settings.globalTextEditor();
    return {
      theme: this.getThemeName(resolved.currentLineHighlight),
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderOverviewRuler: true,
      ignoreTrimWhitespace: false,
      enableSplitViewResizing: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: resolved.fontSize,
      fontFamily: `"${resolved.fontFamily}", monospace`,
      lineNumbers: 'on',
      padding: { top: 12 },
    };
  }

  /**
   * Loads the Monaco AMD loader, fetches the editor, configures the worker environment, and registers
   * the application's themes and heuristic semantic-token providers.
   * @returns Returns a promise that resolves once Monaco is ready.
   */
  private async load(): Promise<void> {
    window.MonacoEnvironment = { getWorkerUrl: this.resolveWorkerUrl };
    await this.loadScript();
    defineThemes(window.monaco);
    this.registerHeuristicSemanticTokens();
    this.loadedSignal.set(true);
  }

  /**
   * Resolves the worker script URL for a Monaco language label. Workers are served from the copied
   * `vs/` assets.
   * @param _moduleId The requesting module identifier (unused).
   * @param label The language label.
   * @returns Returns the worker URL.
   */
  private resolveWorkerUrl(this: void, _moduleId: string, label: string): string {
    if (label === 'json') {
      return './vs/language/json/json.worker.js';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return './vs/language/css/css.worker.js';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return './vs/language/html/html.worker.js';
    }
    if (label === 'typescript' || label === 'javascript') {
      return './vs/language/typescript/ts.worker.js';
    }
    return './vs/editor/editor.worker.js';
  }

  /**
   * Injects the Monaco AMD loader script and resolves once the editor module has loaded.
   * @returns Returns a promise that resolves when Monaco is on `window.monaco`.
   */
  private loadScript(): Promise<void> {
    return new Promise<void>((resolve: () => void, reject: (reason: Error) => void): void => {
      if (window.monaco !== undefined) {
        resolve();
        return;
      }

      const script: HTMLScriptElement = document.createElement('script');
      script.src = './vs/loader.js';
      script.async = true;
      script.onload = (): void => {
        const loader: {
          config: (config: { paths: { vs: string } }) => void;
          (modules: readonly string[], callback: (monaco: typeof MonacoApi) => void): void;
        } = (window as unknown as { require: typeof loader }).require;
        loader.config({ paths: { vs: './vs' } });
        loader(['vs/editor/editor.main'], (monaco: typeof MonacoApi): void => {
          window.monaco = monaco;
          resolve();
        });
      };
      script.onerror = (): void => reject(new Error('Failed to load the Monaco editor loader.'));
      document.head.appendChild(script);
    });
  }

  /**
   * Registers a predicate that suppresses the heuristic semantic tokens for the models it owns, so a
   * language server that supplies accurate semantic tokens for a document is never second-guessed —
   * and the heuristic skips its work — for that document. Predicates accumulate, so several owners
   * (for example one per workspace) can register independently.
   * @param predicate Returns true for a model the caller serves semantic tokens for.
   * @returns Returns a function that removes the predicate.
   */
  public suppressHeuristicTokensWhen(
    predicate: (model: MonacoApi.editor.ITextModel) => boolean,
  ): () => void {
    this.heuristicTokenSuppressors.add(predicate);
    return (): void => {
      this.heuristicTokenSuppressors.delete(predicate);
    };
  }

  /**
   * Registers the heuristic semantic-tokens provider for the languages whose Monaco-bundled Monarch
   * tokenizer leaves type and method identifiers uncoloured. The token scan is
   * {@link buildHeuristicSemanticTokens}; the registered themes paint the emitted `type` and
   * `function` tokens. A document a language server serves is skipped (see
   * {@link suppressHeuristicTokensWhen}), so the server's accurate tokens win without contention.
   */
  private registerHeuristicSemanticTokens(): void {
    const monaco: typeof MonacoApi | undefined = window.monaco;
    if (monaco === undefined) {
      return;
    }

    for (const languageId of HEURISTIC_SEMANTIC_TOKEN_LANGUAGES) {
      monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
        getLegend: (): MonacoApi.languages.SemanticTokensLegend => HEURISTIC_SEMANTIC_TOKEN_LEGEND,
        releaseDocumentSemanticTokens: (): void => undefined,
        provideDocumentSemanticTokens: (
          model: MonacoApi.editor.ITextModel,
        ): MonacoApi.languages.SemanticTokens | null => {
          if (this.isHeuristicTokensSuppressed(model)) {
            return null;
          }
          const source: string = model.getValue();
          const monarchLines: MonacoApi.Token[][] = monaco.editor.tokenize(source, languageId);
          return { data: buildHeuristicSemanticTokens(source, monarchLines), resultId: undefined };
        },
      });
    }
  }

  /**
   * Gets whether the heuristic semantic tokens are suppressed for a model because a registered owner
   * (typically a language server) serves it.
   * @param model The model a token request is for.
   * @returns Returns true when any registered predicate claims the model.
   */
  private isHeuristicTokensSuppressed(model: MonacoApi.editor.ITextModel): boolean {
    for (const predicate of this.heuristicTokenSuppressors) {
      if (predicate(model)) {
        return true;
      }
    }
    return false;
  }
}
