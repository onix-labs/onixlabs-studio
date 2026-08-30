import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Bridge } from '@shared/api/bridge';
import { Log } from '@shared/angular/services/log/log';
import {
  LspChannel,
  LspSemanticTokensLegend,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
} from '@shared/api/lsp-channels';
import { Editors } from '@shared/angular/services/editors/editors';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import {
  buildHeuristicSemanticTokens,
  HEURISTIC_SEMANTIC_TOKEN_LANGUAGES,
} from '@shared/angular/services/monaco/monaco-heuristic-tokens';

/**
 * References the language-server document an editor model maps to: which session owns it and the
 * `file:` URI the server knows it by.
 */
export interface LspDocumentRef {
  /**
   * Gets the session whose server handles the document.
   */
  readonly sessionId: string;

  /**
   * Gets the document's `file:` URI.
   */
  readonly uri: string;

  /**
   * Gets the server's semantic token legend, or null when the server does not provide semantic tokens.
   */
  readonly semanticLegend?: LspSemanticTokensLegend | null;

  /**
   * Gets whether the server's semantic tokens should be held back in favour of the heuristic
   * colouring. Heavy servers (Roslyn) serve tokens from frozen, partially-loaded compilations while
   * their workspace loads — every identifier classifies as a plain variable — so painting them would
   * visibly downgrade the colouring only to upgrade it again seconds later. The owning client flips
   * this off once the session's semantics have demonstrably settled.
   */
  readonly suppressServerTokens?: boolean;
}

/**
 * Resolves a file path to the language-server document it is open as, or null when the caller does not
 * own it.
 */
export type LspDocumentResolver = (path: string) => LspDocumentRef | null;

/**
 * A zero-based Language Server Protocol position.
 */
interface LspPosition {
  readonly line: number;
  readonly character: number;
}

/**
 * A Language Server Protocol range.
 */
interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

/**
 * Markup content (markdown or plain text) returned by a server.
 */
interface LspMarkup {
  readonly kind?: string;
  readonly value: string;
}

/**
 * A single completion suggestion from a server.
 */
interface LspCompletionItem {
  readonly label: string;
  readonly kind?: number;
  readonly detail?: string;
  readonly documentation?: string | LspMarkup;
  readonly insertText?: string;
  readonly insertTextFormat?: number;
  readonly sortText?: string;
  readonly filterText?: string;
  readonly textEdit?: { readonly range: LspRange; readonly newText: string };
}

/**
 * A completion response from a server.
 */
interface LspCompletionList {
  readonly items: readonly LspCompletionItem[];
}

/**
 * A hover response from a server.
 */
interface LspHover {
  readonly contents: string | LspMarkup | readonly (string | LspMarkup)[];
  readonly range?: LspRange;
}

/**
 * A source location returned by a server.
 */
interface LspLocation {
  readonly uri: string;
  readonly range: LspRange;
}

/**
 * A location link returned by a server (the alternative definition shape).
 */
interface LspLocationLink {
  readonly targetUri: string;
  readonly targetSelectionRange: LspRange;
}

/**
 * Holds the languages editor features are wired for; each must have a registered server.
 */
const FEATURE_LANGUAGES: readonly string[] = [
  'typescript',
  'javascript',
  'java',
  'python',
  'csharp',
  'cpp',
  'c',
];

/**
 * Holds the characters that trigger a completion request.
 */
const TRIGGER_CHARACTERS: readonly string[] = ['.'];

/**
 * The fixed semantic token legend the Monaco providers declare. Every server's own legend is mapped
 * onto this one by name, so the editor theme colours each language consistently.
 */
const SEMANTIC_LEGEND: { tokenTypes: string[]; tokenModifiers: string[] } = {
  tokenTypes: [...SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
};

/**
 * Maps a server's token-type name (including common spellings that differ from the standard set) to
 * the standard type it is coloured as. A type with no entry and no standard name is dropped (so its
 * range simply keeps its grammar colour).
 */
const TOKEN_TYPE_ALIASES: Readonly<Record<string, string>> = {
  field: 'property',
  constant: 'variable',
  regex: 'regexp',
  label: 'variable',
};

/**
 * The fixed-legend index the heuristic scan's `type` classification maps to.
 */
const FIXED_TYPE_INDEX: number = SEMANTIC_TOKEN_TYPES.indexOf('type');

/**
 * The fixed-legend index the heuristic scan's `function` classification maps to.
 */
const FIXED_FUNCTION_INDEX: number = SEMANTIC_TOKEN_TYPES.indexOf('function');

/**
 * Bounds the heuristic-token cache: past this many models the cache is simply cleared, so it can
 * never grow without bound across many opened documents.
 */
const HEURISTIC_CACHE_LIMIT: number = 64;

/**
 * Registers Monaco language features (completion, hover, go-to-definition, references) backed by the
 * application's language servers. Monaco's providers are global per language, so this root service
 * owns them and routes each request to the workspace whose client owns the model — clients register a
 * resolver that maps a file path to its session. Requests and responses are translated between
 * Monaco's one-based and the protocol's zero-based coordinates here. Cross-file navigation resolves
 * to a target only when that file is already open as an editor model.
 */
@Service()
export class LspFeatures {
  /**
   * Holds the Monaco service used to load the editor and register providers.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the editor registry used to map a model URI to its file path and back.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the generic transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the registered document resolvers contributed by the workspace clients.
   */
  private readonly resolvers: Set<LspDocumentResolver> = new Set<LspDocumentResolver>();

  /**
   * Holds whether the Monaco providers have been registered, so registration happens once.
   */
  private registered: boolean = false;

  /**
   * Fires to ask Monaco to re-request semantic tokens, one emitter per registered language. Monaco
   * requests tokens when a document first opens — before its language server has started — and caches
   * the empty result; firing a language's emitter once its server is ready makes Monaco ask again so
   * the tokens actually paint. Emitters are per-language so one server becoming ready does not fan a
   * full-document token request out to every open model of every other language.
   */
  private readonly semanticTokensChanged: Map<string, MonacoApi.Emitter<void>> = new Map<
    string,
    MonacoApi.Emitter<void>
  >();

  /**
   * Holds the listeners notified when a server demonstrably serves a session (a request returns a
   * useful result). Clients use this to flip a session's status to ready even when the server never
   * sends the diagnostics or initialisation notifications the status otherwise waits for.
   */
  private readonly servedListeners: Set<(sessionId: string) => void> = new Set<
    (sessionId: string) => void
  >();

  /**
   * Holds the in-flight semantic-token request per model URI, so bursts of refreshes coalesce into a
   * single server round-trip instead of piling requests onto a slow server.
   */
  private readonly pendingTokenRequests: Map<
    string,
    Promise<MonacoApi.languages.SemanticTokens | undefined>
  > = new Map<string, Promise<MonacoApi.languages.SemanticTokens | undefined>>();

  /**
   * Caches the heuristic fallback tokens per model URI and version, so repeated fallback passes while
   * a server is still loading do not re-tokenize the whole document each time.
   */
  private readonly heuristicCache: Map<string, { version: number; data: Uint32Array }> = new Map<
    string,
    { version: number; data: Uint32Array }
  >();

  /**
   * Initializes the service, registering the Monaco providers once Monaco has loaded.
   */
  public constructor() {
    if (this.bridge === undefined) {
      return;
    }
    void this.monaco.ensureLoaded().then((): void => this.registerProviders());
  }

  /**
   * Registers a resolver that maps a file path to the document a workspace client owns.
   * @param resolver The resolver to add.
   * @returns Returns a function that removes the resolver.
   */
  public registerDocuments(resolver: LspDocumentResolver): () => void {
    this.resolvers.add(resolver);
    return (): void => {
      this.resolvers.delete(resolver);
    };
  }

  /**
   * Registers a listener notified with a session id whenever that session's server demonstrably
   * serves (a semantic-token or feature request returns a useful result). Clients use this as a
   * readiness signal for servers that never send diagnostics or an initialisation notification.
   * @param listener The listener to add.
   * @returns Returns a function that removes the listener.
   */
  public registerServedListener(listener: (sessionId: string) => void): () => void {
    this.servedListeners.add(listener);
    return (): void => {
      this.servedListeners.delete(listener);
    };
  }

  /**
   * Notifies the served listeners that a session's server answered a request with a useful result.
   * @param sessionId The session whose server served.
   */
  private notifyServed(sessionId: string): void {
    for (const listener of this.servedListeners) {
      listener(sessionId);
    }
  }

  /**
   * Registers the Monaco feature providers for every supported language.
   */
  private registerProviders(): void {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined || this.registered) {
      return;
    }
    this.registered = true;
    // Suppress Monaco's heuristic semantic tokens for any model a language server can serve, so the
    // server's accurate tokens are the sole source and the heuristic does no redundant work.
    this.monaco.suppressHeuristicTokensWhen((model: MonacoApi.editor.ITextModel): boolean =>
      this.servesSemanticTokens(model),
    );
    for (const language of FEATURE_LANGUAGES) {
      monaco.languages.registerCompletionItemProvider(language, {
        triggerCharacters: [...TRIGGER_CHARACTERS],
        provideCompletionItems: (
          model: MonacoApi.editor.ITextModel,
          position: MonacoApi.Position,
        ): Promise<MonacoApi.languages.CompletionList | undefined> =>
          this.provideCompletion(monaco, model, position),
      });
      monaco.languages.registerHoverProvider(language, {
        provideHover: (
          model: MonacoApi.editor.ITextModel,
          position: MonacoApi.Position,
        ): Promise<MonacoApi.languages.Hover | undefined> =>
          this.provideHover(monaco, model, position),
      });
      monaco.languages.registerDefinitionProvider(language, {
        provideDefinition: (
          model: MonacoApi.editor.ITextModel,
          position: MonacoApi.Position,
        ): Promise<MonacoApi.languages.Location[] | undefined> =>
          this.provideLocations(monaco, model, position, 'textDocument/definition'),
      });
      monaco.languages.registerReferenceProvider(language, {
        provideReferences: (
          model: MonacoApi.editor.ITextModel,
          position: MonacoApi.Position,
        ): Promise<MonacoApi.languages.Location[] | undefined> =>
          this.provideLocations(monaco, model, position, 'textDocument/references', {
            context: { includeDeclaration: true },
          }),
      });
      const semanticTokensChanged: MonacoApi.Emitter<void> = new monaco.Emitter<void>();
      this.semanticTokensChanged.set(language, semanticTokensChanged);
      monaco.languages.registerDocumentSemanticTokensProvider(language, {
        onDidChange: semanticTokensChanged.event,
        getLegend: (): MonacoApi.languages.SemanticTokensLegend => SEMANTIC_LEGEND,
        provideDocumentSemanticTokens: (
          model: MonacoApi.editor.ITextModel,
        ): Promise<MonacoApi.languages.SemanticTokens | undefined> =>
          this.provideSemanticTokens(model),
        releaseDocumentSemanticTokens: (): void => undefined,
      });
    }
    this.log.info(
      'LspFeatures',
      `Registered Monaco language features for ${FEATURE_LANGUAGES.length} language(s)`,
    );
  }

  /**
   * Asks Monaco to re-request semantic tokens for the open models of the given languages (or of every
   * registered language when none are given). Called when a language server becomes ready, so a
   * document opened before its server started gets coloured without an edit. Scoping to the ready
   * server's languages keeps a slow server's readiness from fanning full-document token requests out
   * to every other language's models.
   * @param languages The Monaco language identifiers to refresh, or undefined for all.
   */
  public refreshSemanticTokens(languages?: readonly string[]): void {
    for (const [language, emitter] of this.semanticTokensChanged) {
      if (languages === undefined || languages.includes(language)) {
        emitter.fire();
      }
    }
  }

  /**
   * Gets whether a language server can serve semantic tokens for a model: it owns the model and has
   * reported a token legend. Used to suppress Monaco's heuristic tokens for documents the server
   * colours, while leaving server-less documents (and documents whose server has not started) to the
   * heuristic.
   * @param model The model a token request is for.
   * @returns Returns true when a server serves semantic tokens for the model.
   */
  private servesSemanticTokens(model: MonacoApi.editor.ITextModel): boolean {
    const legend: LspSemanticTokensLegend | null | undefined = this.resolve(model)?.semanticLegend;
    return legend !== undefined && legend !== null;
  }

  /**
   * Handles a document semantic-tokens request, coalescing concurrent requests for the same model
   * into a single fetch so refresh bursts do not pile requests onto a slow server.
   * @param model The model the tokens are requested for.
   * @returns Returns the semantic tokens, or undefined when no server owns the model and no heuristic
   * applies.
   */
  private provideSemanticTokens(
    model: MonacoApi.editor.ITextModel,
  ): Promise<MonacoApi.languages.SemanticTokens | undefined> {
    const key: string = model.uri.toString();
    const pending: Promise<MonacoApi.languages.SemanticTokens | undefined> | undefined =
      this.pendingTokenRequests.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const request: Promise<MonacoApi.languages.SemanticTokens | undefined> =
      this.fetchSemanticTokens(model).finally((): void => {
        this.pendingTokenRequests.delete(key);
      });
    this.pendingTokenRequests.set(key, request);
    return request;
  }

  /**
   * Fetches a model's semantic tokens from its server, remapping the server's legend onto the fixed
   * one. While the server yields nothing useful — it errors, returns no data, or returns an empty set
   * (heavy servers such as Roslyn advertise semantic tokens at the handshake but serve none until the
   * whole project has loaded) — the heuristic tokens are returned instead, so the colouring a document
   * had before its server started is never torn down during the load window. Once the server returns
   * real tokens they win, and the served listeners are notified.
   * @param model The model the tokens are requested for.
   * @returns Returns the semantic tokens, or undefined when no server owns the model and no heuristic
   * applies.
   */
  private async fetchSemanticTokens(
    model: MonacoApi.editor.ITextModel,
  ): Promise<MonacoApi.languages.SemanticTokens | undefined> {
    const ref: LspDocumentRef | null = this.resolve(model);
    if (ref === null || this.bridge === undefined) {
      return undefined;
    }
    const legend: LspSemanticTokensLegend | null | undefined = ref.semanticLegend;
    if (legend === undefined || legend === null) {
      return undefined;
    }
    // While the server's compilation is still loading its tokens are degraded (see the ref's
    // `suppressServerTokens`); keep the heuristic colouring rather than briefly painting worse.
    if (ref.suppressServerTokens === true) {
      return this.heuristicFallback(model);
    }
    let result: unknown;
    try {
      result = await this.bridge.invoke(
        LspChannel.Request,
        ref.sessionId,
        'textDocument/semanticTokens/full',
        {
          textDocument: { uri: ref.uri },
        },
      );
    } catch {
      return this.heuristicFallback(model);
    }
    const data: unknown = (result as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) {
      return this.heuristicFallback(model);
    }
    const remapped: Uint32Array = this.remapSemanticTokens(data as number[], legend);
    if (remapped.length === 0) {
      return this.heuristicFallback(model);
    }
    this.notifyServed(ref.sessionId);
    return { data: remapped };
  }

  /**
   * Builds the heuristic semantic tokens for a model whose server cannot serve tokens yet, re-based
   * onto the fixed legend the LSP provider declares. Results are cached per model version so repeated
   * fallback passes while a server loads do not re-tokenize the document each time.
   * @param model The model the tokens are built for.
   * @returns Returns the heuristic tokens, or undefined for a language the heuristic does not cover.
   */
  private heuristicFallback(
    model: MonacoApi.editor.ITextModel,
  ): MonacoApi.languages.SemanticTokens | undefined {
    const languageId: string = model.getLanguageId();
    if (!HEURISTIC_SEMANTIC_TOKEN_LANGUAGES.includes(languageId)) {
      return undefined;
    }
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return undefined;
    }
    const key: string = model.uri.toString();
    const version: number = model.getVersionId();
    const cached: { version: number; data: Uint32Array } | undefined = this.heuristicCache.get(key);
    if (cached?.version === version) {
      return { data: cached.data };
    }
    const source: string = model.getValue();
    const monarchLines: MonacoApi.Token[][] = monaco.editor.tokenize(source, languageId);
    const data: Uint32Array = this.rebaseHeuristicTokens(
      buildHeuristicSemanticTokens(source, monarchLines),
    );
    if (this.heuristicCache.size >= HEURISTIC_CACHE_LIMIT) {
      this.heuristicCache.clear();
    }
    this.heuristicCache.set(key, { version, data });
    return { data };
  }

  /**
   * Re-bases heuristic token data (whose legend is `['type', 'function']`) onto the fixed legend the
   * LSP semantic-tokens provider declares, so the fallback paints with the same theme rules.
   * @param data The heuristic delta-packed token data.
   * @returns Returns the re-based token data.
   */
  private rebaseHeuristicTokens(data: Uint32Array): Uint32Array {
    const rebased: Uint32Array = new Uint32Array(data);
    for (let index: number = 3; index < rebased.length; index += 5) {
      rebased[index] = rebased[index] === 0 ? FIXED_TYPE_INDEX : FIXED_FUNCTION_INDEX;
    }
    return rebased;
  }

  /**
   * Re-bases a server's packed semantic tokens onto the fixed legend: it decodes each token to an
   * absolute position, drops tokens whose type has no standard colour, remaps the remaining token
   * types and modifiers by name, and re-encodes the result as Monaco's delta-packed array.
   * @param data The server's packed token data (groups of five integers).
   * @param legend The server's legend the data indexes into.
   * @returns Returns the remapped, delta-packed token data.
   */
  private remapSemanticTokens(data: number[], legend: LspSemanticTokensLegend): Uint32Array {
    const out: number[] = [];
    let line: number = 0;
    let char: number = 0;
    let prevLine: number = 0;
    let prevChar: number = 0;
    for (let i: number = 0; i + 4 < data.length; i += 5) {
      const deltaLine: number = data[i];
      line += deltaLine;
      char = deltaLine === 0 ? char + data[i + 1] : data[i + 1];
      const type: number | undefined = this.fixedTypeIndex(legend.tokenTypes[data[i + 3]] ?? '');
      if (type === undefined) {
        continue;
      }
      const modifiers: number = this.remapModifiers(data[i + 4], legend);
      const emitLine: number = line - prevLine;
      const emitChar: number = emitLine === 0 ? char - prevChar : char;
      out.push(emitLine, emitChar, data[i + 2], type, modifiers);
      prevLine = line;
      prevChar = char;
    }
    return new Uint32Array(out);
  }

  /**
   * Resolves a server token-type name to its index in the fixed legend, applying known aliases.
   * @param name The server's token-type name.
   * @returns Returns the fixed-legend index, or undefined when the type has no standard colour.
   */
  private fixedTypeIndex(name: string): number | undefined {
    const canonical: string = TOKEN_TYPE_ALIASES[name] ?? name;
    const index: number = SEMANTIC_TOKEN_TYPES.indexOf(canonical);
    return index >= 0 ? index : undefined;
  }

  /**
   * Maps a server's token-modifier bitmask onto the fixed legend's modifier bits, dropping modifiers
   * the fixed legend does not define.
   * @param mask The server's modifier bitmask.
   * @param legend The server's legend.
   * @returns Returns the remapped bitmask.
   */
  private remapModifiers(mask: number, legend: LspSemanticTokensLegend): number {
    if (mask === 0) {
      return 0;
    }
    let result: number = 0;
    for (let bit: number = 0; bit < legend.tokenModifiers.length; bit += 1) {
      if ((mask & (1 << bit)) === 0) {
        continue;
      }
      const fixed: number = SEMANTIC_TOKEN_MODIFIERS.indexOf(legend.tokenModifiers[bit]);
      if (fixed >= 0) {
        result |= 1 << fixed;
      }
    }
    return result;
  }

  /**
   * Handles a completion request, mapping the server's suggestions to Monaco completion items.
   * @param monaco The loaded Monaco namespace.
   * @param model The model the completion was requested in.
   * @param position The one-based cursor position.
   * @returns Returns the completion list, or undefined when there is no server or no result.
   */
  private async provideCompletion(
    monaco: typeof MonacoApi,
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.Position,
  ): Promise<MonacoApi.languages.CompletionList | undefined> {
    const result: unknown = await this.request(model, 'textDocument/completion', position);
    if (result === null) {
      return undefined;
    }
    const items: readonly LspCompletionItem[] = Array.isArray(result)
      ? (result as LspCompletionItem[])
      : ((result as LspCompletionList).items ?? []);
    const word: MonacoApi.editor.IWordAtPosition = model.getWordUntilPosition(position);
    const range: MonacoApi.IRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
    return {
      suggestions: items.map((item: LspCompletionItem): MonacoApi.languages.CompletionItem =>
        this.toCompletionItem(monaco, item, range),
      ),
    };
  }

  /**
   * Handles a hover request, mapping the server's hover to Monaco's hover shape.
   * @param monaco The loaded Monaco namespace.
   * @param model The model the hover was requested in.
   * @param position The one-based cursor position.
   * @returns Returns the hover, or undefined when there is no server or no result.
   */
  private async provideHover(
    monaco: typeof MonacoApi,
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.Position,
  ): Promise<MonacoApi.languages.Hover | undefined> {
    const result: unknown = await this.request(model, 'textDocument/hover', position);
    if (result === null) {
      return undefined;
    }
    const hover: LspHover = result as LspHover;
    const parts: readonly (string | LspMarkup)[] = Array.isArray(hover.contents)
      ? hover.contents
      : [hover.contents];
    const contents: MonacoApi.IMarkdownString[] = parts.map(
      (part: string | LspMarkup): MonacoApi.IMarkdownString => ({
        value: typeof part === 'string' ? part : part.value,
      }),
    );
    return { contents, range: hover.range === undefined ? undefined : this.toRange(hover.range) };
  }

  /**
   * Handles a definition or references request, mapping the server's locations to Monaco locations
   * for files that are open as editor models.
   * @param monaco The loaded Monaco namespace.
   * @param model The model the request was made in.
   * @param position The one-based cursor position.
   * @param method The protocol method to call.
   * @param extra Extra parameters merged into the request (for example the references context).
   * @returns Returns the locations, or undefined when there is no server or no result.
   */
  private async provideLocations(
    monaco: typeof MonacoApi,
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.Position,
    method: string,
    extra?: Record<string, unknown>,
  ): Promise<MonacoApi.languages.Location[] | undefined> {
    const result: unknown = await this.request(model, method, position, extra);
    if (result === null) {
      return undefined;
    }
    const raw: readonly (LspLocation | LspLocationLink)[] = Array.isArray(result)
      ? (result as (LspLocation | LspLocationLink)[])
      : [result as LspLocation];
    const locations: MonacoApi.languages.Location[] = [];
    for (const entry of raw) {
      const location: MonacoApi.languages.Location | null = this.toLocation(monaco, entry);
      if (location !== null) {
        locations.push(location);
      }
    }
    return locations;
  }

  /**
   * Sends a positional request to the server that owns the model.
   * @param model The model the request concerns.
   * @param method The protocol method to call.
   * @param position The one-based cursor position.
   * @param extra Extra parameters merged into the request.
   * @returns Returns the server's result, or null when no server owns the model or the request fails.
   */
  private async request(
    model: MonacoApi.editor.ITextModel,
    method: string,
    position: MonacoApi.Position,
    extra?: Record<string, unknown>,
  ): Promise<unknown> {
    const ref: LspDocumentRef | null = this.resolve(model);
    if (ref === null || this.bridge === undefined) {
      return null;
    }
    const params: Record<string, unknown> = {
      textDocument: { uri: ref.uri },
      position: { line: position.lineNumber - 1, character: position.column - 1 },
      ...extra,
    };
    try {
      const result: unknown = await this.bridge.invoke(
        LspChannel.Request,
        ref.sessionId,
        method,
        params,
      );
      // A useful answer proves the server is serving; surface that to the readiness listeners, since
      // some servers never send the diagnostics the status indicator otherwise waits for.
      if (result !== null && result !== undefined) {
        this.notifyServed(ref.sessionId);
      }
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the document an editor model maps to, by asking the registered resolvers.
   * @param model The editor model to resolve.
   * @returns Returns the document reference, or null when none owns it.
   */
  private resolve(model: MonacoApi.editor.ITextModel): LspDocumentRef | null {
    const path: string | null = this.editors.locate(model.uri.toString())?.path ?? null;
    if (path === null) {
      return null;
    }
    for (const resolver of this.resolvers) {
      const ref: LspDocumentRef | null = resolver(path);
      if (ref !== null) {
        return ref;
      }
    }
    return null;
  }

  /**
   * Maps a server completion item to a Monaco completion item.
   * @param monaco The loaded Monaco namespace.
   * @param item The server completion item.
   * @param range The range the item replaces when no explicit edit is given.
   * @returns Returns the Monaco completion item.
   */
  private toCompletionItem(
    monaco: typeof MonacoApi,
    item: LspCompletionItem,
    range: MonacoApi.IRange,
  ): MonacoApi.languages.CompletionItem {
    const snippet: boolean = item.insertTextFormat === 2;
    const documentation: string | undefined =
      item.documentation === undefined
        ? undefined
        : typeof item.documentation === 'string'
          ? item.documentation
          : item.documentation.value;
    return {
      label: item.label,
      kind: this.completionKind(monaco, item.kind),
      detail: item.detail,
      documentation: documentation === undefined ? undefined : { value: documentation },
      insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
      insertTextRules: snippet
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
      sortText: item.sortText,
      filterText: item.filterText,
      range: item.textEdit === undefined ? range : this.toRange(item.textEdit.range),
    };
  }

  /**
   * Maps a server location (or location link) to a Monaco location, when its file is open as a model.
   * @param monaco The loaded Monaco namespace.
   * @param entry The server location or location link.
   * @returns Returns the Monaco location, or null when the target file is not open.
   */
  private toLocation(
    monaco: typeof MonacoApi,
    entry: LspLocation | LspLocationLink,
  ): MonacoApi.languages.Location | null {
    const uri: string = 'uri' in entry ? entry.uri : entry.targetUri;
    const range: LspRange = 'range' in entry ? entry.range : entry.targetSelectionRange;
    const path: string = this.uriToPath(uri);
    const modelUri: string | undefined = this.editors.modelUriForPath(path);
    if (modelUri === undefined) {
      return null;
    }
    return { uri: monaco.Uri.parse(modelUri), range: this.toRange(range) };
  }

  /**
   * Maps a protocol range to a Monaco range, converting zero-based to one-based coordinates.
   * @param range The protocol range.
   * @returns Returns the Monaco range.
   */
  private toRange(range: LspRange): MonacoApi.IRange {
    return {
      startLineNumber: range.start.line + 1,
      startColumn: range.start.character + 1,
      endLineNumber: range.end.line + 1,
      endColumn: range.end.character + 1,
    };
  }

  /**
   * Maps a protocol completion-item kind to a Monaco completion-item kind.
   * @param monaco The loaded Monaco namespace.
   * @param kind The protocol kind, or undefined.
   * @returns Returns the Monaco kind.
   */
  private completionKind(
    monaco: typeof MonacoApi,
    kind: number | undefined,
  ): MonacoApi.languages.CompletionItemKind {
    const kinds: typeof MonacoApi.languages.CompletionItemKind =
      monaco.languages.CompletionItemKind;
    switch (kind) {
      case 2:
        return kinds.Method;
      case 3:
        return kinds.Function;
      case 4:
        return kinds.Constructor;
      case 5:
        return kinds.Field;
      case 6:
        return kinds.Variable;
      case 7:
        return kinds.Class;
      case 8:
        return kinds.Interface;
      case 9:
        return kinds.Module;
      case 10:
        return kinds.Property;
      case 13:
        return kinds.Enum;
      case 14:
        return kinds.Keyword;
      case 15:
        return kinds.Snippet;
      case 21:
        return kinds.Constant;
      case 22:
        return kinds.Struct;
      case 25:
        return kinds.TypeParameter;
      default:
        return kinds.Text;
    }
  }

  /**
   * Converts a `file:` URI to an absolute path.
   * @param uri The file URI.
   * @returns Returns the absolute path.
   */
  private uriToPath(uri: string): string {
    const withoutScheme: string = decodeURI(uri).replace(/^file:\/\//, '');
    return /^\/[a-zA-Z]:/.test(withoutScheme) ? withoutScheme.slice(1) : withoutScheme;
  }
}
