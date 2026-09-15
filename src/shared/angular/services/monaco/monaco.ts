import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import {
  CurrentLineHighlightStyle,
  Settings,
  TextEditorSettings,
} from '@shared/angular/services/settings/settings';
import { ResolvedThemeMode, Theme } from '@shared/angular/services/theme/theme';
import { Log } from '@shared/angular/services/log/log';
import {
  extensionForLanguage,
  LanguageInfo,
  languageForExtension,
  languageForFileName,
  supportedLanguages,
} from './monaco-languages';
import {
  buildHeuristicSemanticTokens,
  HEURISTIC_SEMANTIC_TOKEN_LANGUAGES,
  HEURISTIC_SEMANTIC_TOKEN_LEGEND,
} from './monaco-heuristic-tokens';
import { defineThemes } from './monaco-themes';
import { registerAsmLanguage } from './monaco-asm-language';
import { registerBraceFolding } from './monaco-folding';

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
 * Resolves a path under the application's served assets to an absolute URL, against the main
 * document's base. A child window's document is `about:blank`, so a relative asset path handed to it
 * (a script, a worker) would resolve against nothing; the main document is where the assets live.
 * @param path The asset path, relative to the application root.
 * @returns Returns the absolute URL.
 */
function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds a value indicating whether Monaco has finished loading.
   */
  private readonly loadedSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the in-flight load promise, so concurrent callers share a single load.
   */
  private loadPromise: Promise<void> | null = null;

  /**
   * Holds the Monaco instance loaded into each child window, by window, so a window asks for it once
   * and every fence in that window shares it. Weak, so a closed window's entry goes with it.
   */
  private readonly childLoads: WeakMap<Window, Promise<typeof MonacoApi>> = new WeakMap<
    Window,
    Promise<typeof MonacoApi>
  >();

  /**
   * Holds the loaded child-window instances, so a theme change reaches every window's editors.
   */
  private readonly childInstances: Set<typeof MonacoApi> = new Set<typeof MonacoApi>();

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
   * Ensures Monaco is loaded into the window that owns a document, and returns that window's
   * instance.
   *
   * Monaco is not multi-window aware: it settles focus — and with it the caret, the selection colour
   * and whether its keybindings fire at all — against the document it was loaded into, and the
   * `monaco-editor` build exposes no way to register another window. So an editor created in a child
   * window (a modal, a popped-out panel) with the main window's instance is forever "unfocused":
   * hidden caret, inactive selection, Home/End/undo dead. The remedy is an instance per window, each
   * loaded into its own document, so that every window's editors resolve focus natively. For the main
   * document this is {@link ensureLoaded}; a child window gets its own loader, worker environment,
   * themes and languages, once, and shares them across its editors.
   * @param ownerDocument The document the editor will be created in.
   * @returns Returns a promise that resolves to the Monaco namespace loaded into that document's
   * window.
   */
  public async ensureLoadedIn(ownerDocument: Document): Promise<typeof MonacoApi> {
    if (ownerDocument === document) {
      await this.ensureLoaded();
      const main: typeof MonacoApi | undefined = window.monaco;
      if (main === undefined) {
        throw new Error('Monaco did not load into the main window.');
      }
      return main;
    }
    const target: Window | null = ownerDocument.defaultView;
    if (target === null) {
      throw new Error('The document has no window to load Monaco into.');
    }
    let load: Promise<typeof MonacoApi> | undefined = this.childLoads.get(target);
    if (load === undefined) {
      load = this.loadIntoChild(target);
      this.childLoads.set(target, load);
    }
    return load;
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
   * Resolves the Monaco language identifier for a file name, honouring the files whose whole name is
   * their type (`Dockerfile`) as well as those identified by extension.
   * @param fileName The file name, with or without a path.
   * @returns Returns the Monaco language identifier, or `plaintext` when nothing matches.
   */
  public getLanguageForFileName(fileName: string): string {
    return languageForFileName(fileName);
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
   * Re-registers the editor themes from the current accent-selection setting and accent colour (#314),
   * so a change to either is reflected the next time a surface applies its theme. A no-op before Monaco
   * has loaded.
   */
  public refreshThemes(): void {
    defineThemes(window.monaco, this.settings.textEditorAccentSelection());
    for (const instance of this.childInstances) {
      defineThemes(instance, this.settings.textEditorAccentSelection());
    }
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
      // A value of 0 tells Monaco to derive the line height from the font size; a value in (0, 8) is a
      // multiplier of it.
      lineHeight: resolved.lineHeight,
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
    defineThemes(window.monaco, this.settings.textEditorAccentSelection());
    registerAsmLanguage(window.monaco);
    registerBraceFolding(window.monaco);
    this.registerHeuristicSemanticTokens();
    this.loadedSignal.set(true);
    this.log.info('Monaco', 'Monaco editor initialized');
  }

  /**
   * Resolves the worker script URL for a Monaco language label. Workers are served from the copied
   * `vs/` assets.
   * @param _moduleId The requesting module identifier (unused).
   * @param label The language label.
   * @returns Returns the worker URL.
   */
  private resolveWorkerUrl(this: void, _moduleId: string, label: string): string {
    // Absolute against the application's own base, not the requesting window's: a child window's
    // document is `about:blank`, against which a relative worker path resolves to nothing.
    if (label === 'json') {
      return assetUrl('./vs/language/json/json.worker.js');
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return assetUrl('./vs/language/css/css.worker.js');
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return assetUrl('./vs/language/html/html.worker.js');
    }
    if (label === 'typescript' || label === 'javascript') {
      return assetUrl('./vs/language/typescript/ts.worker.js');
    }
    return assetUrl('./vs/editor/editor.worker.js');
  }

  /**
   * Injects the Monaco AMD loader script and resolves once the editor module has loaded.
   * @returns Returns a promise that resolves when Monaco is on `window.monaco`.
   */
  private async loadScript(): Promise<void> {
    if (window.monaco !== undefined) {
      return;
    }
    window.monaco = await this.loadInto(window);
  }

  /**
   * Loads a Monaco instance of its own into a child window and prepares it as the main window's is:
   * the worker environment, the themes, and the languages the application adds. The instance is
   * forgotten when the window goes, so a reopened modal loads afresh into its new window.
   * @param target The child window.
   * @returns Returns a promise that resolves to the instance loaded into the window.
   */
  private async loadIntoChild(target: Window): Promise<typeof MonacoApi> {
    const monaco: typeof MonacoApi = await this.loadInto(target);
    target.monaco = monaco;
    try {
      defineThemes(monaco, this.settings.textEditorAccentSelection());
      registerAsmLanguage(monaco, target);
      registerBraceFolding(monaco);
    } catch (error: unknown) {
      // A fence would otherwise fall silently back to its placeholder, with nothing to say why.
      this.log.error(
        'Monaco',
        'Failed to prepare Monaco in a child window',
        error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
      );
      throw error;
    }
    this.childInstances.add(monaco);
    target.addEventListener('pagehide', (): void => {
      this.childInstances.delete(monaco);
      this.childLoads.delete(target);
    });
    this.log.info('Monaco', 'Monaco editor initialized in a child window');
    return monaco;
  }

  /**
   * Injects the Monaco AMD loader into a window's document and resolves with the editor module once
   * it has loaded there. Every URL is absolute against the application's base, since a child window's
   * document has none of its own to resolve a relative one against.
   * @param target The window to load into.
   * @returns Returns a promise that resolves to the Monaco namespace loaded into the window.
   */
  private loadInto(target: Window): Promise<typeof MonacoApi> {
    return new Promise<typeof MonacoApi>(
      (resolve: (monaco: typeof MonacoApi) => void, reject: (reason: Error) => void): void => {
        target.MonacoEnvironment = { getWorkerUrl: this.resolveWorkerUrl };
        const targetDocument: Document = target.document;
        const script: HTMLScriptElement = targetDocument.createElement('script');
        script.src = assetUrl('./vs/loader.js');
        script.async = true;
        script.onload = (): void => {
          const loader: {
            config: (config: { paths: { vs: string } }) => void;
            (modules: readonly string[], callback: (monaco: typeof MonacoApi) => void): void;
          } = (target as unknown as { require: typeof loader }).require;
          loader.config({ paths: { vs: assetUrl('./vs') } });
          loader(['vs/editor/editor.main'], resolve);
        };
        script.onerror = (): void => {
          const error: Error = new Error('Failed to load the Monaco editor loader.');
          this.log.error('Monaco', 'Failed to load the Monaco editor loader', error);
          reject(error);
        };
        targetDocument.head.appendChild(script);
      },
    );
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
