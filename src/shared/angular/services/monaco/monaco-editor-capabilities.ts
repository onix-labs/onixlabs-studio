import type * as MonacoApi from 'monaco-editor';
import { selects } from './monaco-symbol-providers';

/**
 * One definition provider registered with a Monaco instance, with the languages it serves.
 */
interface RegisteredDefinitionProvider {
  /**
   * Gets the language selector it was registered for.
   */
  readonly selector: MonacoApi.languages.LanguageSelector;

  /**
   * Gets the provider.
   */
  readonly provider: MonacoApi.languages.DefinitionProvider;
}

/**
 * What is recorded of one Monaco instance since it was captured.
 */
interface CapturedCapabilities {
  /**
   * Gets the definition providers registered, in registration order.
   */
  readonly definitions: RegisteredDefinitionProvider[];

  /**
   * Gets the comment rules each language's configuration set, by language identifier.
   */
  readonly comments: Map<string, MonacoApi.languages.CommentRule>;
}

/**
 * The two members of Monaco's languages namespace the capture replaces, writable.
 */
interface CapabilityRegistration {
  /**
   * Registers a definition provider for the languages a selector selects.
   */
  registerDefinitionProvider: (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DefinitionProvider,
  ) => MonacoApi.IDisposable;

  /**
   * Sets a language's configuration: its brackets, comments and the like.
   */
  setLanguageConfiguration: (
    languageId: string,
    configuration: MonacoApi.languages.LanguageConfiguration,
  ) => MonacoApi.IDisposable;
}

/**
 * Holds what is recorded of each Monaco instance since it was captured. Weak, so a closed child
 * window's instance goes with its entry.
 */
const CAPTURED: WeakMap<object, CapturedCapabilities> = new WeakMap<object, CapturedCapabilities>();

/**
 * Starts recording what a Monaco instance's languages can do for Studio's right-click menu (#1012):
 * the definition providers registered with it, which Go to Definition asks where no language server
 * answers and which decide whether the item shows, and the comment rules each language's configuration
 * sets, which decide whether Toggle Comment does.
 *
 * Monaco keeps both registries internal, as it does the document-symbol providers (see
 * {@link import('./monaco-symbol-providers').captureDocumentSymbolProviders}), so the two public
 * registration functions are wrapped, once, as the instance loads — before any language activates.
 * Registration itself is untouched: the original function still runs and its disposable is returned,
 * wrapped only to forget the entry when it is disposed.
 * @param monaco The Monaco instance, freshly loaded.
 */
export function captureEditorCapabilities(monaco: typeof MonacoApi): void {
  if (CAPTURED.has(monaco.languages)) {
    return;
  }
  const captured: CapturedCapabilities = { definitions: [], comments: new Map() };
  CAPTURED.set(monaco.languages, captured);
  // Typed as the writable members it replaces; at runtime the namespace is a plain object.
  const languages: CapabilityRegistration = monaco.languages;
  const registerDefinition: CapabilityRegistration['registerDefinitionProvider'] =
    languages.registerDefinitionProvider.bind(languages);
  const setConfiguration: CapabilityRegistration['setLanguageConfiguration'] =
    languages.setLanguageConfiguration.bind(languages);
  languages.registerDefinitionProvider = (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DefinitionProvider,
  ): MonacoApi.IDisposable => {
    const entry: RegisteredDefinitionProvider = { selector, provider };
    captured.definitions.push(entry);
    const disposable: MonacoApi.IDisposable = registerDefinition(selector, provider);
    return {
      dispose: (): void => {
        const index: number = captured.definitions.indexOf(entry);
        if (index >= 0) {
          captured.definitions.splice(index, 1);
        }
        disposable.dispose();
      },
    };
  };
  languages.setLanguageConfiguration = (
    languageId: string,
    configuration: MonacoApi.languages.LanguageConfiguration,
  ): MonacoApi.IDisposable => {
    const comments: MonacoApi.languages.CommentRule | undefined = configuration.comments;
    if (comments !== undefined) {
      captured.comments.set(languageId, comments);
    }
    const disposable: MonacoApi.IDisposable = setConfiguration(languageId, configuration);
    return {
      dispose: (): void => {
        if (captured.comments.get(languageId) === comments) {
          captured.comments.delete(languageId);
        }
        disposable.dispose();
      },
    };
  };
}

/**
 * Determines whether a definition provider registered with a Monaco instance serves a language.
 * @param monaco The Monaco instance.
 * @param language The language identifier.
 * @returns Returns true when one does.
 */
export function hasDefinitionProvider(monaco: typeof MonacoApi, language: string): boolean {
  return (CAPTURED.get(monaco.languages)?.definitions ?? []).some(
    (entry: RegisteredDefinitionProvider): boolean => selects(entry.selector, language),
  );
}

/**
 * Determines whether a language's configuration, set on a Monaco instance, says how to comment a line
 * — a line comment, or a block comment Monaco wraps a line in when there is none.
 * @param monaco The Monaco instance.
 * @param language The language identifier.
 * @returns Returns true when the language has a comment rule.
 */
export function hasComments(monaco: typeof MonacoApi, language: string): boolean {
  const rule: MonacoApi.languages.CommentRule | undefined = CAPTURED.get(
    monaco.languages,
  )?.comments.get(language);
  return (
    rule !== undefined &&
    ((rule.lineComment !== undefined && rule.lineComment !== null) ||
      (rule.blockComment !== undefined && rule.blockComment !== null))
  );
}

/**
 * Asks the definition providers registered with a Monaco instance where the symbol at a position is
 * defined, the first to give an answer winning — the most recently registered first, as Monaco ranks
 * them.
 * @param monaco The Monaco instance the model belongs to.
 * @param model The model.
 * @param position The one-based position.
 * @returns Returns the definitions, each as the model and the span of its name, or empty when no
 * provider serves the language or none gave an answer.
 */
export async function providedDefinitions(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
  position: MonacoApi.IPosition,
): Promise<readonly MonacoApi.languages.Location[]> {
  const language: string = model.getLanguageId();
  const candidates: readonly RegisteredDefinitionProvider[] = [
    ...(CAPTURED.get(monaco.languages)?.definitions ?? []),
  ]
    .reverse()
    .filter((entry: RegisteredDefinitionProvider): boolean => selects(entry.selector, language));
  for (const { provider } of candidates) {
    const source: MonacoApi.CancellationTokenSource = new monaco.CancellationTokenSource();
    try {
      const answer: MonacoApi.languages.Definition | MonacoApi.languages.LocationLink[] | null =
        (await provider.provideDefinition(model, position as MonacoApi.Position, source.token)) ??
        null;
      const locations: readonly MonacoApi.languages.Location[] = toLocations(answer);
      if (locations.length > 0) {
        return locations;
      }
    } catch {
      // A provider that fails is no answer; the next one may have one.
    } finally {
      source.dispose();
    }
  }
  return [];
}

/**
 * Flattens a provider's answer to locations: a single location, a list of them, or a list of links —
 * whose target selection range, where given, is the name rather than the whole declaration.
 * @param answer The provider's answer, or null for none.
 * @returns Returns the locations.
 */
function toLocations(
  answer: MonacoApi.languages.Definition | MonacoApi.languages.LocationLink[] | null,
): readonly MonacoApi.languages.Location[] {
  if (answer === null) {
    return [];
  }
  const entries: readonly (MonacoApi.languages.Location | MonacoApi.languages.LocationLink)[] =
    Array.isArray(answer) ? answer : [answer];
  return entries.map(
    (
      entry: MonacoApi.languages.Location | MonacoApi.languages.LocationLink,
    ): MonacoApi.languages.Location => ({
      uri: entry.uri,
      range:
        'targetSelectionRange' in entry && entry.targetSelectionRange !== undefined
          ? entry.targetSelectionRange
          : entry.range,
    }),
  );
}
