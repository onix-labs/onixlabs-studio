import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { LspChannel, LspSemanticTokensLegend } from '@shared/api/lsp-channels';
import { FileChannel } from '@shared/api/file-channels';
import { Editors } from '@shared/angular/services/editors/editors';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import {
  FEATURE_LANGUAGES,
  LspFeatures,
  LspRenameAnswer,
  LspRenamePreparation,
  LspRenameSupport,
} from './lsp-features';
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
  completion?: { provideCompletionItems(model: unknown, position: unknown): Promise<unknown> };
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
    },
    languages: {
      CompletionItemKind: { Method: 0, Function: 1, Text: 18 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: (_language: string, provider: unknown): void => {
        captured.completion = provider as CapturedProviders['completion'];
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
  let openModels: unknown[];
  let files: Record<string, string>;
  let reads: string[];
  let renameSupport: LspRenameSupport | undefined;

  beforeEach(() => {
    captured.completion = undefined;
    captured.hover = undefined;
    captured.symbols = undefined;
    captured.semantic = undefined;
    captured.semanticEmitters = new Map<string, FakeEmitter>();
    requests = [];
    responses = {};
    semanticLegend = null;
    suppressWhen = undefined;
    openModels = [];
    files = {};
    reads = [];
    renameSupport = undefined;
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
          }
        : null,
    );
    await flush();
    return features;
  }

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
