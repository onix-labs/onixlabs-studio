import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import {
  LspApi,
  LspSemanticTokensLegend,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
} from '../../../shared/lsp-types';
import { Editors } from '@shared/angular/services/editors/editors';
import { Monaco } from '@shared/angular/services/monaco/monaco';

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
   * Holds the language-server bridge, or undefined outside Electron.
   */
  private readonly api: LspApi | undefined = window.studio?.lsp;

  /**
   * Holds the registered document resolvers contributed by the workspace clients.
   */
  private readonly resolvers: Set<LspDocumentResolver> = new Set<LspDocumentResolver>();

  /**
   * Holds whether the Monaco providers have been registered, so registration happens once.
   */
  private registered: boolean = false;

  /**
   * Fires to ask Monaco to re-request semantic tokens. Monaco requests them when a document first
   * opens — before its language server has started — and caches the empty result; firing this once the
   * server is ready makes it ask again so the tokens actually paint.
   */
  private semanticTokensChanged: MonacoApi.Emitter<void> | null = null;

  /**
   * Initializes the service, registering the Monaco providers once Monaco has loaded.
   */
  public constructor() {
    if (this.api === undefined) {
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
   * Registers the Monaco feature providers for every supported language.
   */
  private registerProviders(): void {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined || this.registered) {
      return;
    }
    this.registered = true;
    this.semanticTokensChanged = new monaco.Emitter<void>();
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
      monaco.languages.registerDocumentSemanticTokensProvider(language, {
        onDidChange: this.semanticTokensChanged.event,
        getLegend: (): MonacoApi.languages.SemanticTokensLegend => SEMANTIC_LEGEND,
        provideDocumentSemanticTokens: (
          model: MonacoApi.editor.ITextModel,
        ): Promise<MonacoApi.languages.SemanticTokens | undefined> =>
          this.provideSemanticTokens(model),
        releaseDocumentSemanticTokens: (): void => undefined,
      });
    }
  }

  /**
   * Asks Monaco to re-request semantic tokens for every open model. Called when a language server
   * becomes ready, so a document opened before its server started gets coloured without an edit.
   */
  public refreshSemanticTokens(): void {
    this.semanticTokensChanged?.fire();
  }

  /**
   * Handles a document semantic-tokens request, fetching the server's tokens and mapping its legend
   * onto the fixed Monaco legend so types, members, and parameters are coloured.
   * @param model The model the tokens are requested for.
   * @returns Returns the semantic tokens, or undefined when no server owns the model or it provides
   * none.
   */
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

  private async provideSemanticTokens(
    model: MonacoApi.editor.ITextModel,
  ): Promise<MonacoApi.languages.SemanticTokens | undefined> {
    const ref: LspDocumentRef | null = this.resolve(model);
    if (ref === null || this.api === undefined) {
      return undefined;
    }
    const legend: LspSemanticTokensLegend | null | undefined = ref.semanticLegend;
    if (legend === undefined || legend === null) {
      return undefined;
    }
    let result: unknown;
    try {
      result = await this.api.request(ref.sessionId, 'textDocument/semanticTokens/full', {
        textDocument: { uri: ref.uri },
      });
    } catch {
      return undefined;
    }
    const data: unknown = (result as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) {
      return undefined;
    }
    return { data: this.remapSemanticTokens(data as number[], legend) };
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
      suggestions: items.map(
        (item: LspCompletionItem): MonacoApi.languages.CompletionItem =>
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
    if (ref === null || this.api === undefined) {
      return null;
    }
    const params: Record<string, unknown> = {
      textDocument: { uri: ref.uri },
      position: { line: position.lineNumber - 1, character: position.column - 1 },
      ...extra,
    };
    try {
      return await this.api.request(ref.sessionId, method, params);
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
