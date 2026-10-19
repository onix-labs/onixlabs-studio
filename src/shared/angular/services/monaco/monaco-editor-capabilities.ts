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
 * One reference provider registered with a Monaco instance, with the languages it serves.
 */
interface RegisteredReferenceProvider {
  /**
   * Gets the language selector it was registered for.
   */
  readonly selector: MonacoApi.languages.LanguageSelector;

  /**
   * Gets the provider.
   */
  readonly provider: MonacoApi.languages.ReferenceProvider;
}

/**
 * One rename provider registered with a Monaco instance, with the languages it serves (#1015).
 */
interface RegisteredRenameProvider {
  /**
   * Gets the language selector it was registered for.
   */
  readonly selector: MonacoApi.languages.LanguageSelector;

  /**
   * Gets the provider.
   */
  readonly provider: MonacoApi.languages.RenameProvider;
}

/**
 * What a rename provider says of the symbol at a position, before the new name is asked for (#1015).
 */
export type ProvidedRenameLocation =
  | {
      /**
       * Gets that the symbol can be renamed.
       */
      readonly kind: 'ready';

      /**
       * Gets the span of the name.
       */
      readonly range: MonacoApi.IRange;

      /**
       * Gets the name as it stands.
       */
      readonly placeholder: string;
    }
  | {
      /**
       * Gets that the symbol cannot be renamed.
       */
      readonly kind: 'refused';

      /**
       * Gets why, as the provider put it, or null when it gave no reason.
       */
      readonly reason: string | null;
    };

/**
 * One document's edits in a rename provider's answer, by the URI of its model.
 */
export interface ProvidedFileEdits {
  /**
   * Gets the model's URI.
   */
  readonly uri: string;

  /**
   * Gets the edits: each span, one-based, and the text that replaces it.
   */
  readonly edits: readonly { readonly range: MonacoApi.IRange; readonly text: string }[];
}

/**
 * A rename provider's answer for a new name (#1015).
 */
export type ProvidedRename =
  | {
      /**
       * Gets that the provider answered with edits.
       */
      readonly kind: 'edits';

      /**
       * Gets the edits, by document, in the provider's order.
       */
      readonly files: readonly ProvidedFileEdits[];

      /**
       * Gets how many file operations (creating, renaming or deleting a file) the answer held, which
       * are not applied.
       */
      readonly fileOperations: number;
    }
  | {
      /**
       * Gets that the provider refused.
       */
      readonly kind: 'refused';

      /**
       * Gets why, as the provider put it, or null when it gave no reason.
       */
      readonly reason: string | null;
    };

/**
 * What is recorded of one Monaco instance since it was captured.
 */
interface CapturedCapabilities {
  /**
   * Gets the definition providers registered, in registration order.
   */
  readonly definitions: RegisteredDefinitionProvider[];

  /**
   * Gets the reference providers registered, in registration order (#1014).
   */
  readonly references: RegisteredReferenceProvider[];

  /**
   * Gets the rename providers registered, in registration order (#1015).
   */
  readonly renames: RegisteredRenameProvider[];

  /**
   * Gets the comment rules each language's configuration set, by language identifier.
   */
  readonly comments: Map<string, MonacoApi.languages.CommentRule>;
}

/**
 * The members of Monaco's languages namespace the capture replaces, writable.
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
   * Registers a reference provider for the languages a selector selects.
   */
  registerReferenceProvider: (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.ReferenceProvider,
  ) => MonacoApi.IDisposable;

  /**
   * Registers a rename provider for the languages a selector selects.
   */
  registerRenameProvider: (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.RenameProvider,
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
 * answers and which decide whether the item shows; the reference providers, which Find All References
 * asks the same way (#1014); the rename providers, which Rename Symbol asks the same way (#1015); and
 * the comment rules each language's configuration sets, which decide whether Toggle Comment does.
 *
 * Monaco keeps these registries internal, as it does the document-symbol providers (see
 * {@link import('./monaco-symbol-providers').captureDocumentSymbolProviders}), so the public
 * registration functions are wrapped, once, as the instance loads — before any language activates.
 * Registration itself is untouched: the original function still runs and its disposable is returned,
 * wrapped only to forget the entry when it is disposed.
 * @param monaco The Monaco instance, freshly loaded.
 */
export function captureEditorCapabilities(monaco: typeof MonacoApi): void {
  if (CAPTURED.has(monaco.languages)) {
    return;
  }
  const captured: CapturedCapabilities = {
    definitions: [],
    references: [],
    renames: [],
    comments: new Map(),
  };
  CAPTURED.set(monaco.languages, captured);
  // Typed as the writable members it replaces; at runtime the namespace is a plain object.
  const languages: CapabilityRegistration = monaco.languages;
  const registerDefinition: CapabilityRegistration['registerDefinitionProvider'] =
    languages.registerDefinitionProvider.bind(languages);
  const registerReferences: CapabilityRegistration['registerReferenceProvider'] =
    languages.registerReferenceProvider.bind(languages);
  const registerRename: CapabilityRegistration['registerRenameProvider'] =
    languages.registerRenameProvider.bind(languages);
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
  languages.registerReferenceProvider = (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.ReferenceProvider,
  ): MonacoApi.IDisposable => {
    const entry: RegisteredReferenceProvider = { selector, provider };
    captured.references.push(entry);
    const disposable: MonacoApi.IDisposable = registerReferences(selector, provider);
    return {
      dispose: (): void => {
        const index: number = captured.references.indexOf(entry);
        if (index >= 0) {
          captured.references.splice(index, 1);
        }
        disposable.dispose();
      },
    };
  };
  languages.registerRenameProvider = (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.RenameProvider,
  ): MonacoApi.IDisposable => {
    const entry: RegisteredRenameProvider = { selector, provider };
    captured.renames.push(entry);
    const disposable: MonacoApi.IDisposable = registerRename(selector, provider);
    return {
      dispose: (): void => {
        const index: number = captured.renames.indexOf(entry);
        if (index >= 0) {
          captured.renames.splice(index, 1);
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
 * Determines whether a reference provider registered with a Monaco instance serves a language (#1014).
 * @param monaco The Monaco instance.
 * @param language The language identifier.
 * @returns Returns true when one does.
 */
export function hasReferenceProvider(monaco: typeof MonacoApi, language: string): boolean {
  return (CAPTURED.get(monaco.languages)?.references ?? []).some(
    (entry: RegisteredReferenceProvider): boolean => selects(entry.selector, language),
  );
}

/**
 * Determines whether a rename provider registered with a Monaco instance serves a language (#1015).
 * @param monaco The Monaco instance.
 * @param language The language identifier.
 * @returns Returns true when one does.
 */
export function hasRenameProvider(monaco: typeof MonacoApi, language: string): boolean {
  return renameCandidates(monaco, language).length > 0;
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
 * Asks the reference providers registered with a Monaco instance for every reference to the symbol at
 * a position, its declaration included (#1014) — the first to give an answer winning, the most recently
 * registered first, as {@link providedDefinitions} does.
 * @param monaco The Monaco instance the model belongs to.
 * @param model The model.
 * @param position The one-based position.
 * @returns Returns the references, each as the model and the span, or empty when no provider serves
 * the language or none gave an answer.
 */
export async function providedReferences(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
  position: MonacoApi.IPosition,
): Promise<readonly MonacoApi.languages.Location[]> {
  const language: string = model.getLanguageId();
  const candidates: readonly RegisteredReferenceProvider[] = [
    ...(CAPTURED.get(monaco.languages)?.references ?? []),
  ]
    .reverse()
    .filter((entry: RegisteredReferenceProvider): boolean => selects(entry.selector, language));
  for (const { provider } of candidates) {
    const source: MonacoApi.CancellationTokenSource = new monaco.CancellationTokenSource();
    try {
      const answer: readonly MonacoApi.languages.Location[] =
        (await provider.provideReferences(
          model,
          position as MonacoApi.Position,
          { includeDeclaration: true },
          source.token,
        )) ?? [];
      if (answer.length > 0) {
        return answer;
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
 * Asks the rename providers registered with a Monaco instance what the symbol at a position is named
 * and where (#1015), the most recently registered first, as Monaco ranks them. The first that serves
 * the language decides: Monaco renames through one provider, the first to answer. A provider that
 * cannot say where (it has no `resolveRenameLocation`) is answered for by the word at the position.
 * @param monaco The Monaco instance the model belongs to.
 * @param model The model.
 * @param position The one-based position.
 * @returns Returns what the provider says, or null when no provider serves the language.
 */
export async function providedRenameLocation(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
  position: MonacoApi.IPosition,
): Promise<ProvidedRenameLocation | null> {
  const candidates: readonly RegisteredRenameProvider[] = renameCandidates(
    monaco,
    model.getLanguageId(),
  );
  if (candidates.length === 0) {
    return null;
  }
  for (const { provider } of candidates) {
    if (provider.resolveRenameLocation === undefined) {
      continue;
    }
    const source: MonacoApi.CancellationTokenSource = new monaco.CancellationTokenSource();
    try {
      const answer: (MonacoApi.languages.RenameLocation & MonacoApi.languages.Rejection) | null =
        (await provider.resolveRenameLocation(
          model,
          position as MonacoApi.Position,
          source.token,
        )) ?? null;
      if (answer === null) {
        continue;
      }
      if (answer.rejectReason !== undefined) {
        return { kind: 'refused', reason: answer.rejectReason };
      }
      return { kind: 'ready', range: answer.range, placeholder: answer.text };
    } catch (error: unknown) {
      return { kind: 'refused', reason: error instanceof Error ? error.message : null };
    } finally {
      source.dispose();
    }
  }
  const word: MonacoApi.editor.IWordAtPosition | null = model.getWordAtPosition(position);
  if (word === null) {
    return { kind: 'refused', reason: null };
  }
  return {
    kind: 'ready',
    range: {
      startLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endLineNumber: position.lineNumber,
      endColumn: word.endColumn,
    },
    placeholder: word.word,
  };
}

/**
 * Asks the rename providers registered with a Monaco instance for the edits that rename the symbol at
 * a position to a new name (#1015) — the first to answer winning, the most recently registered first.
 * @param monaco The Monaco instance the model belongs to.
 * @param model The model.
 * @param position The one-based position.
 * @param newName The new name.
 * @returns Returns the answer, or null when no provider serves the language or none answered.
 */
export async function providedRenameEdits(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
  position: MonacoApi.IPosition,
  newName: string,
): Promise<ProvidedRename | null> {
  for (const { provider } of renameCandidates(monaco, model.getLanguageId())) {
    const source: MonacoApi.CancellationTokenSource = new monaco.CancellationTokenSource();
    try {
      const answer: (MonacoApi.languages.WorkspaceEdit & MonacoApi.languages.Rejection) | null =
        (await provider.provideRenameEdits(
          model,
          position as MonacoApi.Position,
          newName,
          source.token,
        )) ?? null;
      if (answer === null) {
        continue;
      }
      if (answer.rejectReason !== undefined) {
        return { kind: 'refused', reason: answer.rejectReason };
      }
      return groupEdits(answer);
    } catch (error: unknown) {
      return { kind: 'refused', reason: error instanceof Error ? error.message : null };
    } finally {
      source.dispose();
    }
  }
  return null;
}

/**
 * Lists the rename providers that serve a language, the most recently registered first.
 * @param monaco The Monaco instance.
 * @param language The language identifier.
 * @returns Returns the providers.
 */
function renameCandidates(
  monaco: typeof MonacoApi,
  language: string,
): readonly RegisteredRenameProvider[] {
  return [...(CAPTURED.get(monaco.languages)?.renames ?? [])]
    .reverse()
    .filter((entry: RegisteredRenameProvider): boolean => selects(entry.selector, language));
}

/**
 * Groups a rename provider's workspace edit by document, counting the file operations it holds
 * rather than applying them.
 * @param answer The provider's edit.
 * @returns Returns the edits, by document, in the provider's order.
 */
function groupEdits(answer: MonacoApi.languages.WorkspaceEdit): ProvidedRename {
  const files: Map<string, { range: MonacoApi.IRange; text: string }[]> = new Map<
    string,
    { range: MonacoApi.IRange; text: string }[]
  >();
  let fileOperations: number = 0;
  for (const entry of answer.edits) {
    if (!('textEdit' in entry)) {
      fileOperations += 1;
      continue;
    }
    const uri: string = entry.resource.toString();
    const edits: { range: MonacoApi.IRange; text: string }[] = files.get(uri) ?? [];
    edits.push({ range: entry.textEdit.range, text: entry.textEdit.text });
    files.set(uri, edits);
  }
  return {
    kind: 'edits',
    files: [...files].map(
      ([uri, edits]: [string, { range: MonacoApi.IRange; text: string }[]]): ProvidedFileEdits => ({
        uri,
        edits,
      }),
    ),
    fileOperations,
  };
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
