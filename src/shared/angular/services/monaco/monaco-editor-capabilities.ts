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
 * One code-action provider registered with a Monaco instance, with the languages it serves (#1016).
 */
interface RegisteredCodeActionProvider {
  /**
   * Gets the language selector it was registered for.
   */
  readonly selector: MonacoApi.languages.LanguageSelector;

  /**
   * Gets the provider.
   */
  readonly provider: MonacoApi.languages.CodeActionProvider;
}

/**
 * One hover provider registered with a Monaco instance, with the languages it serves (#1020).
 */
interface RegisteredHoverProvider {
  /**
   * Gets the language selector it was registered for.
   */
  readonly selector: MonacoApi.languages.LanguageSelector;

  /**
   * Gets the provider.
   */
  readonly provider: MonacoApi.languages.HoverProvider;
}

/**
 * One hover provider's answer at a position (#1020): what it says of the symbol there, and the span it
 * says it of.
 */
export interface ProvidedHover {
  /**
   * Gets the answer's blocks, as markdown, in the provider's order.
   */
  readonly contents: readonly MonacoApi.IMarkdownString[];

  /**
   * Gets the span the answer is about, one-based, or null when the provider gave none.
   */
  readonly range: MonacoApi.IRange | null;

  /**
   * Gets whether the answer came from one of Studio's own providers (a language server's), which a
   * hover card prefers to Monaco's built-in workers for the same language.
   */
  readonly studio: boolean;
}

/**
 * One code action a Monaco provider offered (#1016), with the provider that can fill it in.
 */
export interface ProvidedCodeAction {
  /**
   * Gets the action, as the provider offered it.
   */
  readonly action: MonacoApi.languages.CodeAction;

  /**
   * Gets the provider that offered it.
   */
  readonly provider: MonacoApi.languages.CodeActionProvider;
}

/**
 * The code actions Monaco's providers offered at a span (#1016), held until they are released.
 */
export interface ProvidedCodeActions {
  /**
   * Gets the actions, the most recently registered provider's first.
   */
  readonly actions: readonly ProvidedCodeAction[];

  /**
   * Releases what the providers hold for their actions. Called once an action has been chosen and
   * run, or the actions are no longer wanted.
   */
  dispose(): void;
}

/**
 * A workspace edit from one of Monaco's providers, by document (#1016).
 */
export interface ProvidedWorkspaceEdit {
  /**
   * Gets the edits, by document, in the provider's order.
   */
  readonly files: readonly ProvidedFileEdits[];

  /**
   * Gets how many file operations (creating, renaming or deleting a file) it held, which are not
   * applied.
   */
  readonly fileOperations: number;
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
   * Gets the code-action providers registered, in registration order (#1016).
   */
  readonly codeActions: RegisteredCodeActionProvider[];

  /**
   * Gets the hover providers registered, in registration order (#1020).
   */
  readonly hovers: RegisteredHoverProvider[];

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
   * Registers a code-action provider for the languages a selector selects.
   */
  registerCodeActionProvider: (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.CodeActionProvider,
    metadata?: MonacoApi.languages.CodeActionProviderMetadata,
  ) => MonacoApi.IDisposable;

  /**
   * Registers a hover provider for the languages a selector selects.
   */
  registerHoverProvider: (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.HoverProvider,
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
 * Holds the providers Studio registers itself to answer Monaco's own questions (#1016), which the
 * capabilities below pass over: they stand in for a language server that Studio asks directly.
 */
const STUDIO_PROVIDERS: WeakSet<object> = new WeakSet<object>();

/**
 * Marks a provider as Studio's own (#1016): registered to answer a question of Monaco's on a language
 * server's behalf, so whether a language offers code actions, and the actions themselves, are never
 * read from it — Studio asks the server itself.
 * @param provider The provider.
 */
export function markStudioProvider(provider: object): void {
  STUDIO_PROVIDERS.add(provider);
}

/**
 * Starts recording what a Monaco instance's languages can do for Studio's right-click menu (#1012):
 * the definition providers registered with it, which Go to Definition asks where no language server
 * answers and which decide whether the item shows; the reference providers, which Find All References
 * asks the same way (#1014); the rename providers, which Rename Symbol asks the same way (#1015); the
 * code-action providers, which the quick-fix menu asks the same way (#1016); the hover providers,
 * every one of which Studio's hover card asks (#1020); and the comment rules each language's
 * configuration sets, which decide whether Toggle Comment does.
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
    codeActions: [],
    hovers: [],
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
  const registerCodeActions: CapabilityRegistration['registerCodeActionProvider'] =
    languages.registerCodeActionProvider.bind(languages);
  const registerHover: CapabilityRegistration['registerHoverProvider'] =
    languages.registerHoverProvider.bind(languages);
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
  languages.registerCodeActionProvider = (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.CodeActionProvider,
    metadata?: MonacoApi.languages.CodeActionProviderMetadata,
  ): MonacoApi.IDisposable => {
    const entry: RegisteredCodeActionProvider = { selector, provider };
    captured.codeActions.push(entry);
    const disposable: MonacoApi.IDisposable = registerCodeActions(selector, provider, metadata);
    return {
      dispose: (): void => {
        const index: number = captured.codeActions.indexOf(entry);
        if (index >= 0) {
          captured.codeActions.splice(index, 1);
        }
        disposable.dispose();
      },
    };
  };
  languages.registerHoverProvider = (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.HoverProvider,
  ): MonacoApi.IDisposable => {
    const entry: RegisteredHoverProvider = { selector, provider };
    captured.hovers.push(entry);
    const disposable: MonacoApi.IDisposable = registerHover(selector, provider);
    return {
      dispose: (): void => {
        const index: number = captured.hovers.indexOf(entry);
        if (index >= 0) {
          captured.hovers.splice(index, 1);
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
 * Asks every hover provider registered with a Monaco instance for its language what it says of the
 * symbol at a position (#1020) — a language server's and Monaco's own workers' alike, all at once, as
 * Monaco asks them — the most recently registered first, as Monaco ranks them. A provider that fails,
 * or says nothing, is left out.
 * @param monaco The Monaco instance the model belongs to.
 * @param model The model.
 * @param position The one-based position.
 * @returns Returns the answers, in rank order; empty when no provider serves the language or none
 * said anything.
 */
export async function providedHovers(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
  position: MonacoApi.IPosition,
): Promise<readonly ProvidedHover[]> {
  const language: string = model.getLanguageId();
  const candidates: readonly RegisteredHoverProvider[] = [
    ...(CAPTURED.get(monaco.languages)?.hovers ?? []),
  ]
    .reverse()
    .filter((entry: RegisteredHoverProvider): boolean => selects(entry.selector, language));
  const answers: readonly (ProvidedHover | null)[] = await Promise.all(
    candidates.map(async ({ provider }: RegisteredHoverProvider): Promise<ProvidedHover | null> => {
      const source: MonacoApi.CancellationTokenSource = new monaco.CancellationTokenSource();
      try {
        const hover: MonacoApi.languages.Hover | null =
          (await provider.provideHover(model, position as MonacoApi.Position, source.token)) ??
          null;
        const contents: readonly MonacoApi.IMarkdownString[] = (hover?.contents ?? []).filter(
          (content: MonacoApi.IMarkdownString): boolean => content.value.trim().length > 0,
        );
        return hover === null || contents.length === 0
          ? null
          : { contents, range: hover.range ?? null, studio: STUDIO_PROVIDERS.has(provider) };
      } catch {
        // A provider that fails says nothing; the others may.
        return null;
      } finally {
        source.dispose();
      }
    }),
  );
  const given: readonly ProvidedHover[] = answers.filter(
    (answer: ProvidedHover | null): answer is ProvidedHover => answer !== null,
  );
  // A language server's answer stands alone. Monaco's own worker answers for the same language with
  // the same signature and docs in its own words, so taking both showed everything twice; the
  // worker's answer is kept only where no server spoke.
  return given.some((answer: ProvidedHover): boolean => answer.studio)
    ? given.filter((answer: ProvidedHover): boolean => answer.studio)
    : given;
}

/**
 * Determines whether a code-action provider registered with a Monaco instance — other than Studio's
 * own, which stand in for a language server — serves a language (#1016).
 * @param monaco The Monaco instance.
 * @param language The language identifier.
 * @returns Returns true when one does.
 */
export function hasCodeActionProvider(monaco: typeof MonacoApi, language: string): boolean {
  return codeActionCandidates(monaco, language).length > 0;
}

/**
 * Asks the code-action providers registered with a Monaco instance — other than Studio's own — for the
 * code actions at a span (#1016), the most recently registered first. Every provider that serves the
 * language is asked, as Monaco asks them all; one that fails is skipped. What the providers hold for
 * their actions is released by the answer's `dispose`.
 * @param monaco The Monaco instance the model belongs to.
 * @param model The model.
 * @param range The span, one-based: the selection, or the caret as an empty span.
 * @param markers The markers on the span, which the providers find their fixes by.
 * @param only The kind to ask for, or undefined for every kind.
 * @returns Returns the actions, empty when no provider serves the language or none had any.
 */
export async function providedCodeActions(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
  range: MonacoApi.IRange,
  markers: readonly MonacoApi.editor.IMarkerData[],
  only?: string,
): Promise<ProvidedCodeActions> {
  const actions: ProvidedCodeAction[] = [];
  const lists: MonacoApi.languages.CodeActionList[] = [];
  const span: MonacoApi.Range = new monaco.Range(
    range.startLineNumber,
    range.startColumn,
    range.endLineNumber,
    range.endColumn,
  );
  for (const { provider } of codeActionCandidates(monaco, model.getLanguageId())) {
    const source: MonacoApi.CancellationTokenSource = new monaco.CancellationTokenSource();
    try {
      const list: MonacoApi.languages.CodeActionList | null =
        (await provider.provideCodeActions(
          model,
          span,
          {
            markers: [...markers],
            ...(only === undefined ? {} : { only }),
            trigger: monaco.languages.CodeActionTriggerType.Invoke,
          },
          source.token,
        )) ?? null;
      if (list === null) {
        continue;
      }
      lists.push(list);
      for (const action of list.actions) {
        actions.push({ action, provider });
      }
    } catch {
      // A provider that fails offers nothing; the next one may.
    } finally {
      source.dispose();
    }
  }
  return {
    actions,
    dispose: (): void => {
      for (const list of lists) {
        list.dispose();
      }
    },
  };
}

/**
 * Asks the provider that offered a code action to fill in its edit (#1016), which a provider may leave
 * out until the action is chosen. An action with an edit, a provider that cannot fill one in, and a
 * provider that fails all leave the action as it was.
 * @param monaco The Monaco instance the provider is registered with.
 * @param provided The action, and the provider that offered it.
 * @returns Returns the action, filled in where the provider filled it in.
 */
export async function resolveProvidedCodeAction(
  monaco: typeof MonacoApi,
  provided: ProvidedCodeAction,
): Promise<MonacoApi.languages.CodeAction> {
  const { action, provider } = provided;
  if (action.edit !== undefined || provider.resolveCodeAction === undefined) {
    return action;
  }
  const source: MonacoApi.CancellationTokenSource = new monaco.CancellationTokenSource();
  try {
    return (await provider.resolveCodeAction(action, source.token)) ?? action;
  } catch {
    return action;
  } finally {
    source.dispose();
  }
}

/**
 * Groups a workspace edit from one of Monaco's providers by document, counting the file operations it
 * holds rather than applying them (#1016).
 * @param edit The provider's edit.
 * @returns Returns the edits, by document, in the provider's order.
 */
export function groupWorkspaceEdit(edit: MonacoApi.languages.WorkspaceEdit): ProvidedWorkspaceEdit {
  const files: Map<string, { range: MonacoApi.IRange; text: string }[]> = new Map<
    string,
    { range: MonacoApi.IRange; text: string }[]
  >();
  let fileOperations: number = 0;
  for (const entry of edit.edits) {
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
 * Lists the code-action providers that serve a language, the most recently registered first, leaving
 * out Studio's own.
 * @param monaco The Monaco instance.
 * @param language The language identifier.
 * @returns Returns the providers.
 */
function codeActionCandidates(
  monaco: typeof MonacoApi,
  language: string,
): readonly RegisteredCodeActionProvider[] {
  return [...(CAPTURED.get(monaco.languages)?.codeActions ?? [])]
    .reverse()
    .filter(
      (entry: RegisteredCodeActionProvider): boolean =>
        !STUDIO_PROVIDERS.has(entry.provider) && selects(entry.selector, language),
    );
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
  return { kind: 'edits', ...groupWorkspaceEdit(answer) };
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
