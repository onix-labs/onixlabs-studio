import type * as MonacoApi from 'monaco-editor';
import { isStudioProvider } from './monaco-editor-capabilities';
import { selects } from './monaco-symbol-providers';

/**
 * Formats a model with a language server, when one formats it (#1214): the whole document, or a range
 * of it. Answers undefined for a model no server formats, which Monaco's own formatter then formats.
 */
export type FormattingOverride = (
  model: MonacoApi.editor.ITextModel,
  options: MonacoApi.languages.FormattingOptions,
  range: MonacoApi.Range | undefined,
) => Promise<MonacoApi.languages.TextEdit[] | undefined> | undefined;

/**
 * One of Monaco's own formatters, as it was registered (#1214).
 */
interface BuiltInFormatter {
  /**
   * Gets the language selector it was registered for.
   */
  readonly selector: MonacoApi.languages.LanguageSelector;

  /**
   * Gets the whole-document formatter, when it is one.
   */
  readonly document?: MonacoApi.languages.DocumentFormattingEditProvider;

  /**
   * Gets the range formatter, when it is one.
   */
  readonly range?: MonacoApi.languages.DocumentRangeFormattingEditProvider;
}

/**
 * What is recorded of one Monaco instance's formatting (#1214).
 */
interface FormattingRoute {
  /**
   * Gets Monaco's own formatters, in registration order.
   */
  readonly builtIn: BuiltInFormatter[];

  /**
   * Gets or sets how a language server formats a model it serves, or undefined before one does.
   */
  override: FormattingOverride | undefined;
}

/**
 * The formatting registration functions the capture replaces, writable.
 */
interface FormattingRegistration {
  /**
   * Registers a whole-document formatter.
   */
  registerDocumentFormattingEditProvider: (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DocumentFormattingEditProvider,
  ) => MonacoApi.IDisposable;

  /**
   * Registers a range formatter.
   */
  registerDocumentRangeFormattingEditProvider: (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DocumentRangeFormattingEditProvider,
  ) => MonacoApi.IDisposable;
}

/**
 * Holds what is recorded of each Monaco instance. Weak, so a closed child window's goes with it.
 */
const ROUTES: WeakMap<object, FormattingRoute> = new WeakMap<object, FormattingRoute>();

/**
 * Routes formatting between a language server and Monaco's own formatter for the languages Monaco
 * formats itself (JSON, CSS, SCSS, Less, HTML…) (#1214). Monaco runs only the formatter registered
 * last, and registers its own when it first meets a document of the language, usually after a server
 * has registered Studio's. Both now route the same way, whichever Monaco picks: Monaco's own formatter
 * first asks the {@link FormattingOverride} (a server that formats the model, as Default Formatter
 * allows), and Studio's asks Monaco's own for a model no server formats — an unsaved document, or any
 * document once the server has stopped.
 *
 * Studio's own providers (see {@link import('./monaco-editor-capabilities').markStudioProvider}) are
 * registered untouched. Called once per instance as it loads, before any language activates.
 * @param monaco The Monaco instance.
 */
export function captureBuiltInFormatters(monaco: typeof MonacoApi): void {
  if (ROUTES.has(monaco.languages)) {
    return;
  }
  const route: FormattingRoute = { builtIn: [], override: undefined };
  ROUTES.set(monaco.languages, route);
  // Typed as the writable members it replaces; at runtime the namespace is a plain object.
  const languages: FormattingRegistration = monaco.languages;
  const registerDocument: FormattingRegistration['registerDocumentFormattingEditProvider'] =
    languages.registerDocumentFormattingEditProvider.bind(languages);
  const registerRange: FormattingRegistration['registerDocumentRangeFormattingEditProvider'] =
    languages.registerDocumentRangeFormattingEditProvider.bind(languages);
  const remember: (
    entry: BuiltInFormatter,
    disposable: MonacoApi.IDisposable,
  ) => MonacoApi.IDisposable = (
    entry: BuiltInFormatter,
    disposable: MonacoApi.IDisposable,
  ): MonacoApi.IDisposable => {
    route.builtIn.push(entry);
    return {
      dispose: (): void => {
        const index: number = route.builtIn.indexOf(entry);
        if (index >= 0) {
          route.builtIn.splice(index, 1);
        }
        disposable.dispose();
      },
    };
  };
  languages.registerDocumentFormattingEditProvider = (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DocumentFormattingEditProvider,
  ): MonacoApi.IDisposable => {
    if (isStudioProvider(provider)) {
      return registerDocument(selector, provider);
    }
    const routed: MonacoApi.languages.DocumentFormattingEditProvider = {
      ...(provider.displayName === undefined ? {} : { displayName: provider.displayName }),
      provideDocumentFormattingEdits: (
        model: MonacoApi.editor.ITextModel,
        options: MonacoApi.languages.FormattingOptions,
        token: MonacoApi.CancellationToken,
      ): MonacoApi.languages.ProviderResult<MonacoApi.languages.TextEdit[]> =>
        route.override?.(model, options, undefined) ??
        provider.provideDocumentFormattingEdits(model, options, token),
    };
    return remember({ selector, document: provider }, registerDocument(selector, routed));
  };
  languages.registerDocumentRangeFormattingEditProvider = (
    selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DocumentRangeFormattingEditProvider,
  ): MonacoApi.IDisposable => {
    if (isStudioProvider(provider)) {
      return registerRange(selector, provider);
    }
    const routed: MonacoApi.languages.DocumentRangeFormattingEditProvider = {
      ...(provider.displayName === undefined ? {} : { displayName: provider.displayName }),
      provideDocumentRangeFormattingEdits: (
        model: MonacoApi.editor.ITextModel,
        range: MonacoApi.Range,
        options: MonacoApi.languages.FormattingOptions,
        token: MonacoApi.CancellationToken,
      ): MonacoApi.languages.ProviderResult<MonacoApi.languages.TextEdit[]> =>
        route.override?.(model, options, range) ??
        provider.provideDocumentRangeFormattingEdits(model, range, options, token),
    };
    return remember({ selector, range: provider }, registerRange(selector, routed));
  };
}

/**
 * Sets how a language server formats the models it serves (#1214), which Monaco's own formatters ask
 * first. One per instance; a later call replaces an earlier one.
 * @param monaco The Monaco instance, captured with {@link captureBuiltInFormatters}.
 * @param override The override.
 */
export function setFormattingOverride(
  monaco: typeof MonacoApi,
  override: FormattingOverride,
): void {
  const route: FormattingRoute | undefined = ROUTES.get(monaco.languages);
  if (route !== undefined) {
    route.override = override;
  }
}

/**
 * Formats a model with Monaco's own formatter for its language (#1214), for a model no language server
 * formats: the most recently registered one that formats the whole document, or the range given.
 * @param monaco The Monaco instance.
 * @param model The model.
 * @param options The editor's indentation.
 * @param token The request's cancellation token.
 * @param range The range to format, or undefined for the whole document.
 * @returns Returns the edits, or undefined when Monaco has no formatter of its own for the language.
 */
export async function builtInFormattingEdits(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
  options: MonacoApi.languages.FormattingOptions,
  token: MonacoApi.CancellationToken,
  range: MonacoApi.Range | undefined,
): Promise<MonacoApi.languages.TextEdit[] | undefined> {
  const language: string = model.getLanguageId();
  const candidates: readonly BuiltInFormatter[] = (ROUTES.get(monaco.languages)?.builtIn ?? [])
    .filter((entry: BuiltInFormatter): boolean => selects(entry.selector, language))
    .reverse();
  if (range === undefined) {
    const formatter: BuiltInFormatter | undefined = candidates.find(
      (entry: BuiltInFormatter): boolean => entry.document !== undefined,
    );
    return (
      (await formatter?.document?.provideDocumentFormattingEdits(model, options, token)) ??
      undefined
    );
  }
  const formatter: BuiltInFormatter | undefined = candidates.find(
    (entry: BuiltInFormatter): boolean => entry.range !== undefined,
  );
  return (
    (await formatter?.range?.provideDocumentRangeFormattingEdits(model, range, options, token)) ??
    undefined
  );
}
