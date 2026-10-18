import type * as MonacoApi from 'monaco-editor';
import type { CodeSymbol, SymbolRange } from '@shared/angular/services/lsp/lsp-symbols';

/**
 * One document-symbol provider registered with a Monaco instance, with the languages it serves.
 */
interface RegisteredSymbolProvider {
  /**
   * Gets the language selector it was registered for.
   */
  readonly selector: MonacoApi.languages.LanguageSelector;

  /**
   * Gets the provider.
   */
  readonly provider: MonacoApi.languages.DocumentSymbolProvider;
}

/**
 * The one member of Monaco's languages namespace the capture replaces, writable.
 */
interface SymbolRegistration {
  /**
   * Registers a document-symbol provider for the languages a selector selects.
   */
  registerDocumentSymbolProvider: (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DocumentSymbolProvider,
  ) => MonacoApi.IDisposable;
}

/**
 * Holds the document-symbol providers registered with each Monaco instance since it was captured.
 * Weak, so a closed child window's instance goes with its entry.
 */
const PROVIDERS: WeakMap<object, RegisteredSymbolProvider[]> = new WeakMap<
  object,
  RegisteredSymbolProvider[]
>();

/**
 * Starts recording the document-symbol providers registered with a Monaco instance, so Studio's Go to
 * Symbol can ask them for a document's symbols where no language server answers (#1009) — the
 * TypeScript, JavaScript, JSON and CSS workers Monaco ships.
 *
 * Monaco keeps its provider registry internal: the public API registers a provider but offers no way
 * to query one (its own outline goes through private services). So the public registration function
 * is wrapped, once, as the instance loads — before any language activates and registers its
 * providers — and every provider registered through it is recorded on the way through. Registration
 * itself is untouched: the original function still runs and its disposable is returned, wrapped only
 * to forget the provider when it is disposed.
 * @param monaco The Monaco instance, freshly loaded.
 */
export function captureDocumentSymbolProviders(monaco: typeof MonacoApi): void {
  if (PROVIDERS.has(monaco.languages)) {
    return;
  }
  const registered: RegisteredSymbolProvider[] = [];
  PROVIDERS.set(monaco.languages, registered);
  // Typed as the one writable member it replaces; at runtime the namespace is a plain object.
  const languages: SymbolRegistration = monaco.languages;
  const register: SymbolRegistration['registerDocumentSymbolProvider'] =
    languages.registerDocumentSymbolProvider.bind(languages);
  languages.registerDocumentSymbolProvider = (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DocumentSymbolProvider,
  ): MonacoApi.IDisposable => {
    const entry: RegisteredSymbolProvider = { selector, provider };
    registered.push(entry);
    const disposable: MonacoApi.IDisposable = register(selector, provider);
    return {
      dispose: (): void => {
        const index: number = registered.indexOf(entry);
        if (index >= 0) {
          registered.splice(index, 1);
        }
        disposable.dispose();
      },
    };
  };
}

/**
 * Asks the document-symbol providers registered with a Monaco instance for a model's symbols, the
 * first to give an answer winning — the most recently registered first, as Monaco ranks them.
 * @param monaco The Monaco instance the model belongs to.
 * @param model The model.
 * @returns Returns the document's top-level symbols, nested, or null when no provider serves its
 * language or none gave an answer.
 */
export async function providedDocumentSymbols(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
): Promise<readonly CodeSymbol[] | null> {
  const language: string = model.getLanguageId();
  const candidates: readonly RegisteredSymbolProvider[] = [
    ...(PROVIDERS.get(monaco.languages) ?? []),
  ]
    .reverse()
    .filter((entry: RegisteredSymbolProvider): boolean => selects(entry.selector, language));
  for (const { provider } of candidates) {
    const source: MonacoApi.CancellationTokenSource = new monaco.CancellationTokenSource();
    try {
      const symbols: MonacoApi.languages.DocumentSymbol[] | null | undefined =
        await provider.provideDocumentSymbols(model, source.token);
      if (symbols !== null && symbols !== undefined) {
        return symbols.map(fromMonacoSymbol);
      }
    } catch {
      // A provider that fails is no answer; the next one may have one.
    } finally {
      source.dispose();
    }
  }
  return null;
}

/**
 * Determines whether a language selector selects a language. Monaco's selectors are a language id, a
 * filter naming one, or a list of either; a filter that names no language (a scheme or pattern alone)
 * selects every language, as Monaco reads it.
 * @param selector The selector.
 * @param language The language identifier.
 * @returns Returns true when the selector selects the language.
 */
function selects(selector: MonacoApi.languages.LanguageSelector, language: string): boolean {
  if (Array.isArray(selector)) {
    return selector.some((entry: string | MonacoApi.languages.LanguageFilter): boolean =>
      selects(entry, language),
    );
  }
  if (typeof selector === 'string') {
    return selector === language || selector === '*';
  }
  const filter: MonacoApi.languages.LanguageFilter = selector as MonacoApi.languages.LanguageFilter;
  return filter.language === undefined || filter.language === language || filter.language === '*';
}

/**
 * Converts one of Monaco's symbols, with its children, to Studio's. Monaco numbers kinds from zero in
 * the protocol's order, and lines and columns from one; the protocol numbers kinds from one, and lines
 * and characters from zero.
 * @param symbol Monaco's symbol.
 * @returns Returns the symbol.
 */
function fromMonacoSymbol(symbol: MonacoApi.languages.DocumentSymbol): CodeSymbol {
  return {
    name: symbol.name,
    kind: symbol.kind + 1,
    range: fromMonacoRange(symbol.range),
    selectionRange: fromMonacoRange(symbol.selectionRange),
    children: (symbol.children ?? []).map(fromMonacoSymbol),
  };
}

/**
 * Converts one of Monaco's ranges to a protocol range.
 * @param range Monaco's range, one-based.
 * @returns Returns the range, zero-based.
 */
function fromMonacoRange(range: MonacoApi.IRange): SymbolRange {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
  };
}
