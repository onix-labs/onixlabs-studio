import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { CurrentLineHighlightStyle, Settings, TextEditorSettings } from '../settings/settings';
import { ResolvedThemeMode, Theme } from '../theme/theme';

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
 * Describes a supported language and its display name.
 */
export interface LanguageInfo {
  /**
   * Gets the Monaco language identifier.
   */
  readonly id: string;

  /**
   * Gets the human-readable display name.
   */
  readonly name: string;
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
 * Maps file extensions (lower-case, leading dot) to Monaco language identifiers.
 */
const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  '.txt': 'plaintext',
  '.md': 'markdown',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.py': 'python',
  '.rb': 'ruby',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'cpp',
  '.cs': 'csharp',
  '.go': 'go',
  '.rs': 'rust',
  '.php': 'php',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'powershell',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.r': 'r',
  '.lua': 'lua',
  '.pl': 'perl',
  '.dockerfile': 'dockerfile',
  '.graphql': 'graphql',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

/**
 * Maps Monaco language identifiers to their display names.
 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  plaintext: 'Plain Text',
  markdown: 'Markdown',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  xml: 'XML',
  yaml: 'YAML',
  python: 'Python',
  ruby: 'Ruby',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rust',
  php: 'PHP',
  sql: 'SQL',
  shell: 'Shell',
  powershell: 'PowerShell',
  swift: 'Swift',
  kotlin: 'Kotlin',
  r: 'R',
  lua: 'Lua',
  perl: 'Perl',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  vue: 'Vue',
  svelte: 'Svelte',
};

/**
 * Holds the default language used when an extension is unknown.
 */
const DEFAULT_LANGUAGE: string = 'plaintext';

/**
 * Holds the fallback grey palette used when the document's CSS custom properties cannot be read (for
 * example under unit tests). Mirrors the `--gray-*` primitives in `_variables.scss`.
 */
const FALLBACK_GRAYS: Readonly<Record<string, string>> = {
  gray100: '#f8f9fa',
  gray200: '#e9ecef',
  gray800: '#343a40',
  gray900: '#212529',
};

/**
 * Loads and configures Monaco for the code editor: bootstraps the AMD loader, wires the worker
 * environment, registers the application's themes (built from the `--gray-*` palette), and exposes
 * language detection and default editor options derived from settings.
 *
 * Monaco is consumed through its runtime AMD loader rather than bundled, so the heavy editor never
 * enters the application's JavaScript bundle; only its type definitions are imported.
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
    const lower: string = extension.toLowerCase();
    const normalised: string = lower.startsWith('.') ? lower : `.${lower}`;
    return EXTENSION_TO_LANGUAGE[normalised] ?? DEFAULT_LANGUAGE;
  }

  /**
   * Resolves the canonical file extension for a Monaco language identifier (the first extension
   * registered for it), used to suggest a file name when saving a new document.
   * @param language The Monaco language identifier.
   * @returns Returns the extension with a leading dot, or an empty string for plaintext or a language
   * with no registered extension.
   */
  public getExtensionForLanguage(language: string): string {
    if (language === DEFAULT_LANGUAGE) {
      return '';
    }
    for (const [extension, mapped] of Object.entries(EXTENSION_TO_LANGUAGE)) {
      if (mapped === language) {
        return extension;
      }
    }
    return '';
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
    const ids: ReadonlySet<string> = new Set<string>(Object.values(EXTENSION_TO_LANGUAGE));
    return Array.from(
      ids,
      (id: string): LanguageInfo => ({ id, name: LANGUAGE_NAMES[id] ?? id }),
    ).sort((a: LanguageInfo, b: LanguageInfo): number => a.name.localeCompare(b.name));
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
   * Loads the Monaco AMD loader, fetches the editor, configures the worker environment, and registers
   * the application's themes.
   * @returns Returns a promise that resolves once Monaco is ready.
   */
  private async load(): Promise<void> {
    window.MonacoEnvironment = { getWorkerUrl: this.resolveWorkerUrl };
    await this.loadScript();
    this.defineThemes();
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
   * Registers the four `onix-{light,dark}-{outline,filled}` themes, painting the editor surface from
   * the application's `--gray-*` palette so it tracks light/dark with the rest of the app.
   */
  private defineThemes(): void {
    const monaco: typeof MonacoApi | undefined = window.monaco;
    if (monaco === undefined) {
      return;
    }

    const gray: (name: string) => string = (name: string): string => this.readGray(name);
    const gray100: string = gray('gray100');
    const gray200: string = gray('gray200');
    const gray800: string = gray('gray800');
    const gray900: string = gray('gray900');

    // Colour the standard semantic token types (and matching grammar tokens) so types, members, and
    // parameters are distinguished, not just keywords. Mirrors the VS Code Dark+/Light+ palettes.
    const semanticRules: (light: boolean) => MonacoApi.editor.ITokenThemeRule[] = (
      light: boolean,
    ): MonacoApi.editor.ITokenThemeRule[] => {
      const teal: string = light ? '267F99' : '4EC9B0';
      const yellow: string = light ? '795E26' : 'DCDCAA';
      const blue: string = light ? '001080' : '9CDCFE';
      const constant: string = light ? '0070C1' : '4FC1FF';
      const types: readonly string[] = [
        'type',
        'class',
        'interface',
        'enum',
        'struct',
        'typeParameter',
        'namespace',
        'macro',
      ];
      const functions: readonly string[] = ['function', 'method', 'decorator'];
      const variables: readonly string[] = ['variable', 'parameter', 'property'];
      return [
        ...types.map(
          (token: string): MonacoApi.editor.ITokenThemeRule => ({ token, foreground: teal }),
        ),
        ...functions.map(
          (token: string): MonacoApi.editor.ITokenThemeRule => ({ token, foreground: yellow }),
        ),
        ...variables.map(
          (token: string): MonacoApi.editor.ITokenThemeRule => ({ token, foreground: blue }),
        ),
        { token: 'enumMember', foreground: constant },
      ];
    };
    const darkRules: MonacoApi.editor.ITokenThemeRule[] = semanticRules(false);
    const lightRules: MonacoApi.editor.ITokenThemeRule[] = semanticRules(true);

    monaco.editor.defineTheme('onix-dark-outline', {
      base: 'vs-dark',
      inherit: true,
      rules: darkRules,
      colors: {
        'editor.background': gray900,
        'editor.selectionBackground': gray800,
        'editor.lineHighlightBackground': '#00000000',
        'editor.lineHighlightBorder': '#ffffff20',
        'editorCursor.foreground': '#ffffff',
      },
    });
    monaco.editor.defineTheme('onix-dark-filled', {
      base: 'vs-dark',
      inherit: true,
      rules: darkRules,
      colors: {
        'editor.background': gray900,
        'editor.selectionBackground': gray800,
        'editor.lineHighlightBackground': '#ffffff10',
        'editor.lineHighlightBorder': '#00000000',
        'editorCursor.foreground': '#ffffff',
      },
    });
    monaco.editor.defineTheme('onix-light-outline', {
      base: 'vs',
      inherit: true,
      rules: lightRules,
      colors: {
        'editor.background': gray100,
        'editor.selectionBackground': gray200,
        'editor.lineHighlightBackground': '#00000000',
        'editor.lineHighlightBorder': '#00000020',
        'editorCursor.foreground': '#ffffff',
      },
    });
    monaco.editor.defineTheme('onix-light-filled', {
      base: 'vs',
      inherit: true,
      rules: lightRules,
      colors: {
        'editor.background': gray100,
        'editor.selectionBackground': gray200,
        'editor.lineHighlightBackground': '#00000008',
        'editor.lineHighlightBorder': '#00000000',
        'editorCursor.foreground': '#ffffff',
      },
    });
  }

  /**
   * Registers a heuristic semantic-tokens provider for the languages whose Monaco-bundled Monarch
   * tokenizer leaves type and method identifiers uncolored (C#, Java, C, C++, Go, Rust, Kotlin). The
   * provider re-scans the buffer per request, emitting a `type` token for PascalCase identifiers and
   * a `function` token for identifiers immediately followed by `(`, which the registered themes then
   * paint (see {@link defineThemes}). Positions Monarch already classified as string/comment/keyword
   * are skipped so it never repaints over them.
   *
   * This is heuristic, not semantic: PascalCase constants colour as types, method definitions colour
   * the same as calls, and similar minor mislabels are inherent. TypeScript/JavaScript have a real
   * language service that already supplies semantic tokens, so they are excluded; a workspace's
   * language server, when present, supersedes this for accuracy.
   */
  private registerHeuristicSemanticTokens(): void {
    const monaco: typeof MonacoApi | undefined = window.monaco;
    if (monaco === undefined) {
      return;
    }

    // Index into the legend's tokenTypes for the "type" classification.
    const TOKEN_TYPE_INDEX: number = 0;
    // Index into the legend's tokenTypes for the "function" classification.
    const TOKEN_FUNCTION_INDEX: number = 1;
    // Sentinel value indicating an identifier was not classified.
    const NO_TOKEN_TYPE_INDEX: number = -1;
    // Minimum identifier length required before treating PascalCase as a type.
    const MIN_TYPE_NAME_LENGTH: number = 1;
    // Bitset of token modifiers applied to each emitted token (none).
    const NO_TOKEN_MODIFIERS: number = 0;
    // Delta-line value identifying a token on the same line as the previous one.
    const SAME_LINE_DELTA: number = 0;
    // Step used to adjust binary-search bounds by a single index.
    const BINARY_SEARCH_STEP: number = 1;
    // Right shift amount that halves a value (integer divide by two).
    const HALVE_SHIFT: number = 1;

    const legend: MonacoApi.languages.SemanticTokensLegend = {
      tokenTypes: ['type', 'function'],
      tokenModifiers: [],
    };

    // Languages whose Monaco-bundled Monarch tokenizer doesn't colour type/method identifiers.
    const targets: readonly string[] = ['csharp', 'java', 'kotlin', 'rust', 'go', 'cpp', 'c'];

    const identifierPattern: RegExp = /\b([A-Za-z_]\w*)(\s*[<(])?/g;
    const isSkippableTokenType: (type: string) => boolean = (type: string): boolean =>
      type.startsWith('string') || type.startsWith('comment') || type.startsWith('keyword');

    for (const languageId of targets) {
      monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
        getLegend: (): MonacoApi.languages.SemanticTokensLegend => legend,
        releaseDocumentSemanticTokens: (): void => undefined,
        provideDocumentSemanticTokens: (
          model: MonacoApi.editor.ITextModel,
        ): MonacoApi.languages.SemanticTokens => {
          const source: string = model.getValue();
          const monarchLines: MonacoApi.Token[][] = monaco.editor.tokenize(source, languageId);
          const lines: readonly string[] = source.split(/\r\n|\r|\n/);
          const data: number[] = [];
          let prevLine: number = 0;
          let prevChar: number = 0;

          for (let lineIdx: number = 0; lineIdx < lines.length; lineIdx++) {
            const line: string = lines[lineIdx];
            const lineTokens: MonacoApi.Token[] = monarchLines[lineIdx] ?? [];

            // Binary search the Monarch token covering a given column, so identifiers inside
            // strings or comments can be skipped.
            const tokenTypeAt: (col: number) => string = (col: number): string => {
              let lo: number = 0;
              let hi: number = lineTokens.length - BINARY_SEARCH_STEP;
              let best: number = 0;
              while (lo <= hi) {
                const mid: number = (lo + hi) >> HALVE_SHIFT;
                if (lineTokens[mid].offset <= col) {
                  best = mid;
                  lo = mid + BINARY_SEARCH_STEP;
                } else {
                  hi = mid - BINARY_SEARCH_STEP;
                }
              }
              return lineTokens[best]?.type ?? '';
            };

            identifierPattern.lastIndex = 0;
            let match: RegExpExecArray | null = identifierPattern.exec(line);
            while (match !== null) {
              const name: string = match[1];
              const trailer: string = (match[2] ?? '').trim();
              const startChar: number = match.index;

              if (!isSkippableTokenType(tokenTypeAt(startChar))) {
                let tokenTypeIdx: number = NO_TOKEN_TYPE_INDEX;
                if (trailer === '(') {
                  tokenTypeIdx = TOKEN_FUNCTION_INDEX;
                } else if (/^[A-Z]/.test(name) && name.length > MIN_TYPE_NAME_LENGTH) {
                  tokenTypeIdx = TOKEN_TYPE_INDEX;
                }
                if (tokenTypeIdx !== NO_TOKEN_TYPE_INDEX) {
                  const deltaLine: number = lineIdx - prevLine;
                  const deltaChar: number =
                    deltaLine === SAME_LINE_DELTA ? startChar - prevChar : startChar;
                  data.push(deltaLine, deltaChar, name.length, tokenTypeIdx, NO_TOKEN_MODIFIERS);
                  prevLine = lineIdx;
                  prevChar = startChar;
                }
              }
              match = identifierPattern.exec(line);
            }
          }

          return { data: new Uint32Array(data), resultId: undefined };
        },
      });
    }
  }

  /**
   * Reads a `--gray-*` custom property from the document root, falling back to a known value when it
   * cannot be resolved.
   * @param name The grey name (for example `gray900`).
   * @returns Returns the resolved hex colour.
   */
  private readGray(name: string): string {
    const variable: string = `--${name.replace('gray', 'gray-')}`;
    const value: string = getComputedStyle(document.documentElement)
      .getPropertyValue(variable)
      .trim();
    return value.length > 0 ? value : FALLBACK_GRAYS[name];
  }
}
