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
import { CodeSymbol, toCodeSymbols } from '@shared/angular/services/lsp/lsp-symbols';
import { LinePreviews } from '@shared/angular/services/references/line-previews';
import type {
  CodeLocation,
  ReferenceItem,
} from '@shared/angular/services/references/reference-list';
import {
  buildHeuristicSemanticTokens,
  HEURISTIC_SEMANTIC_TOKEN_LANGUAGES,
} from '@shared/angular/services/monaco/monaco-heuristic-tokens';
import {
  fromLspWorkspaceEdit,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { markStudioProvider } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import type { LspDiagnostic } from './lsp-client';

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

  /**
   * Gets how the server renames a symbol (#1015): not at all, straight away, or after saying first
   * whether the symbol at the caret can be renamed and what its name spans. Undefined is taken as the
   * last: asking first is always allowed, and a server that cannot answer is read as refusing.
   */
  readonly rename?: LspRenameSupport;

  /**
   * Gets how the server offers code actions (#1016): not at all, whole, or with their edits filled in
   * when one is chosen. Undefined is taken as not at all.
   */
  readonly codeActions?: LspCodeActionSupport;

  /**
   * Gets the commands the server runs through `workspace/executeCommand` (#1016). Undefined is taken
   * as none.
   */
  readonly commands?: readonly string[];

  /**
   * Gets the document's diagnostics exactly as the server sent them, codes and data included, which a
   * code-action request sends back for the span it asks about (#1016). Undefined is taken as none.
   */
  readonly diagnostics?: readonly LspDiagnostic[];
}

/**
 * Names how a server offers code actions (#1016): `none` — it does not; `actions` — each comes whole,
 * its edit and command included; `resolve` — each may come without its edit and command, which the
 * server fills in when the action is chosen (`codeAction/resolve`).
 */
export type LspCodeActionSupport = 'none' | 'actions' | 'resolve';

/**
 * A command a code action runs (#1016), as a language server names it.
 */
export interface LspCommand {
  /**
   * Gets the command's title.
   */
  readonly title: string;

  /**
   * Gets the command's identifier.
   */
  readonly command: string;

  /**
   * Gets the arguments it runs with, or undefined for none.
   */
  readonly arguments?: readonly unknown[];
}

/**
 * One code action a language server offers at a span (#1016): a fix, a refactor or a source action.
 */
export interface LspCodeAction {
  /**
   * Gets the action's title, as the menu lists it.
   */
  readonly title: string;

  /**
   * Gets the action's kind (`quickfix`, `refactor.extract`, `source.organizeImports`…), or empty when
   * the server gave none.
   */
  readonly kind: string;

  /**
   * Gets whether the server prefers it among the fixes for the same problem.
   */
  readonly isPreferred: boolean;

  /**
   * Gets why the action cannot be run here, as the server put it, or null when it can.
   */
  readonly disabledReason: string | null;

  /**
   * Gets the edits it makes, by file path, or null when it makes none — or the server fills them in
   * only when it is chosen.
   */
  readonly edit: WorkspaceTextEdits | null;

  /**
   * Gets the command it runs after its edits, or null for none.
   */
  readonly command: LspCommand | null;

  /**
   * Gets the action exactly as the server sent it, which is what a `codeAction/resolve` sends back.
   */
  readonly raw: unknown;
}

/**
 * What running a code action's command on its server came to (#1016).
 */
export type LspCommandOutcome =
  | {
      /**
       * Gets that the server ran it.
       */
      readonly ran: true;
    }
  | {
      /**
       * Gets that it was not run, or failed.
       */
      readonly ran: false;

      /**
       * Gets why, for the user.
       */
      readonly reason: string;
    };

/**
 * Names how a server renames a symbol (#1015): `none` — it does not; `rename` — it renames, but
 * cannot say beforehand whether a symbol can be; `prepare` — it says first (`textDocument/prepareRename`).
 */
export type LspRenameSupport = 'none' | 'rename' | 'prepare';

/**
 * What a language server says of the symbol at a position before the new name is asked for (#1015).
 */
export type LspRenamePreparation =
  | {
      /**
       * Gets that the symbol can be renamed.
       */
      readonly kind: 'ready';

      /**
       * Gets the span of the name, one-based as the editor counts.
       */
      readonly range: MonacoApi.IRange;

      /**
       * Gets the name as it stands, which the new-name box opens holding.
       */
      readonly placeholder: string;
    }
  | {
      /**
       * Gets that the symbol cannot be renamed.
       */
      readonly kind: 'refused';

      /**
       * Gets why, as the server put it, or null when it gave no reason.
       */
      readonly reason: string | null;
    };

/**
 * A language server's answer to a rename (#1015).
 */
export type LspRenameAnswer =
  | {
      /**
       * Gets that the server answered with the edits.
       */
      readonly kind: 'edits';

      /**
       * Gets the edits, by file path.
       */
      readonly edits: WorkspaceTextEdits;
    }
  | {
      /**
       * Gets that the server refused.
       */
      readonly kind: 'refused';

      /**
       * Gets why, as the server put it, or null when it gave no reason.
       */
      readonly reason: string | null;
    };

/**
 * The outcome of one request to a server: its result, or the error it answered with.
 */
type LspOutcome =
  | {
      /**
       * Gets that the server answered.
       */
      readonly ok: true;

      /**
       * Gets the server's result.
       */
      readonly result: unknown;
    }
  | {
      /**
       * Gets that the server answered with an error, or the request could not be made.
       */
      readonly ok: false;

      /**
       * Gets the error's message, as the server put it.
       */
      readonly message: string;
    };

/**
 * A place a language server says a symbol is defined: the file, and the span of its name there.
 */
export interface LspDefinition {
  /**
   * Gets the absolute path of the file the definition is in.
   */
  readonly path: string;

  /**
   * Gets the span of the definition, one-based as the editor counts.
   */
  readonly range: MonacoApi.IRange;
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
 * Holds the languages the editor's language-server features are wired for: every language a server in
 * either catalogue — the built-in one (`language-server-catalogue.ts`) or a plugin's manifest
 * (`curated-plugins.json`) — serves, so a Rust or Go file gets hover, completion, go-to-definition,
 * references, colouring and Go to Symbol as a C# file does (#882). A language with no server running
 * is harmless here: each provider finds no document to ask about and answers nothing. The spec keeps
 * this in step with both catalogues.
 */
export const FEATURE_LANGUAGES: readonly string[] = [
  'c',
  'cpp',
  'csharp',
  'css',
  'dockerfile',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'less',
  'lua',
  'perl',
  'python',
  'rust',
  'scss',
  'shell',
  'sql',
  'svelte',
  'typescript',
  'yaml',
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
   * Holds the reader of each reference's line, for Find All References (#1014).
   */
  private readonly linePreviews: LinePreviews = inject(LinePreviews);

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
      // The document's symbols, which Monaco's own Go to Symbol (⌘⇧O) lists; the editor strip's
      // Type and Member dropdowns read the same answer through {@link documentSymbols} (#882).
      monaco.languages.registerDocumentSymbolProvider(language, {
        provideDocumentSymbols: async (
          model: MonacoApi.editor.ITextModel,
        ): Promise<MonacoApi.languages.DocumentSymbol[] | undefined> => {
          const symbols: readonly CodeSymbol[] | null = await this.documentSymbols(model);
          return symbols === null
            ? undefined
            : symbols.map((symbol: CodeSymbol): MonacoApi.languages.DocumentSymbol =>
                this.toMonacoSymbol(symbol),
              );
        },
      });
      // The server's fixes for a problem, for the "Quick Fix…" link in Monaco's hover over it, which
      // opens Studio's menu (#1016). Answers that hover's question alone — whether there are fixes —
      // and nothing else of Monaco's; marked as Studio's so the quick-fix menu, which asks the server
      // itself, never asks it a second time through here.
      const codeActionProvider: MonacoApi.languages.CodeActionProvider = {
        provideCodeActions: (
          model: MonacoApi.editor.ITextModel,
          range: MonacoApi.Range,
          context: MonacoApi.languages.CodeActionContext,
        ): Promise<MonacoApi.languages.CodeActionList> =>
          this.provideMarkerFixes(model, range, context),
      };
      markStudioProvider(codeActionProvider);
      monaco.languages.registerCodeActionProvider(language, codeActionProvider);
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
   * Determines whether a language server serves a document — whether one is running for it — whatever
   * it can yet answer.
   * @param model The editor model.
   * @returns Returns true when a server owns the document.
   */
  public servesDocument(model: MonacoApi.editor.ITextModel): boolean {
    return this.resolve(model) !== null;
  }

  /**
   * Asks the language server that serves a document where the symbol at a position is defined, for
   * the editor's right-click Go to Definition (#1012). Unlike the definition provider Monaco calls,
   * which can only name files already open in an editor, this answers with paths — so a definition in
   * a file nobody has opened yet can be opened and gone to.
   * @param model The editor model.
   * @param position The one-based position.
   * @returns Returns the definitions, in the server's order, or null when no server serves the
   * document (an empty list is a server answering that it knows of none).
   */
  public async definitions(
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.IPosition,
  ): Promise<readonly LspDefinition[] | null> {
    if (this.resolve(model) === null) {
      return null;
    }
    const result: unknown = await this.request(
      model,
      'textDocument/definition',
      position as MonacoApi.Position,
    );
    if (result === null || result === undefined) {
      return [];
    }
    const raw: readonly (LspLocation | LspLocationLink)[] = Array.isArray(result)
      ? (result as (LspLocation | LspLocationLink)[])
      : [result as LspLocation];
    return raw.map((entry: LspLocation | LspLocationLink): LspDefinition => ({
      path: this.uriToPath('uri' in entry ? entry.uri : entry.targetUri),
      range: this.toRange('range' in entry ? entry.range : entry.targetSelectionRange),
    }));
  }

  /**
   * Asks the language server that serves a document for every reference to the symbol at a position,
   * its declaration included, for Find All References (#1014). Like {@link definitions}, this answers
   * with paths rather than the open models Monaco's reference provider is limited to, so references in
   * files nobody has opened are listed too — each with its line, read from the open editor where there
   * is one and from disk otherwise (see {@link LinePreviews}).
   * @param model The editor model.
   * @param position The one-based position.
   * @returns Returns the references, in the server's order, or null when no server serves the document
   * (an empty list is a server answering that it knows of none).
   */
  public async references(
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.IPosition,
  ): Promise<readonly ReferenceItem[] | null> {
    if (this.resolve(model) === null) {
      return null;
    }
    const result: unknown = await this.request(
      model,
      'textDocument/references',
      position as MonacoApi.Position,
      { context: { includeDeclaration: true } },
    );
    if (!Array.isArray(result)) {
      return [];
    }
    const locations: readonly CodeLocation[] = (result as LspLocation[]).map(
      (entry: LspLocation): CodeLocation => ({
        path: this.uriToPath(entry.uri),
        range: this.toRange(entry.range),
      }),
    );
    return this.linePreviews.fill(locations, this.monaco.getMonaco());
  }

  /**
   * Determines whether a language server that serves a document can rename a symbol in it (#1015).
   * @param model The editor model.
   * @returns Returns true when a server serves the document and renames.
   */
  public servesRename(model: MonacoApi.editor.ITextModel): boolean {
    const ref: LspDocumentRef | null = this.resolve(model);
    return ref !== null && ref.rename !== 'none';
  }

  /**
   * Asks the language server that serves a document whether the symbol at a position can be renamed,
   * and what its name spans, for Rename Symbol (#1015). A server that cannot say beforehand is
   * answered for by the word at the position.
   * @param model The editor model.
   * @param position The one-based position.
   * @returns Returns what the server says, or null when no server that renames serves the document.
   */
  public async prepareRename(
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.IPosition,
  ): Promise<LspRenamePreparation | null> {
    const ref: LspDocumentRef | null = this.resolve(model);
    if (ref === null || ref.rename === 'none') {
      return null;
    }
    if (ref.rename === 'rename') {
      return wordPreparation(model, position);
    }
    const outcome: LspOutcome = await this.ask(ref, 'textDocument/prepareRename', {
      textDocument: { uri: ref.uri },
      position: toLspPosition(position),
    });
    if (!outcome.ok) {
      return { kind: 'refused', reason: outcome.message };
    }
    const result: unknown = outcome.result;
    if (result === null || result === undefined || typeof result !== 'object') {
      return { kind: 'refused', reason: null };
    }
    // Three shapes: a bare range, a range with the name to show, or "the default" — the word.
    const answer: {
      range?: unknown;
      placeholder?: unknown;
      defaultBehavior?: unknown;
      start?: unknown;
    } = result;
    if (answer.defaultBehavior === true) {
      return wordPreparation(model, position);
    }
    const raw: unknown = answer.start !== undefined ? result : answer.range;
    if (typeof raw !== 'object' || raw === null || !('start' in raw) || !('end' in raw)) {
      return { kind: 'refused', reason: null };
    }
    const range: MonacoApi.IRange = this.toRange(raw as LspRange);
    return {
      kind: 'ready',
      range,
      placeholder:
        typeof answer.placeholder === 'string' ? answer.placeholder : model.getValueInRange(range),
    };
  }

  /**
   * Asks the language server that serves a document for the edits that rename the symbol at a
   * position (#1015), keyed by file path — so files nobody has opened are renamed too. Both shapes a
   * server may answer in are read: per-file `changes`, or versioned `documentChanges`, whose file
   * operations are refused and named.
   * @param model The editor model.
   * @param position The one-based position.
   * @param newName The new name.
   * @returns Returns the server's answer, or null when no server that renames serves the document.
   */
  public async rename(
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.IPosition,
    newName: string,
  ): Promise<LspRenameAnswer | null> {
    const ref: LspDocumentRef | null = this.resolve(model);
    if (ref === null || ref.rename === 'none') {
      return null;
    }
    const outcome: LspOutcome = await this.ask(ref, 'textDocument/rename', {
      textDocument: { uri: ref.uri },
      position: toLspPosition(position),
      newName,
    });
    if (!outcome.ok) {
      return { kind: 'refused', reason: outcome.message };
    }
    return {
      kind: 'edits',
      edits: fromLspWorkspaceEdit(outcome.result, (uri: string): string => this.uriToPath(uri)),
    };
  }

  /**
   * Determines whether a language server that serves a document offers code actions in it (#1016).
   * @param model The editor model.
   * @returns Returns true when a server serves the document and offers code actions.
   */
  public servesCodeActions(model: MonacoApi.editor.ITextModel): boolean {
    const ref: LspDocumentRef | null = this.resolve(model);
    return ref !== null && (ref.codeActions ?? 'none') !== 'none';
  }

  /**
   * Asks the language server that serves a document for the code actions at a span (#1016) — the
   * fixes for its problems there, and the refactors and source actions it offers — sending back the
   * diagnostics that touch the span exactly as the server sent them, so it can find its fixes by
   * their codes and data. Edits come back keyed by file path, so files nobody has opened change too.
   * @param model The editor model.
   * @param range The span, one-based: the selection, or the caret as an empty span.
   * @param only The kinds to ask for (`quickfix`, `refactor`…), or undefined for every kind.
   * @param automatic Whether the request was made without the user asking (the fix icon), rather than
   * by the user (the menu).
   * @returns Returns the actions, in the server's order, or null when no server that offers code
   * actions serves the document (an empty list is a server answering that it has none).
   */
  public async codeActions(
    model: MonacoApi.editor.ITextModel,
    range: MonacoApi.IRange,
    only?: readonly string[],
    automatic: boolean = false,
  ): Promise<readonly LspCodeAction[] | null> {
    const ref: LspDocumentRef | null = this.resolve(model);
    if (ref === null || (ref.codeActions ?? 'none') === 'none') {
      return null;
    }
    const diagnostics: readonly LspDiagnostic[] = (ref.diagnostics ?? []).filter(
      (diagnostic: LspDiagnostic): boolean => touches(diagnostic.range, range),
    );
    const outcome: LspOutcome = await this.ask(ref, 'textDocument/codeAction', {
      textDocument: { uri: ref.uri },
      range: {
        start: toLspPosition({ lineNumber: range.startLineNumber, column: range.startColumn }),
        end: toLspPosition({ lineNumber: range.endLineNumber, column: range.endColumn }),
      },
      context: {
        diagnostics,
        ...(only === undefined ? {} : { only: [...only] }),
        // CodeActionTriggerKind: 1 when the user asked, 2 when it was asked for them.
        triggerKind: automatic ? 2 : 1,
      },
    });
    if (!outcome.ok || !Array.isArray(outcome.result)) {
      return [];
    }
    const actions: LspCodeAction[] = [];
    for (const raw of outcome.result as unknown[]) {
      const action: LspCodeAction | null = this.toCodeAction(raw);
      if (action !== null) {
        actions.push(action);
      }
    }
    return actions;
  }

  /**
   * Fills in a chosen code action's edit and command (#1016), for a server that leaves them out until
   * an action is chosen (`codeAction/resolve`). An action that is already whole, a server that does
   * not resolve, and a resolve that fails all leave the action as it was.
   * @param model The editor model the action was offered in.
   * @param action The action.
   * @returns Returns the action, filled in where the server filled it in.
   */
  public async resolveCodeAction(
    model: MonacoApi.editor.ITextModel,
    action: LspCodeAction,
  ): Promise<LspCodeAction> {
    const ref: LspDocumentRef | null = this.resolve(model);
    if (ref?.codeActions !== 'resolve' || isCommand(action.raw)) {
      return action;
    }
    const outcome: LspOutcome = await this.ask(ref, 'codeAction/resolve', action.raw);
    const resolved: LspCodeAction | null = outcome.ok ? this.toCodeAction(outcome.result) : null;
    if (resolved === null) {
      return action;
    }
    return {
      ...resolved,
      edit: resolved.edit ?? action.edit,
      command: resolved.command ?? action.command,
    };
  }

  /**
   * Runs a code action's command on the language server that serves a document (#1016)
   * (`workspace/executeCommand`). Only a command the server lists among those it runs is sent: any
   * other is a command for the client, which Studio does not run. Whatever the command changes, the
   * server sends as a `workspace/applyEdit`, which is applied as it arrives.
   * @param model The editor model the action was offered in.
   * @param command The command.
   * @returns Returns whether the server ran it, or why it was not run.
   */
  public async executeCommand(
    model: MonacoApi.editor.ITextModel,
    command: LspCommand,
  ): Promise<LspCommandOutcome> {
    const ref: LspDocumentRef | null = this.resolve(model);
    if (ref === null) {
      return { ran: false, reason: 'No language server serves this document any more.' };
    }
    if (!(ref.commands ?? []).includes(command.command)) {
      return {
        ran: false,
        reason: `“${command.title.length > 0 ? command.title : command.command}” is a step Studio can't run yet.`,
      };
    }
    const outcome: LspOutcome = await this.ask(ref, 'workspace/executeCommand', {
      command: command.command,
      ...(command.arguments === undefined ? {} : { arguments: [...command.arguments] }),
    });
    return outcome.ok ? { ran: true } : { ran: false, reason: outcome.message };
  }

  /**
   * Answers the question Monaco's hover over a problem asks — whether it has fixes — so the hover
   * offers its "Quick Fix…" link, which opens Studio's menu (#1016). Only that question is answered:
   * anything else Monaco asks gets no actions, so no route of Monaco's ever applies one.
   * @param model The model the problem is in.
   * @param range The problem's span.
   * @param context What Monaco asks for, and the problem's marker.
   * @returns Returns the fixes that can run, titled, without their edits.
   */
  private async provideMarkerFixes(
    model: MonacoApi.editor.ITextModel,
    range: MonacoApi.IRange,
    context: MonacoApi.languages.CodeActionContext,
  ): Promise<MonacoApi.languages.CodeActionList> {
    const none: MonacoApi.languages.CodeActionList = {
      actions: [],
      dispose: (): void => undefined,
    };
    if (context.only === undefined || !isFixKind(context.only)) {
      return none;
    }
    const actions: readonly LspCodeAction[] | null = await this.codeActions(model, range, [
      'quickfix',
    ]);
    if (actions === null) {
      return none;
    }
    return {
      actions: actions
        .filter(
          (action: LspCodeAction): boolean =>
            action.disabledReason === null && (action.kind === '' || isFixKind(action.kind)),
        )
        .map((action: LspCodeAction): MonacoApi.languages.CodeAction => ({
          title: action.title,
          kind: action.kind.length > 0 ? action.kind : 'quickfix',
          isPreferred: action.isPreferred,
          diagnostics: context.markers,
        })),
      dispose: (): void => undefined,
    };
  }

  /**
   * Reads one entry of a server's code-action answer: a code action, or a bare command, which is an
   * action that only runs its command.
   * @param raw The entry, untrusted.
   * @returns Returns the action, or null when it is malformed.
   */
  private toCodeAction(raw: unknown): LspCodeAction | null {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const entry: {
      title?: unknown;
      kind?: unknown;
      isPreferred?: unknown;
      disabled?: unknown;
      edit?: unknown;
      command?: unknown;
    } = raw;
    if (typeof entry.title !== 'string') {
      return null;
    }
    if (isCommand(raw)) {
      return {
        title: entry.title,
        kind: '',
        isPreferred: false,
        disabledReason: null,
        edit: null,
        command: toCommand(raw),
        raw,
      };
    }
    const disabled: unknown = entry.disabled;
    const reason: unknown = (disabled as { reason?: unknown } | undefined)?.reason;
    return {
      title: entry.title,
      kind: typeof entry.kind === 'string' ? entry.kind : '',
      isPreferred: entry.isPreferred === true,
      disabledReason:
        typeof disabled !== 'object' || disabled === null
          ? null
          : typeof reason === 'string' && reason.length > 0
            ? reason
            : "It can't be applied here.",
      edit:
        typeof entry.edit === 'object' && entry.edit !== null
          ? fromLspWorkspaceEdit(entry.edit, (uri: string): string => this.uriToPath(uri))
          : null,
      command: toCommand(entry.command),
      raw,
    };
  }

  /**
   * Sends a request to a document's server, keeping the server's error rather than swallowing it: a
   * rename's refusal is the server's message, for the user.
   * @param ref The document.
   * @param method The protocol method to call.
   * @param params The request's parameters.
   * @returns Returns the server's result, or its error's message.
   */
  private async ask(ref: LspDocumentRef, method: string, params: unknown): Promise<LspOutcome> {
    if (this.bridge === undefined) {
      return { ok: false, message: 'No language server is available.' };
    }
    try {
      const result: unknown = await this.bridge.invoke(
        LspChannel.Request,
        ref.sessionId,
        method,
        params,
      );
      if (result !== null && result !== undefined) {
        this.notifyServed(ref.sessionId);
      }
      return { ok: true, result };
    } catch (error: unknown) {
      this.log.debug('LspFeatures', `${method} failed`, error);
      return { ok: false, message: serverMessage(error) };
    }
  }

  /**
   * Reads the symbols a language server reports for a document — its types and their members, nested
   * — for the editor strip's navigation and Monaco's Go to Symbol (#882).
   * @param model The editor model.
   * @returns Returns the document's top-level symbols, or null when no server serves the document or
   * it could not answer.
   */
  public async documentSymbols(
    model: MonacoApi.editor.ITextModel,
  ): Promise<readonly CodeSymbol[] | null> {
    const ref: LspDocumentRef | null = this.resolve(model);
    if (ref === null || this.bridge === undefined) {
      return null;
    }
    try {
      const result: unknown = await this.bridge.invoke(
        LspChannel.Request,
        ref.sessionId,
        'textDocument/documentSymbol',
        { textDocument: { uri: ref.uri } },
      );
      if (result === null || result === undefined) {
        return null;
      }
      this.notifyServed(ref.sessionId);
      return toCodeSymbols(result);
    } catch {
      return null;
    }
  }

  /**
   * Converts a symbol to Monaco's shape, with its children. Monaco numbers symbol kinds from zero, in
   * the protocol's order, which numbers them from one.
   * @param symbol The symbol.
   * @returns Returns Monaco's symbol.
   */
  private toMonacoSymbol(symbol: CodeSymbol): MonacoApi.languages.DocumentSymbol {
    return {
      name: symbol.name,
      detail: '',
      kind: symbol.kind - 1,
      tags: [],
      range: this.toRange(symbol.range),
      selectionRange: this.toRange(symbol.selectionRange),
      children: symbol.children.map((child: CodeSymbol): MonacoApi.languages.DocumentSymbol =>
        this.toMonacoSymbol(child),
      ),
    };
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

/**
 * Converts a one-based editor position to a zero-based protocol position.
 * @param position The editor position.
 * @returns Returns the protocol position.
 */
function toLspPosition(position: MonacoApi.IPosition): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

/**
 * Determines whether a server diagnostic's span touches a span of the editor's — overlaps it, or
 * meets it at an end, as a caret at either end of a problem is on it.
 * @param diagnostic The diagnostic's span, zero-based.
 * @param range The editor's span, one-based.
 * @returns Returns true when they touch.
 */
function touches(diagnostic: LspRange, range: MonacoApi.IRange): boolean {
  const startLine: number = diagnostic.start.line + 1;
  const startColumn: number = diagnostic.start.character + 1;
  const endLine: number = diagnostic.end.line + 1;
  const endColumn: number = diagnostic.end.character + 1;
  const startsBeforeRangeEnds: boolean =
    startLine < range.endLineNumber ||
    (startLine === range.endLineNumber && startColumn <= range.endColumn);
  const endsAfterRangeStarts: boolean =
    endLine > range.startLineNumber ||
    (endLine === range.startLineNumber && endColumn >= range.startColumn);
  return startsBeforeRangeEnds && endsAfterRangeStarts;
}

/**
 * Determines whether a code-action kind is a fix: `quickfix` itself, or a kind below it.
 * @param kind The kind.
 * @returns Returns true when it is.
 */
function isFixKind(kind: string): boolean {
  return kind === 'quickfix' || kind.startsWith('quickfix.');
}

/**
 * Determines whether an entry of a code-action answer is a bare command — `command` naming it, rather
 * than a code action's `command` holding one.
 * @param raw The entry, untrusted.
 * @returns Returns true when it is.
 */
function isCommand(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { command?: unknown }).command === 'string'
  );
}

/**
 * Reads a server's command.
 * @param raw The command, untrusted.
 * @returns Returns the command, or null when there is none or it is malformed.
 */
function toCommand(raw: unknown): LspCommand | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const entry: { title?: unknown; command?: unknown; arguments?: unknown } = raw;
  if (typeof entry.command !== 'string') {
    return null;
  }
  return {
    title: typeof entry.title === 'string' ? entry.title : '',
    command: entry.command,
    ...(Array.isArray(entry.arguments) ? { arguments: entry.arguments as unknown[] } : {}),
  };
}

/**
 * Answers a rename's preparation with the word at a position, for a server that cannot say itself.
 * @param model The model.
 * @param position The one-based position.
 * @returns Returns the word's span and text, or a refusal when there is no word there.
 */
function wordPreparation(
  model: MonacoApi.editor.ITextModel,
  position: MonacoApi.IPosition,
): LspRenamePreparation {
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
 * Reads a server's error message out of a failed request: the IPC layer wraps it as "Error invoking
 * remote method '…': Error: <message>", and only the message is for the user.
 * @param error The failure.
 * @returns Returns the message.
 */
function serverMessage(error: unknown): string {
  const message: string = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}
