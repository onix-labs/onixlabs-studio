import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { LspChannel, LspSemanticTokensLegend } from '@shared/api/lsp-channels';
import { FileChannel } from '@shared/api/file-channels';
import { Editors } from '@shared/angular/services/editors/editors';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import type { LspDiagnostic } from './lsp-client';
import {
  escapeMarkdown,
  FEATURE_LANGUAGES,
  hoverContents,
  LspCodeAction,
  LspCodeActionSupport,
  LspFeatures,
  LspRenameAnswer,
  LspRenamePreparation,
  LspRenameSupport,
  STUDIO_LSP_COMMAND,
} from './lsp-features';
import type { LspCompletionSupport, LspSignatureHelpSupport } from './lsp-completion';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * A fake Monaco emitter that records how often it fired, so refresh scoping can be asserted.
 */
class FakeEmitter {
  public fired: number = 0;
  public readonly event: () => { dispose(): void } = (): { dispose(): void } => ({
    dispose: (): void => undefined,
  });
  public fire(): void {
    this.fired += 1;
  }
}

/**
 * Captures the providers registered against the fake Monaco namespace, so the test can invoke them.
 */
interface CapturedProviders {
  completion?: {
    triggerCharacters?: string[];
    provideCompletionItems(model: unknown, position: unknown, context?: unknown): Promise<unknown>;
    resolveCompletionItem?(item: unknown): Promise<unknown>;
  };
  signature?: {
    signatureHelpTriggerCharacters?: string[];
    signatureHelpRetriggerCharacters?: string[];
    provideSignatureHelp(
      model: unknown,
      position: unknown,
      token: unknown,
      context: unknown,
    ): Promise<unknown>;
  };
  /** How many completion providers were registered, and how many of those were disposed. */
  completionRegistrations?: number;
  completionDisposals?: number;
  /** The Monaco commands registered, by id. */
  commands?: Map<string, (...args: unknown[]) => unknown>;
  hover?: { provideHover(model: unknown, position: unknown): Promise<unknown> };
  symbols?: { provideDocumentSymbols(model: unknown): Promise<unknown> };
  semantic?: {
    getLegend(): { tokenTypes: string[]; tokenModifiers: string[] };
    provideDocumentSemanticTokens(model: unknown): Promise<{ data: Uint32Array } | undefined>;
  };
  /** The semantic-token change emitter per registered language, in registration order. */
  semanticEmitters: Map<string, FakeEmitter>;
}

/**
 * The shape of the mapped completion list asserted by the test.
 */
interface MappedCompletionList {
  suggestions: { label: string; insertText: string; kind: number; range: unknown }[];
}

/**
 * The shape of the mapped hover asserted by the test.
 */
interface MappedHover {
  contents: { value: string }[];
  range: unknown;
}

/**
 * A minimal fake of the Monaco namespace covering only what the feature providers use.
 */
function fakeMonacoNamespace(
  captured: CapturedProviders,
  models: readonly unknown[] = [],
): unknown {
  const created: FakeEmitter[] = [];
  const emitterClass: new () => FakeEmitter = class extends FakeEmitter {
    public constructor() {
      super();
      created.push(this);
    }
  };
  return {
    editor: {
      // The heuristic fallback tokenizes with Monarch only to skip strings/comments/keywords; an
      // empty token line means nothing is skipped, which is what these tests want.
      tokenize: (): unknown[][] => [],
      // The models of the open editors, whose lines a references list previews (#1014).
      getModels: (): readonly unknown[] => models,
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown): void => {
        captured.commands ??= new Map();
        captured.commands.set(id, handler);
      },
    },
    languages: {
      CompletionItemKind: { Method: 0, Function: 1, Class: 5, Text: 18, Snippet: 28 },
      CompletionItemInsertTextRule: { KeepWhitespace: 1, InsertAsSnippet: 4 },
      registerCompletionItemProvider: (_language: string, provider: unknown): unknown => {
        captured.completion = provider as CapturedProviders['completion'];
        captured.completionRegistrations = (captured.completionRegistrations ?? 0) + 1;
        return {
          dispose: (): void => {
            captured.completionDisposals = (captured.completionDisposals ?? 0) + 1;
          },
        };
      },
      registerSignatureHelpProvider: (_language: string, provider: unknown): unknown => {
        captured.signature = provider as CapturedProviders['signature'];
        return { dispose: (): void => undefined };
      },
      registerHoverProvider: (_language: string, provider: unknown): void => {
        captured.hover = provider as CapturedProviders['hover'];
      },
      registerDefinitionProvider: (): void => undefined,
      registerReferenceProvider: (): void => undefined,
      registerDocumentSymbolProvider: (_language: string, provider: unknown): void => {
        captured.symbols = provider as CapturedProviders['symbols'];
      },
      registerDocumentSemanticTokensProvider: (language: string, provider: unknown): void => {
        captured.semantic = provider as CapturedProviders['semantic'];
        const lastEmitter: FakeEmitter | undefined = created[created.length - 1];
        if (lastEmitter !== undefined) {
          captured.semanticEmitters.set(language, lastEmitter);
        }
      },
    },
    Emitter: emitterClass,
    Uri: { parse: (value: string): unknown => ({ value }) },
  };
}

/**
 * Builds a fake Monaco text model exposing what the semantic-token path reads: its URI, language,
 * version, and text.
 * @param uri The model URI.
 * @param languageId The model's language identifier.
 * @param value The model text.
 * @returns Returns the fake model.
 */
function fakeModel(uri: string, languageId: string = 'typescript', value: string = ''): unknown {
  return {
    uri: { toString: (): string => uri },
    getLanguageId: (): string => languageId,
    getVersionId: (): number => 1,
    getValue: (): string => value,
  };
}

/**
 * Resolves all pending microtasks so the constructor's deferred provider registration runs.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('LspFeatures', () => {
  const MODEL_URI: string = 'inmemory://model/1';
  const captured: CapturedProviders = { semanticEmitters: new Map<string, FakeEmitter>() };
  let requests: { sessionId: string; method: string; params: unknown }[];
  let responses: Record<string, unknown>;
  let semanticLegend: LspSemanticTokensLegend | null;
  let suppressWhen: ((model: unknown) => boolean) | undefined;
  let wordsSuppressedWhen: ((model: unknown) => boolean) | undefined;
  let completionSupport: LspCompletionSupport | null | undefined;
  let signatureSupport: LspSignatureHelpSupport | null | undefined;
  let openModels: unknown[];
  let files: Record<string, string>;
  let reads: string[];
  let renameSupport: LspRenameSupport | undefined;
  let codeActionSupport: LspCodeActionSupport | undefined;
  let serverCommands: readonly string[] | undefined;
  let serverDiagnostics: readonly LspDiagnostic[] | undefined;
  /** The document's catch-up hook, when a test gives it one. */
  let syncHook: ((text: string) => Promise<void>) | undefined;

  beforeEach(() => {
    captured.completion = undefined;
    captured.signature = undefined;
    captured.completionRegistrations = 0;
    captured.completionDisposals = 0;
    captured.commands = undefined;
    captured.hover = undefined;
    captured.symbols = undefined;
    captured.semantic = undefined;
    captured.semanticEmitters = new Map<string, FakeEmitter>();
    requests = [];
    responses = {};
    semanticLegend = null;
    suppressWhen = undefined;
    wordsSuppressedWhen = undefined;
    completionSupport = undefined;
    signatureSupport = undefined;
    openModels = [];
    files = {};
    reads = [];
    renameSupport = undefined;
    codeActionSupport = undefined;
    serverCommands = undefined;
    serverDiagnostics = undefined;
    syncHook = undefined;
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (FileChannel.Read as string)) {
          const filePath: string = args[0] as string;
          reads.push(filePath);
          const content: string | undefined = files[filePath];
          return Promise.resolve((content === undefined ? null : { path: filePath, content }) as T);
        }
        if (channel === (LspChannel.Request as string)) {
          const [sessionId, method, params] = args as [string, string, unknown];
          requests.push({ sessionId, method, params });
          const response: unknown = responses[method];
          // A server's error reaches the renderer as Electron's wrapped rejection.
          return response instanceof Error
            ? Promise.reject(response)
            : Promise.resolve((response ?? null) as T);
        }
        return Promise.resolve(null as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  /**
   * Builds the service with a fake Monaco namespace and a single document resolver, then waits for
   * provider registration.
   * @returns Returns the built service once its providers are registered.
   */
  async function build(): Promise<LspFeatures> {
    const monaco: unknown = {
      ensureLoaded: (): Promise<void> => Promise.resolve(),
      getMonaco: (): unknown => fakeMonacoNamespace(captured, openModels),
      suppressHeuristicTokensWhen: (predicate: (model: unknown) => boolean): (() => void) => {
        suppressWhen = predicate;
        return (): void => undefined;
      },
      suppressWordSuggestionsWhen: (predicate: (model: unknown) => boolean): (() => void) => {
        wordsSuppressedWhen = predicate;
        return (): void => undefined;
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: Monaco, useValue: monaco }] });
    const editors: Editors = TestBed.inject(Editors);
    editors.register(MODEL_URI, { documentId: 'doc-1', path: '/root/app.ts', name: 'app.ts' });
    const features: LspFeatures = TestBed.inject(LspFeatures);
    features.registerDocuments((path: string) =>
      path === '/root/app.ts'
        ? {
            sessionId: '/root::typescript',
            uri: 'file:///root/app.ts',
            semanticLegend,
            ...(renameSupport === undefined ? {} : { rename: renameSupport }),
            ...(codeActionSupport === undefined ? {} : { codeActions: codeActionSupport }),
            ...(serverCommands === undefined ? {} : { commands: serverCommands }),
            ...(serverDiagnostics === undefined ? {} : { diagnostics: serverDiagnostics }),
            ...(completionSupport === undefined ? {} : { completion: completionSupport }),
            ...(signatureSupport === undefined ? {} : { signatureHelp: signatureSupport }),
            ...(syncHook === undefined ? {} : { sync: syncHook }),
          }
        : null,
    );
    await flush();
    return features;
  }

  it('aRequestAboutAPosition_bringsTheServerUpToDateFirst', async () => {
    // Matthew's live check of #1021: a completion on "." overtook the change that typed it, and the
    // server answered for the text before — the globals, not the members after `message.`.
    responses['textDocument/completion'] = { items: [{ label: 'charAt' }] };
    const order: string[] = [];
    syncHook = (text: string): Promise<void> => {
      order.push(`sync ${text}`);
      return Promise.resolve();
    };
    await build();
    const model: unknown = {
      uri: { toString: (): string => MODEL_URI },
      getValue: (): string => 'message.',
      getWordUntilPosition: (): unknown => ({ startColumn: 9, endColumn: 9, word: '' }),
    };
    const before: number = requests.length;

    await captured.completion?.provideCompletionItems(model, { lineNumber: 1, column: 9 });
    order.push(`request ${requests[before]?.method}`);

    expect(order).toEqual(['sync message.', 'request textDocument/completion']);
  });

  it('completion_mapsTextEditRangeAndInsertText', async () => {
    responses['textDocument/completion'] = {
      items: [
        {
          label: 'charAt',
          kind: 2,
          textEdit: {
            range: { start: { line: 1, character: 20 }, end: { line: 1, character: 21 } },
            newText: '.charAt',
          },
        },
      ],
    };
    await build();
    const model: unknown = {
      uri: { toString: (): string => MODEL_URI },
      getWordUntilPosition: (): unknown => ({ startColumn: 22, endColumn: 22, word: '' }),
    };
    const list: MappedCompletionList = (await captured.completion?.provideCompletionItems(model, {
      lineNumber: 2,
      column: 22,
    })) as MappedCompletionList;

    expect(requests[0]?.method).toBe('textDocument/completion');
    expect(list.suggestions).toHaveLength(1);
    expect(list.suggestions[0].label).toBe('charAt');
    expect(list.suggestions[0].insertText).toBe('.charAt');
    expect(list.suggestions[0].kind).toBe(0); // fake Method kind
    expect(list.suggestions[0].range).toEqual({
      startLineNumber: 2,
      startColumn: 21,
      endLineNumber: 2,
      endColumn: 22,
    });
  });

  /**
   * Builds a model of the served document, at whose caret the word typed so far starts at column 1.
   * @returns Returns the model.
   */
  function servedModel(): unknown {
    return {
      uri: { toString: (): string => MODEL_URI },
      getWordUntilPosition: (): unknown => ({ startColumn: 1, endColumn: 4, word: 'abc' }),
    };
  }

  it('completion_sendsWhatStartedIt_andKeepsAnIncompleteList (#1021)', async () => {
    completionSupport = { triggerCharacters: ['.'], resolve: false };
    responses['textDocument/completion'] = { isIncomplete: true, items: [{ label: 'length' }] };
    await build();

    const list: { incomplete?: boolean } = (await captured.completion?.provideCompletionItems(
      servedModel(),
      { lineNumber: 1, column: 4 },
      // Monaco's TriggerCharacter is 1; the protocol's is 2.
      { triggerKind: 1, triggerCharacter: '.' },
    )) as { incomplete?: boolean };

    expect((requests[0]?.params as { context: unknown }).context).toEqual({
      triggerKind: 2,
      triggerCharacter: '.',
    });
    expect(list.incomplete).toBe(true);
  });

  it('completion_onATriggerCharacterTheServerDoesNotTriggerOn_asksNothing (#1021)', async () => {
    completionSupport = { triggerCharacters: ['.'], resolve: false };
    await build();

    const list: unknown = await captured.completion?.provideCompletionItems(
      servedModel(),
      { lineNumber: 1, column: 4 },
      { triggerKind: 1, triggerCharacter: ':' },
    );

    expect(requests).toHaveLength(0);
    expect(list).toBeUndefined();
  });

  it('completion_resolve_sendsTheItemBack_andFillsItIn (#1021)', async () => {
    completionSupport = { triggerCharacters: [], resolve: true };
    responses['textDocument/completion'] = {
      items: [{ label: 'List', kind: 7 }],
      itemDefaults: { data: { id: 7 } },
    };
    responses['completionItem/resolve'] = {
      label: 'List',
      detail: 'class List<T>',
      documentation: { kind: 'markdown', value: 'A **list**.' },
      additionalTextEdits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: 'using System;\n',
        },
      ],
    };
    await build();
    const list: { suggestions: unknown[] } = (await captured.completion?.provideCompletionItems(
      servedModel(),
      { lineNumber: 1, column: 4 },
      { triggerKind: 0 },
    )) as { suggestions: unknown[] };

    const resolved: Record<string, unknown> = (await captured.completion?.resolveCompletionItem?.(
      list.suggestions[0],
    )) as Record<string, unknown>;

    expect(requests[1]?.method).toBe('completionItem/resolve');
    expect(requests[1]?.sessionId).toBe('/root::typescript');
    expect(requests[1]?.params).toMatchObject({ label: 'List', data: { id: 7 } });
    expect(resolved['detail']).toBe('class List<T>');
    expect(resolved['documentation']).toEqual({ value: 'A **list**.' });
    expect(resolved['additionalTextEdits']).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        text: 'using System;\n',
      },
    ]);
  });

  it('completion_resolve_forAServerThatDoesNotResolve_asksNothing (#1021)', async () => {
    completionSupport = { triggerCharacters: [], resolve: false };
    responses['textDocument/completion'] = { items: [{ label: 'x' }] };
    await build();
    const list: { suggestions: unknown[] } = (await captured.completion?.provideCompletionItems(
      servedModel(),
      { lineNumber: 1, column: 4 },
    )) as { suggestions: unknown[] };

    const resolved: unknown = await captured.completion?.resolveCompletionItem?.(
      list.suggestions[0],
    );

    expect(requests).toHaveLength(1);
    expect(resolved).toBe(list.suggestions[0]);
  });

  it('completion_commands_runOnTheServer_orAsMonacosOwn_orNotAtAll (#1021)', async () => {
    serverCommands = ['server.addImport'];
    responses['textDocument/completion'] = {
      items: [
        { label: 'a', command: { title: 'Import', command: 'server.addImport', arguments: [1] } },
        { label: 'b', command: { title: 'Hints', command: 'editor.action.triggerParameterHints' } },
        { label: 'c', command: { title: 'Client', command: 'client.only' } },
      ],
    };
    await build();
    const list: { suggestions: { command?: { id: string; arguments?: unknown[] } }[] } =
      (await captured.completion?.provideCompletionItems(servedModel(), {
        lineNumber: 1,
        column: 4,
      })) as { suggestions: { command?: { id: string; arguments?: unknown[] } }[] };

    expect(list.suggestions[0].command?.id).toBe(STUDIO_LSP_COMMAND);
    expect(list.suggestions[1].command?.id).toBe('editor.action.triggerParameterHints');
    expect(list.suggestions[2].command).toBeUndefined();

    // Accepting the first runs Studio's command, which sends it to its server.
    await captured.commands?.get(STUDIO_LSP_COMMAND)?.(
      undefined,
      ...(list.suggestions[0].command?.arguments ?? []),
    );
    expect(requests[1]).toEqual({
      sessionId: '/root::typescript',
      method: 'workspace/executeCommand',
      params: { command: 'server.addImport', arguments: [1] },
    });
  });

  it('setSessionSupport_registersEveryServersTriggerCharacters_onlyWhenTheyChange (#1021)', async () => {
    const features: LspFeatures = await build();
    const registered: number = captured.completionRegistrations ?? 0;
    expect(captured.completion?.triggerCharacters).toEqual([]);

    features.setSessionSupport('/a::ts', {
      completion: { triggerCharacters: ['.', '"'], resolve: true },
      signatureHelp: { triggerCharacters: ['('], retriggerCharacters: [','] },
    });
    features.setSessionSupport('/b::rust', {
      completion: { triggerCharacters: [':', '.'], resolve: false },
      signatureHelp: null,
    });
    const afterTwo: number = captured.completionRegistrations ?? 0;
    features.setSessionSupport('/b::rust', {
      completion: { triggerCharacters: [':', '.'], resolve: false },
      signatureHelp: null,
    });

    expect(captured.completion?.triggerCharacters).toEqual(['"', '.', ':']);
    expect(captured.signature?.signatureHelpTriggerCharacters).toEqual(['(']);
    expect(captured.signature?.signatureHelpRetriggerCharacters).toEqual([',']);
    expect(afterTwo - registered).toBe(FEATURE_LANGUAGES.length * 2);
    // Each re-registration disposed the providers it replaced; the same characters again change nothing.
    expect(captured.completionDisposals).toBe(FEATURE_LANGUAGES.length * 2);
    expect(captured.completionRegistrations).toBe(afterTwo);
  });

  it('signatureHelp_asksWithWhatStartedIt_andMapsTheAnswer (#1021)', async () => {
    signatureSupport = { triggerCharacters: ['('], retriggerCharacters: [','] };
    responses['textDocument/signatureHelp'] = {
      signatures: [
        {
          label: 'add(a: number, b: number)',
          documentation: 'Adds.',
          parameters: [
            { label: [4, 13] },
            { label: 'b: number', documentation: { kind: 'markdown', value: 'The *b*.' } },
          ],
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    };
    await build();

    const result: { value: unknown } = (await captured.signature?.provideSignatureHelp(
      servedModel(),
      { lineNumber: 1, column: 9 },
      undefined,
      { triggerKind: 2, triggerCharacter: ',', isRetrigger: true },
    )) as { value: unknown };

    expect((requests[0]?.params as { context: unknown }).context).toEqual({
      triggerKind: 2,
      triggerCharacter: ',',
      isRetrigger: true,
    });
    expect(result.value).toEqual({
      signatures: [
        {
          label: 'add(a: number, b: number)',
          documentation: 'Adds.',
          parameters: [
            { label: [4, 13], documentation: undefined },
            { label: 'b: number', documentation: { value: 'The *b*.' } },
          ],
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    });
  });

  it('signatureHelp_forAServerWithout_asksNothing (#1021)', async () => {
    await build();

    const result: unknown = await captured.signature?.provideSignatureHelp(
      servedModel(),
      { lineNumber: 1, column: 9 },
      undefined,
      { triggerKind: 1, isRetrigger: false },
    );

    expect(requests).toHaveLength(0);
    expect(result).toBeUndefined();
  });

  it('wordSuggestions_areLeftOut_forADocumentAServerServes (#1021)', async () => {
    await build();

    expect(wordsSuppressedWhen?.(servedModel())).toBe(true);
    expect(
      wordsSuppressedWhen?.({ uri: { toString: (): string => 'inmemory://model/other' } }),
    ).toBe(false);
  });

  it('hover_extractsMarkupAndMapsRange', async () => {
    responses['textDocument/hover'] = {
      contents: { kind: 'markdown', value: 'const greeting: string' },
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 14 } },
    };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const hover: MappedHover = (await captured.hover?.provideHover(model, {
      lineNumber: 1,
      column: 9,
    })) as MappedHover;

    expect(hover.contents[0].value).toBe('const greeting: string');
    expect(hover.range).toEqual({
      startLineNumber: 1,
      startColumn: 7,
      endLineNumber: 1,
      endColumn: 15,
    });
  });

  it('hover_mapsEachPartAsTheProtocolMeansIt_codeFenced_plainTextEscaped (#1020)', async () => {
    responses['textDocument/hover'] = {
      contents: [
        { language: 'csharp', value: 'void Main()' },
        'A *markdown* string',
        { kind: 'plaintext', value: 'List<int> *not* bold' },
        '',
      ],
    };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const hover: MappedHover = (await captured.hover?.provideHover(model, {
      lineNumber: 1,
      column: 9,
    })) as MappedHover;

    expect(hover.contents.map((content: { value: string }): string => content.value)).toEqual([
      '```csharp\nvoid Main()\n```',
      'A *markdown* string',
      'List\\<int\\> \\*not\\* bold',
    ]);
    expect(hover.range).toBeUndefined();
  });

  it('hoverContents_fencesASnippetPastItsOwnBackticks_andEscapesPlainTextLineByLine (#1020)', () => {
    expect(hoverContents({ language: 'md', value: 'a ``` b' })).toEqual([
      { value: '````md\na ``` b\n````' },
    ]);
    expect(hoverContents({ kind: 'markdown', value: '# Title' })).toEqual([{ value: '# Title' }]);
    expect(hoverContents({ value: 'no kind' })).toEqual([{ value: 'no kind' }]);
    expect(escapeMarkdown('a_b\n[c](d) $e & `f`')).toBe('a\\_b\n\n\\[c\\]\\(d\\) \\$e \\& \\`f\\`');
  });

  it('documentSymbols_asksTheServer_andGivesMonacoTheSameSymbols_kindsFromZero', async () => {
    // #882: one answer feeds both the editor strip's dropdowns and Monaco's Go to Symbol.
    const line: (n: number) => unknown = (n: number): unknown => ({
      start: { line: n, character: 0 },
      end: { line: n, character: 9 },
    });
    responses['textDocument/documentSymbol'] = [
      {
        name: 'Greeter',
        kind: 5,
        range: line(0),
        selectionRange: line(0),
        children: [{ name: 'greet', kind: 6, range: line(0), selectionRange: line(0) }],
      },
    ];
    const features: LspFeatures = await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };

    const symbols: unknown = await features.documentSymbols(
      model as Parameters<LspFeatures['documentSymbols']>[0],
    );
    const monacoSymbols: { name: string; kind: number; children: { kind: number }[] }[] =
      (await captured.symbols?.provideDocumentSymbols(model)) as {
        name: string;
        kind: number;
        children: { kind: number }[];
      }[];

    expect(requests.at(-1)).toEqual({
      sessionId: '/root::typescript',
      method: 'textDocument/documentSymbol',
      params: { textDocument: { uri: 'file:///root/app.ts' } },
    });
    expect((symbols as { name: string }[])[0].name).toBe('Greeter');
    // The protocol's Class (5) and Method (6) are Monaco's 4 and 5.
    expect(monacoSymbols[0]).toMatchObject({ name: 'Greeter', kind: 4 });
    expect(monacoSymbols[0].children[0].kind).toBe(5);
  });

  it('documentSymbols_isNull_forADocumentNoServerServes', async () => {
    const features: LspFeatures = await build();
    const model: unknown = { uri: { toString: (): string => 'inmemory://model/unowned' } };

    expect(
      await features.documentSymbols(model as Parameters<LspFeatures['documentSymbols']>[0]),
    ).toBeNull();
  });

  it('definitions_answersWithPaths_evenForAFileNoEditorHasOpen_linksByTheirName', async () => {
    // #1012: the right-click Go to Definition opens a file nobody has opened yet, which the Monaco
    // provider (open files only) would drop.
    responses['textDocument/definition'] = [
      {
        targetUri: 'file:///root/lib/greeter.ts',
        targetSelectionRange: {
          start: { line: 4, character: 13 },
          end: { line: 4, character: 20 },
        },
      },
      {
        uri: 'file:///root/app.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      },
    ];
    const features: LspFeatures = await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };

    const definitions: unknown = await features.definitions(
      model as Parameters<LspFeatures['definitions']>[0],
      { lineNumber: 3, column: 7 },
    );

    expect(requests.at(-1)).toEqual({
      sessionId: '/root::typescript',
      method: 'textDocument/definition',
      params: { textDocument: { uri: 'file:///root/app.ts' }, position: { line: 2, character: 6 } },
    });
    expect(definitions).toEqual([
      {
        path: '/root/lib/greeter.ts',
        range: { startLineNumber: 5, startColumn: 14, endLineNumber: 5, endColumn: 21 },
      },
      {
        path: '/root/app.ts',
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
      },
    ]);
  });

  it('definitions_isNull_forADocumentNoServerServes_andEmptyWhenTheServerKnowsNone', async () => {
    const features: LspFeatures = await build();
    const unowned: unknown = { uri: { toString: (): string => 'inmemory://model/unowned' } };
    const owned: unknown = { uri: { toString: (): string => MODEL_URI } };

    expect(
      await features.definitions(unowned as Parameters<LspFeatures['definitions']>[0], {
        lineNumber: 1,
        column: 1,
      }),
    ).toBeNull();
    expect(
      await features.definitions(owned as Parameters<LspFeatures['definitions']>[0], {
        lineNumber: 1,
        column: 1,
      }),
    ).toEqual([]);
  });

  it('references_askTheServerWithTheDeclaration_andPreviewOpenAndUnopenedFiles', async () => {
    // #1014: a reference in a file nobody has opened is listed, its line read from disk; one in an
    // open editor is read from its model, unsaved edits and all.
    const lspRange: (line: number, from: number, to: number) => unknown = (
      line: number,
      from: number,
      to: number,
    ): unknown => ({ start: { line, character: from }, end: { line, character: to } });
    responses['textDocument/references'] = [
      { uri: 'file:///root/app.ts', range: lspRange(1, 6, 11) },
      { uri: 'file:///root/lib/greeter.ts', range: lspRange(0, 9, 14) },
      { uri: 'file:///root/lib/greeter.ts', range: lspRange(2, 2, 7) },
    ];
    files['/root/lib/greeter.ts'] = 'function greet() {\n  // …\n  greet();\n}';
    openModels.push({
      uri: { toString: (): string => MODEL_URI },
      isDisposed: (): boolean => false,
      getLinesContent: (): string[] => ['import x;', 'const greet = 1; // unsaved'],
    });
    const features: LspFeatures = await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };

    const references: unknown = await features.references(
      model as Parameters<LspFeatures['references']>[0],
      { lineNumber: 2, column: 8 },
    );

    expect(requests.at(-1)).toEqual({
      sessionId: '/root::typescript',
      method: 'textDocument/references',
      params: {
        textDocument: { uri: 'file:///root/app.ts' },
        position: { line: 1, character: 7 },
        context: { includeDeclaration: true },
      },
    });
    expect(references).toEqual([
      {
        path: '/root/app.ts',
        range: { startLineNumber: 2, startColumn: 7, endLineNumber: 2, endColumn: 12 },
        preview: 'const greet = 1; // unsaved',
      },
      {
        path: '/root/lib/greeter.ts',
        range: { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 15 },
        preview: 'function greet() {',
      },
      {
        path: '/root/lib/greeter.ts',
        range: { startLineNumber: 3, startColumn: 3, endLineNumber: 3, endColumn: 8 },
        preview: '  greet();',
      },
    ]);
    // Read once, however many references fall in it; the open file never.
    expect(reads).toEqual(['/root/lib/greeter.ts']);
  });

  it('references_isNull_forADocumentNoServerServes_andEmptyWhenTheServerKnowsNone', async () => {
    const features: LspFeatures = await build();
    const unowned: unknown = { uri: { toString: (): string => 'inmemory://model/unowned' } };
    const owned: unknown = { uri: { toString: (): string => MODEL_URI } };

    expect(
      await features.references(unowned as Parameters<LspFeatures['references']>[0], {
        lineNumber: 1,
        column: 1,
      }),
    ).toBeNull();
    expect(
      await features.references(owned as Parameters<LspFeatures['references']>[0], {
        lineNumber: 1,
        column: 1,
      }),
    ).toEqual([]);
  });

  describe('rename (#1015)', () => {
    /**
     * Builds the owned model, with the word and text a rename's preparation reads.
     * @returns Returns the model.
     */
    function renameModel(): Parameters<LspFeatures['prepareRename']>[0] {
      return {
        uri: { toString: (): string => MODEL_URI },
        getWordAtPosition: (): unknown => ({ word: 'greet', startColumn: 5, endColumn: 10 }),
        getValueInRange: (): string => 'greet',
      } as unknown as Parameters<LspFeatures['prepareRename']>[0];
    }

    it('prepareRename_asksTheServer_andReadsARangeWithItsPlaceholder', async () => {
      responses['textDocument/prepareRename'] = {
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
        placeholder: 'Greeter.greet',
      };
      const features: LspFeatures = await build();

      const prepared: LspRenamePreparation | null = await features.prepareRename(renameModel(), {
        lineNumber: 3,
        column: 6,
      });

      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'textDocument/prepareRename',
        params: {
          textDocument: { uri: 'file:///root/app.ts' },
          position: { line: 2, character: 5 },
        },
      });
      expect(prepared).toEqual({
        kind: 'ready',
        range: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 10 },
        placeholder: 'Greeter.greet',
      });
    });

    it('prepareRename_readsABareRangeByItsText_andTheDefaultAsTheWord', async () => {
      const features: LspFeatures = await build();
      responses['textDocument/prepareRename'] = {
        start: { line: 2, character: 4 },
        end: { line: 2, character: 9 },
      };
      expect(await features.prepareRename(renameModel(), { lineNumber: 3, column: 6 })).toEqual({
        kind: 'ready',
        range: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 10 },
        placeholder: 'greet',
      });

      responses['textDocument/prepareRename'] = { defaultBehavior: true };
      expect(await features.prepareRename(renameModel(), { lineNumber: 3, column: 6 })).toEqual({
        kind: 'ready',
        range: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 10 },
        placeholder: 'greet',
      });
    });

    it('prepareRename_aNullOrAnError_isARefusal_withTheServersMessage', async () => {
      const features: LspFeatures = await build();
      expect(await features.prepareRename(renameModel(), { lineNumber: 1, column: 1 })).toEqual({
        kind: 'refused',
        reason: null,
      });

      responses['textDocument/prepareRename'] = new Error(
        "Error invoking remote method 'lsp:request': Error: You cannot rename this element.",
      );
      expect(await features.prepareRename(renameModel(), { lineNumber: 1, column: 1 })).toEqual({
        kind: 'refused',
        reason: 'You cannot rename this element.',
      });
    });

    it('prepareRename_aServerThatCannotPrepare_isAnsweredByTheWord_withoutAsking', async () => {
      renameSupport = 'rename';
      const features: LspFeatures = await build();

      expect(await features.prepareRename(renameModel(), { lineNumber: 3, column: 6 })).toEqual({
        kind: 'ready',
        range: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 10 },
        placeholder: 'greet',
      });
      expect(requests).toEqual([]);
    });

    it('isNull_forADocumentNoServerServes_orAServerThatCannotRename', async () => {
      renameSupport = 'none';
      const features: LspFeatures = await build();
      const unowned: unknown = { uri: { toString: (): string => 'inmemory://model/unowned' } };

      expect(await features.prepareRename(renameModel(), { lineNumber: 1, column: 1 })).toBeNull();
      expect(await features.rename(renameModel(), { lineNumber: 1, column: 1 }, 'x')).toBeNull();
      expect(
        await features.prepareRename(unowned as Parameters<LspFeatures['prepareRename']>[0], {
          lineNumber: 1,
          column: 1,
        }),
      ).toBeNull();
      expect(features.servesRename(renameModel())).toBe(false);
    });

    it('rename_readsPerFileChanges_byPath', async () => {
      responses['textDocument/rename'] = {
        changes: {
          'file:///root/app.ts': [
            {
              range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
              newText: 'salute',
            },
          ],
          'file:///root/lib/greeter.ts': [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              newText: 'salute',
            },
          ],
        },
      };
      const features: LspFeatures = await build();

      const answer: LspRenameAnswer | null = await features.rename(
        renameModel(),
        { lineNumber: 3, column: 6 },
        'salute',
      );

      expect(requests.at(-1)?.params).toEqual({
        textDocument: { uri: 'file:///root/app.ts' },
        position: { line: 2, character: 5 },
        newName: 'salute',
      });
      expect(answer?.kind).toBe('edits');
      expect(
        answer?.kind === 'edits'
          ? answer.edits.files.map((file: { path: string }): string => file.path)
          : [],
      ).toEqual(['/root/app.ts', '/root/lib/greeter.ts']);
    });

    it('rename_readsVersionedDocumentChanges_andRefusesTheirFileOperations', async () => {
      responses['textDocument/rename'] = {
        documentChanges: [
          {
            textDocument: { uri: 'file:///root/app.ts', version: 3 },
            edits: [
              {
                range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
                newText: 'salute',
              },
            ],
          },
          { kind: 'rename', oldUri: 'file:///root/greet.ts', newUri: 'file:///root/salute.ts' },
        ],
      };
      const features: LspFeatures = await build();

      const answer: LspRenameAnswer | null = await features.rename(
        renameModel(),
        { lineNumber: 3, column: 6 },
        'salute',
      );

      expect(answer).toEqual({
        kind: 'edits',
        edits: {
          files: [
            {
              path: '/root/app.ts',
              edits: [
                {
                  range: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 10 },
                  text: 'salute',
                },
              ],
            },
          ],
          refused: [
            {
              path: '/root/greet.ts',
              reason: "Creating, renaming or deleting files isn't supported yet.",
            },
          ],
        },
      });
    });

    it('rename_anError_isARefusal_withTheServersMessage', async () => {
      responses['textDocument/rename'] = new Error(
        "Error invoking remote method 'lsp:request': Error: The new name is not valid.",
      );
      const features: LspFeatures = await build();

      expect(await features.rename(renameModel(), { lineNumber: 1, column: 1 }, '1x')).toEqual({
        kind: 'refused',
        reason: 'The new name is not valid.',
      });
    });
  });

  describe('code actions (#1016)', () => {
    /**
     * The owned model.
     */
    const model: Parameters<LspFeatures['codeActions']>[0] = {
      uri: { toString: (): string => MODEL_URI },
    } as unknown as Parameters<LspFeatures['codeActions']>[0];

    /**
     * The caret on line 3, column 6, as an empty span.
     */
    const caret: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    } = {
      startLineNumber: 3,
      startColumn: 6,
      endLineNumber: 3,
      endColumn: 6,
    };

    /**
     * A diagnostic under the caret, with the code and data a server finds its fixes by.
     */
    const underCaret: LspDiagnostic = {
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
      severity: 1,
      message: "The type or namespace name 'List<>' could not be found",
      code: 'CS0246',
      data: { id: 'roslyn-17' },
    };

    /**
     * A diagnostic elsewhere.
     */
    const elsewhere: LspDiagnostic = {
      range: { start: { line: 9, character: 0 }, end: { line: 9, character: 3 } },
      message: 'Unused',
    };

    it('askTheServer_sendingBackTheDiagnosticsAtTheSpan_withTheirCodeAndData', async () => {
      codeActionSupport = 'resolve';
      serverDiagnostics = [underCaret, elsewhere];
      responses['textDocument/codeAction'] = [];
      const features: LspFeatures = await build();

      await features.codeActions(model, caret, ['quickfix'], true);

      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'textDocument/codeAction',
        params: {
          textDocument: { uri: 'file:///root/app.ts' },
          range: { start: { line: 2, character: 5 }, end: { line: 2, character: 5 } },
          context: { diagnostics: [underCaret], only: ['quickfix'], triggerKind: 2 },
        },
      });
    });

    it('readActionsAndBareCommands_byPath_withPreferenceAndWhyOneCannotRun', async () => {
      codeActionSupport = 'actions';
      responses['textDocument/codeAction'] = [
        {
          title: 'Add using System.Collections.Generic',
          kind: 'quickfix',
          isPreferred: true,
          edit: {
            changes: {
              'file:///root/app.ts': [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: 'using System.Collections.Generic;\n',
                },
              ],
            },
          },
          command: { title: 'Format', command: 'server.format', arguments: [1] },
        },
        {
          title: 'Extract method',
          kind: 'refactor.extract',
          disabled: { reason: 'Select some code.' },
        },
        { title: 'Organize', command: 'server.organize' },
        { kind: 'quickfix' },
      ];
      const features: LspFeatures = await build();

      const actions: readonly LspCodeAction[] | null = await features.codeActions(model, caret);

      expect(actions?.map((action: LspCodeAction) => ({ ...action, raw: undefined }))).toEqual([
        {
          title: 'Add using System.Collections.Generic',
          kind: 'quickfix',
          isPreferred: true,
          disabledReason: null,
          edit: {
            files: [
              {
                path: '/root/app.ts',
                edits: [
                  {
                    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
                    text: 'using System.Collections.Generic;\n',
                  },
                ],
              },
            ],
            refused: [],
          },
          command: { title: 'Format', command: 'server.format', arguments: [1] },
          raw: undefined,
        },
        {
          title: 'Extract method',
          kind: 'refactor.extract',
          isPreferred: false,
          disabledReason: 'Select some code.',
          edit: null,
          command: null,
          raw: undefined,
        },
        {
          title: 'Organize',
          kind: '',
          isPreferred: false,
          disabledReason: null,
          edit: null,
          command: { title: 'Organize', command: 'server.organize' },
          raw: undefined,
        },
      ]);
      expect((await features.codeActions(model, caret))?.[0].raw).toEqual(
        (responses['textDocument/codeAction'] as unknown[])[0],
      );
    });

    it('areNull_forADocumentNoServerServes_orAServerWithoutCodeActions_andEmptyOnAnError', async () => {
      const features: LspFeatures = await build();
      expect(await features.codeActions(model, caret)).toBeNull();
      expect(features.servesCodeActions(model)).toBe(false);

      codeActionSupport = 'actions';
      TestBed.resetTestingModule();
      const serving: LspFeatures = await build();
      responses['textDocument/codeAction'] = new Error('boom');
      expect(serving.servesCodeActions(model)).toBe(true);
      expect(await serving.codeActions(model, caret)).toEqual([]);
    });

    it('resolve_fillsInTheEdit_forAServerThatResolves_andLeavesAWholeOrRefusedActionAlone', async () => {
      codeActionSupport = 'resolve';
      responses['textDocument/codeAction'] = [{ title: 'Fix', kind: 'quickfix', data: { id: 7 } }];
      responses['codeAction/resolve'] = {
        title: 'Fix',
        kind: 'quickfix',
        edit: {
          changes: {
            'file:///root/lib.ts': [
              {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
                newText: 'x',
              },
            ],
          },
        },
      };
      const features: LspFeatures = await build();
      const [action] = (await features.codeActions(model, caret)) ?? [];

      const resolved: LspCodeAction = await features.resolveCodeAction(model, action);

      expect(requests.at(-1)).toMatchObject({
        method: 'codeAction/resolve',
        params: { title: 'Fix', kind: 'quickfix', data: { id: 7 } },
      });
      expect(resolved.edit?.files.map((file: { path: string }): string => file.path)).toEqual([
        '/root/lib.ts',
      ]);

      responses['codeAction/resolve'] = new Error('gone');
      expect(await features.resolveCodeAction(model, action)).toBe(action);
    });

    it('resolve_isNotAsked_ofAServerThatDoesNotResolve', async () => {
      codeActionSupport = 'actions';
      responses['textDocument/codeAction'] = [{ title: 'Fix', kind: 'quickfix' }];
      const features: LspFeatures = await build();
      const [action] = (await features.codeActions(model, caret)) ?? [];
      requests = [];

      expect(await features.resolveCodeAction(model, action)).toBe(action);
      expect(requests).toEqual([]);
    });

    it('executeCommand_runsACommandTheServerLists_andRefusesAnyOther', async () => {
      codeActionSupport = 'actions';
      serverCommands = ['server.format'];
      const features: LspFeatures = await build();

      expect(
        await features.executeCommand(model, {
          title: 'Format',
          command: 'server.format',
          arguments: [1],
        }),
      ).toEqual({ ran: true });
      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'workspace/executeCommand',
        params: { command: 'server.format', arguments: [1] },
      });

      requests = [];
      expect(
        await features.executeCommand(model, { title: 'Nested', command: 'roslyn.client.nested' }),
      ).toEqual({ ran: false, reason: "“Nested” is a step Studio can't run yet." });
      expect(requests).toEqual([]);

      responses['workspace/executeCommand'] = new Error(
        "Error invoking remote method 'lsp:request': Error: It failed.",
      );
      expect(
        await features.executeCommand(model, { title: 'Format', command: 'server.format' }),
      ).toEqual({ ran: false, reason: 'It failed.' });
    });
  });

  it('wiresEveryLanguageEitherCatalogueHasAServerFor', () => {
    // #882: Rust, Go and Kotlin had servers but only diagnostics, because this list stopped at seven.
    // The suite runs from the repository root — as the plugin contract specs assume — and a bundled
    // coverage run gives `__dirname` no folder to resolve from.
    const repo: string = process.cwd();
    const builtIn: string = readFileSync(
      path.join(repo, 'src/shared/electron/lsp/language-server-catalogue.ts'),
      'utf8',
    );
    const curated: {
      plugins: { contributes?: { languageServers?: { languages: string[] }[] } }[];
    } = JSON.parse(
      readFileSync(
        path.join(repo, 'src/shared/electron/contributions/plugins/curated-plugins.json'),
        'utf8',
      ),
    ) as { plugins: { contributes?: { languageServers?: { languages: string[] }[] } }[] };
    const served: Set<string> = new Set<string>();
    for (const match of builtIn.matchAll(/languages: \[([^\]]*)\]/g)) {
      for (const language of match[1].matchAll(/'([^']+)'/g)) {
        served.add(language[1]);
      }
    }
    for (const plugin of curated.plugins) {
      for (const server of plugin.contributes?.languageServers ?? []) {
        server.languages.forEach((language: string): Set<string> => served.add(language));
      }
    }

    expect(served.size).toBeGreaterThan(10);
    expect(
      [...served].filter((language: string): boolean => !FEATURE_LANGUAGES.includes(language)),
    ).toEqual([]);
  });

  it('completion_forUnownedModel_returnsNoRequest', async () => {
    responses['textDocument/completion'] = { items: [{ label: 'x' }] };
    await build();
    const model: unknown = { uri: { toString: (): string => 'inmemory://model/other' } };
    const list: unknown = await captured.completion?.provideCompletionItems(model, {
      lineNumber: 1,
      column: 1,
    });

    expect(requests).toHaveLength(0);
    expect(list).toBeUndefined();
  });

  it('semanticTokens_remapsTheServerLegendOntoTheFixedLegend', async () => {
    // Server legend differs from the fixed one: keyword=15, class=2, method=13, static modifier=3.
    semanticLegend = {
      tokenTypes: ['class', 'method', 'field', 'keyword'],
      tokenModifiers: ['static'],
    };
    responses['textDocument/semanticTokens/full'] = {
      // keyword@0:0 len5, class@0:6 len6, method@1:4 len4 (static)
      data: [0, 0, 5, 3, 0, 0, 6, 6, 0, 0, 1, 4, 4, 1, 1],
    };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(model);

    expect(requests[0]?.method).toBe('textDocument/semanticTokens/full');
    expect([...(tokens?.data ?? [])]).toEqual([0, 0, 5, 15, 0, 0, 6, 6, 2, 0, 1, 4, 4, 13, 8]);
  });

  it('semanticTokens_coloursRoslynsCustomTypes_soARecordIsAType (#1137)', async () => {
    // Roslyn's legend names records, constants and extension methods with types the standard set
    // lacks; a record used to be dropped and painted in the plain text colour.
    semanticLegend = {
      tokenTypes: ['recordClass', 'constant', 'extensionMethod', 'recordStruct', 'punctuation'],
      tokenModifiers: [],
    };
    responses['textDocument/semanticTokens/full'] = {
      // recordClass@0:0 len6, constant@0:7 len5, extensionMethod@1:0 len3, recordStruct@1:4 len5,
      // punctuation@1:9 len1 (no standard equivalent: dropped, keeping the grammar colour)
      data: [0, 0, 6, 0, 0, 0, 7, 5, 1, 0, 1, 0, 3, 2, 0, 0, 4, 5, 3, 0, 0, 5, 1, 4, 0],
    };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(model);

    // Fixed legend: class=2, enumMember=10, method=13, struct=5.
    expect([...(tokens?.data ?? [])]).toEqual([
      0, 0, 6, 2, 0, 0, 7, 5, 10, 0, 1, 0, 3, 13, 0, 0, 4, 5, 5, 0,
    ]);
  });

  it('suppressesHeuristicTokens_forAModelAServerServes', async () => {
    semanticLegend = { tokenTypes: ['type'], tokenModifiers: [] };
    await build();

    expect(suppressWhen?.({ uri: { toString: (): string => MODEL_URI } })).toBe(true);
    expect(suppressWhen?.({ uri: { toString: (): string => 'inmemory://model/other' } })).toBe(
      false,
    );
  });

  it('doesNotSuppressHeuristicTokens_whenTheServerHasNoLegendYet', async () => {
    semanticLegend = null;
    await build();

    expect(suppressWhen?.({ uri: { toString: (): string => MODEL_URI } })).toBe(false);
  });

  it('semanticTokens_dropsUnmappableTypesAndRebasesDeltas', async () => {
    // 'bracket' has no standard colour and is dropped; the next token re-bases its delta over it.
    semanticLegend = { tokenTypes: ['class', 'bracket', 'method'], tokenModifiers: [] };
    responses['textDocument/semanticTokens/full'] = {
      // class@0:0 len6, bracket@0:6 len1 (dropped), method@1:0 len4
      data: [0, 0, 6, 0, 0, 0, 6, 1, 1, 0, 1, 0, 4, 2, 0],
    };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(model);

    // class -> type index 2; method -> 13, re-encoded from the class token (line 1, char 0).
    expect([...(tokens?.data ?? [])]).toEqual([0, 0, 6, 2, 0, 1, 0, 4, 13, 0]);
  });

  it('semanticTokens_withoutServerLegend_makesNoRequest', async () => {
    semanticLegend = null;
    responses['textDocument/semanticTokens/full'] = { data: [0, 0, 1, 0, 0] };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const tokens: unknown = await captured.semantic?.provideDocumentSemanticTokens(model);

    expect(requests).toHaveLength(0);
    expect(tokens).toBeUndefined();
  });

  it('semanticTokens_emptyServerResult_fallsBackToHeuristicTokens', async () => {
    // Roslyn advertises a legend at the handshake but serves an empty set until the solution loads;
    // the fallback must keep the heuristic colouring alive instead of letting Monaco clear it.
    semanticLegend = { tokenTypes: ['class'], tokenModifiers: [] };
    responses['textDocument/semanticTokens/full'] = { data: [] };
    await build();
    const model: unknown = fakeModel(MODEL_URI, 'csharp', 'Widget Run()');
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(model);

    // 'Widget' is PascalCase -> type (fixed index 1); 'Run(' -> function (fixed index 12).
    expect([...(tokens?.data ?? [])]).toEqual([0, 0, 6, 1, 0, 0, 7, 3, 12, 0]);
  });

  it('semanticTokens_serverRequestFailure_fallsBackToHeuristicTokens', async () => {
    semanticLegend = { tokenTypes: ['class'], tokenModifiers: [] };
    await build();
    responses['textDocument/semanticTokens/full'] = undefined;
    const failing: unknown = fakeModel(MODEL_URI, 'csharp', 'Widget Run()');
    // Make the bridge reject for this request.
    (window as unknown as { bridge: Bridge }).bridge.invoke = <T>(): Promise<T> =>
      Promise.reject(new Error('gone'));
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(failing);

    expect([...(tokens?.data ?? [])]).toEqual([0, 0, 6, 1, 0, 0, 7, 3, 12, 0]);
  });

  it('semanticTokens_emptyServerResult_forNonHeuristicLanguage_returnsUndefined', async () => {
    semanticLegend = { tokenTypes: ['class'], tokenModifiers: [] };
    responses['textDocument/semanticTokens/full'] = { data: [] };
    await build();
    const model: unknown = fakeModel(MODEL_URI, 'typescript', 'const x = 1;');
    const tokens: unknown = await captured.semantic?.provideDocumentSemanticTokens(model);

    expect(tokens).toBeUndefined();
  });

  it('servedListener_firesOnRealTokens_notOnEmptyOnes', async () => {
    semanticLegend = { tokenTypes: ['class'], tokenModifiers: [] };
    responses['textDocument/semanticTokens/full'] = { data: [] };
    const features: LspFeatures = await build();
    const served: string[] = [];
    features.registerServedListener((sessionId: string): void => {
      served.push(sessionId);
    });
    const model: unknown = fakeModel(MODEL_URI, 'csharp', 'Widget Run()');

    await captured.semantic?.provideDocumentSemanticTokens(model);
    expect(served).toHaveLength(0);

    responses['textDocument/semanticTokens/full'] = { data: [0, 0, 6, 0, 0] };
    await captured.semantic?.provideDocumentSemanticTokens(model);
    expect(served).toEqual(['/root::typescript']);
  });

  it('refreshSemanticTokens_scopedToALanguage_firesOnlyThatLanguagesEmitter', async () => {
    const features: LspFeatures = await build();
    features.refreshSemanticTokens(['csharp']);

    expect(captured.semanticEmitters.get('csharp')?.fired).toBe(1);
    expect(captured.semanticEmitters.get('typescript')?.fired).toBe(0);
    expect(captured.semanticEmitters.get('java')?.fired).toBe(0);

    features.refreshSemanticTokens();
    for (const emitter of captured.semanticEmitters.values()) {
      expect(emitter.fired).toBeGreaterThanOrEqual(1);
    }
  });

  it('semanticTokens_concurrentRequestsForOneModel_coalesceIntoASingleFetch', async () => {
    semanticLegend = { tokenTypes: ['class'], tokenModifiers: [] };
    let release: (value: unknown) => void = (): void => undefined;
    responses['textDocument/semanticTokens/full'] = new Promise<unknown>(
      (resolve: (value: unknown) => void): void => {
        release = resolve;
      },
    );
    await build();
    const model: unknown = fakeModel(MODEL_URI, 'csharp', 'Widget Run()');

    const first: Promise<{ data: Uint32Array } | undefined> | undefined =
      captured.semantic?.provideDocumentSemanticTokens(model);
    const second: Promise<{ data: Uint32Array } | undefined> | undefined =
      captured.semantic?.provideDocumentSemanticTokens(model);
    expect(requests).toHaveLength(1);

    release({ data: [0, 0, 6, 0, 0] });
    const [firstTokens, secondTokens] = await Promise.all([first, second]);
    expect([...(firstTokens?.data ?? [])]).toEqual([...(secondTokens?.data ?? [])]);
    expect(requests).toHaveLength(1);
  });
});
