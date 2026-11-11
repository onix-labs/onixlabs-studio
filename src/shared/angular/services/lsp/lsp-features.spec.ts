import type * as MonacoApi from 'monaco-editor';
import { TestBed } from '@angular/core/testing';
import { Settings } from '@shared/angular/services/settings/settings';
import { Bridge } from '@shared/api/bridge';
import {
  LspChannel,
  LspSemanticTokensLegend,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
} from '@shared/api/lsp-channels';
import { FileChannel } from '@shared/api/file-channels';
import { Editors } from '@shared/angular/services/editors/editors';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { BuildHandler, Builds } from '@shared/angular/services/tasks/builds';
import { signal, WritableSignal } from '@angular/core';
import { DebugHandler, Debugger, DebugState } from '@shared/angular/services/debug/debugger';
import type { LspDiagnostic } from './lsp-client';
import {
  escapeMarkdown,
  FEATURE_LANGUAGES,
  hoverContents,
  LspCodeAction,
  LspCodeActionSupport,
  LspDefinition,
  LspFeatures,
  LspFormattingSupport,
  LspCodeLensSupport,
  LspInlayHintSupport,
  LspStructureSupport,
  LspNavigationSupport,
  LspRenameAnswer,
  LspRenamePreparation,
  LspRenameSupport,
  STUDIO_LSP_COMMAND,
  opensBlockAt,
} from './lsp-features';
import type { HierarchyNode, HierarchySource } from '@shared/angular/services/hierarchy/hierarchy';
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
  /** The formatting providers registered, keyed `<language>:<document|range|onType>` (#1141). */
  formatting?: Map<string, FakeFormattingProvider>;
  /** The code lens providers registered, keyed by language (#1149). */
  codeLens?: Map<string, FakeCodeLensProvider>;
  /** The structure providers registered, keyed `<language>:<folding|highlights|rangeTokens>` (#1147). */
  structure?: Map<string, FakeStructureProvider>;
  /** The inlay-hint providers registered, keyed by language (#1145). */
  inlayHints?: Map<string, FakeInlayHintsProvider>;
}

/**
 * A code lens provider as the specs call it (#1149).
 */
interface FakeCodeLensProvider {
  onDidChange?: unknown;
  provideCodeLenses(model: unknown): Promise<{ lenses: unknown[] } | undefined>;
  resolveCodeLens(model: unknown, lens: unknown): Promise<unknown>;
}

/**
 * A folding, highlight or range-token provider as the specs call it (#1147).
 */
interface FakeStructureProvider {
  provideLinkedEditingRanges?: (
    model: unknown,
    position: unknown,
  ) => Promise<{ ranges: unknown[]; wordPattern?: RegExp } | undefined>;
  provideFoldingRanges?(model: unknown): Promise<unknown>;
  provideDocumentHighlights?(model: unknown, position: unknown): Promise<unknown>;
  provideSelectionRanges?(model: unknown, positions: unknown[]): Promise<unknown>;
  provideDocumentRangeSemanticTokens?(
    model: unknown,
    range: unknown,
  ): Promise<{ data: Uint32Array } | null>;
  provideDocumentColors?(model: unknown): Promise<unknown>;
  provideColorPresentations?(model: unknown, color: unknown): Promise<unknown>;
}

/**
 * An inlay-hint provider as the specs call it (#1145).
 */
interface FakeInlayHintsProvider {
  onDidChangeInlayHints?: unknown;
  provideInlayHints(model: unknown, range: unknown): Promise<{ hints: unknown[] } | undefined>;
  resolveInlayHint(hint: unknown): Promise<unknown>;
}

/**
 * A formatting provider as the specs call it: whichever of Monaco's three shapes it was registered as.
 */
interface FakeFormattingProvider {
  autoFormatTriggerCharacters?: string[];
  provideDocumentFormattingEdits?(model: unknown, options: unknown): Promise<unknown>;
  provideDocumentRangeFormattingEdits?(
    model: unknown,
    range: unknown,
    options: unknown,
  ): Promise<unknown>;
  provideOnTypeFormattingEdits?(
    model: unknown,
    position: unknown,
    ch: string,
    options: unknown,
  ): Promise<unknown>;
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
      registerInlayHintsProvider: (language: string, provider: unknown): void => {
        (captured.inlayHints ??= new Map()).set(language, provider);
      },
      FoldingRangeKind: { Comment: 'comment', Imports: 'imports', Region: 'region' },
      DocumentHighlightKind: { Text: 0, Read: 1, Write: 2 },
      registerCodeLensProvider: (language: string, provider: unknown): void => {
        (captured.codeLens ??= new Map()).set(language, provider);
      },
      registerFoldingRangeProvider: (language: string, provider: unknown): void => {
        (captured.structure ??= new Map()).set(`${language}:folding`, provider);
      },
      registerDocumentHighlightProvider: (language: string, provider: unknown): void => {
        (captured.structure ??= new Map()).set(`${language}:highlights`, provider);
      },
      registerLinkedEditingRangeProvider: (language: string, provider: unknown): void => {
        (captured.structure ??= new Map()).set(`${language}:linkedEditing`, provider);
      },
      registerDocumentRangeSemanticTokensProvider: (language: string, provider: unknown): void => {
        (captured.structure ??= new Map()).set(`${language}:rangeTokens`, provider);
      },
      registerSelectionRangeProvider: (language: string, provider: unknown): void => {
        (captured.structure ??= new Map()).set(`${language}:selectionRanges`, provider);
      },
      registerColorProvider: (language: string, provider: unknown): void => {
        (captured.structure ??= new Map()).set(`${language}:colors`, provider);
      },
      registerDocumentFormattingEditProvider: (language: string, provider: unknown): unknown =>
        captureFormatter(captured, `${language}:document`, provider),
      registerDocumentRangeFormattingEditProvider: (language: string, provider: unknown): unknown =>
        captureFormatter(captured, `${language}:range`, provider),
      registerOnTypeFormattingEditProvider: (language: string, provider: unknown): unknown =>
        captureFormatter(captured, `${language}:onType`, provider),
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
 * Captures a formatter as Monaco would register it: until its registration is disposed.
 * @param captured Receives the formatter.
 * @param key The formatter's key.
 * @param provider The formatter.
 * @returns Returns the registration.
 */
function captureFormatter(
  captured: CapturedProviders,
  key: string,
  provider: unknown,
): MonacoApi.IDisposable {
  (captured.formatting ??= new Map()).set(key, provider);
  return { dispose: (): void => void captured.formatting?.delete(key) };
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
  let braceFoldingSuppressedWhen: ((model: unknown) => boolean) | undefined;
  let structureSupport: LspStructureSupport | undefined;
  let autoInsertHandler: ((editor: unknown, ch: string) => void) | undefined;
  let autoInsertTriggers: readonly string[] | undefined;
  let codeLensSupport: LspCodeLensSupport | undefined;
  let testsRun: unknown[] | undefined;
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
  let formattingSupport: LspFormattingSupport | undefined;
  let navigationSupport: LspNavigationSupport | undefined;
  let inlayHintSupport: LspInlayHintSupport | undefined;

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
    formattingSupport = undefined;
    navigationSupport = undefined;
    inlayHintSupport = undefined;
    structureSupport = undefined;
    autoInsertTriggers = undefined;
    codeLensSupport = undefined;
    testsRun = undefined;
    captured.codeLens = undefined;
    captured.structure = undefined;
    captured.inlayHints = undefined;
    captured.formatting = undefined;
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

  let semanticHighlightingOn: boolean = true;

  /**
   * Builds the service with a fake Monaco namespace and a single document resolver, then waits for
   * provider registration.
   * @returns Returns the built service once its providers are registered.
   */
  async function build(): Promise<LspFeatures> {
    const monaco: unknown = {
      ensureLoaded: (): Promise<void> => Promise.resolve(),
      getMonaco: (): unknown => fakeMonacoNamespace(captured, openModels),
      semanticHighlightingEnabled: (): boolean => semanticHighlightingOn,
      suppressHeuristicTokensWhen: (predicate: (model: unknown) => boolean): (() => void) => {
        suppressWhen = predicate;
        return (): void => undefined;
      },
      suppressWordSuggestionsWhen: (predicate: (model: unknown) => boolean): (() => void) => {
        wordsSuppressedWhen = predicate;
        return (): void => undefined;
      },
      suppressBraceFoldingWhen: (predicate: (model: unknown) => boolean): (() => void) => {
        braceFoldingSuppressedWhen = predicate;
        return (): void => undefined;
      },
      useAutoInsert: (handler: (editor: unknown, ch: string) => void): void => {
        autoInsertHandler = handler;
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
            ...(formattingSupport === undefined ? {} : { formatting: formattingSupport }),
            ...(navigationSupport === undefined ? {} : { navigation: navigationSupport }),
            ...(inlayHintSupport === undefined ? {} : { inlayHints: inlayHintSupport }),
            ...(structureSupport === undefined ? {} : { structure: structureSupport }),
            ...(autoInsertTriggers === undefined ? {} : { autoInsertTriggers }),
            ...(codeLensSupport === undefined ? {} : { codeLens: codeLensSupport }),
            ...(testsRun === undefined
              ? {}
              : { runTests: (lens: unknown): void => void testsRun?.push(lens) }),
          }
        : null,
    );
    await flush();
    return features;
  }

  describe('formatting (#1141)', () => {
    const ROSLYN: LspFormattingSupport = {
      document: true,
      range: true,
      onTypeTriggers: ['}', ';', '\n'],
    };
    const OPTIONS: unknown = { tabSize: 4, insertSpaces: true };

    it('registersEachFormatterOncePerLanguage_withTheServersTriggerCharacters', async () => {
      const features: LspFeatures = await build();
      features.enableFormatting('csharp', ROSLYN);
      features.enableFormatting('csharp', ROSLYN);

      expect([...(captured.formatting?.keys() ?? [])]).toEqual([
        'csharp:document',
        'csharp:range',
        'csharp:onType',
      ]);
      expect(captured.formatting?.get('csharp:onType')?.autoFormatTriggerCharacters).toEqual([
        '}',
        ';',
        '\n',
      ]);
    });

    it('registersOnlyWhatTheServerOffers', async () => {
      const features: LspFeatures = await build();
      features.enableFormatting('python', { document: true, range: false, onTypeTriggers: [] });

      expect([...(captured.formatting?.keys() ?? [])]).toEqual(['python:document']);
    });

    it('defaultFormatter_keepsTheServersFormatterOutOfALanguageWhileBuiltInIsChosen', async () => {
      const features: LspFeatures = await build();
      TestBed.inject(Settings).setLanguageOverride('typescript', 'defaultFormatter', 'built-in');

      features.enableFormatting('typescript', ROSLYN);

      expect(captured.formatting?.size ?? 0).toBe(0);
    });

    it('defaultFormatter_addsAndWithdrawsTheServersFormatterAsTheSettingChanges', async () => {
      const features: LspFeatures = await build();
      const settings: Settings = TestBed.inject(Settings);
      features.enableFormatting('typescript', ROSLYN);
      expect(captured.formatting?.has('typescript:document')).toBe(true);

      settings.setLanguageOverride('typescript', 'defaultFormatter', 'built-in');
      TestBed.tick();
      expect(captured.formatting?.has('typescript:document')).toBe(false);

      settings.clearLanguageOverride('typescript', 'defaultFormatter');
      TestBed.tick();
      expect(captured.formatting?.has('typescript:document')).toBe(true);
    });

    it('formatDocument_asksTheServerWithTheEditorsIndentation_andMapsItsEdits', async () => {
      formattingSupport = ROSLYN;
      responses['textDocument/formatting'] = [
        {
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 8 } },
          newText: '    ',
        },
      ];
      const features: LspFeatures = await build();
      features.enableFormatting('csharp', ROSLYN);

      const edits: unknown = await captured.formatting
        ?.get('csharp:document')
        ?.provideDocumentFormattingEdits?.(fakeModel(MODEL_URI, 'csharp'), OPTIONS);

      expect(requests).toEqual([
        {
          sessionId: '/root::typescript',
          method: 'textDocument/formatting',
          params: { textDocument: { uri: 'file:///root/app.ts' }, options: OPTIONS },
        },
      ]);
      expect(edits).toEqual([
        {
          range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 9 },
          text: '    ',
        },
      ]);
    });

    it('formatOnType_bringsTheServerUpToDate_thenSendsThePositionAndCharacter', async () => {
      formattingSupport = ROSLYN;
      const order: string[] = [];
      syncHook = (): Promise<void> => {
        order.push('sync');
        return Promise.resolve();
      };
      responses['textDocument/onTypeFormatting'] = [];
      const features: LspFeatures = await build();
      features.enableFormatting('csharp', ROSLYN);

      await captured.formatting
        ?.get('csharp:onType')
        ?.provideOnTypeFormattingEdits?.(
          fakeModel(MODEL_URI, 'csharp'),
          { lineNumber: 5, column: 2 },
          '}',
          OPTIONS,
        );
      order.push(requests[0]?.method ?? 'none');

      expect(order).toEqual(['sync', 'textDocument/onTypeFormatting']);
      expect(requests[0]?.params).toEqual({
        textDocument: { uri: 'file:///root/app.ts' },
        options: OPTIONS,
        position: { line: 4, character: 1 },
        ch: '}',
      });
    });

    it('asksNothing_whenTheServingServerDoesNotFormatThatWay', async () => {
      formattingSupport = { document: true, range: false, onTypeTriggers: [] };
      const features: LspFeatures = await build();
      features.enableFormatting('csharp', ROSLYN);

      const onType: unknown = await captured.formatting
        ?.get('csharp:onType')
        ?.provideOnTypeFormattingEdits?.(
          fakeModel(MODEL_URI, 'csharp'),
          { lineNumber: 1, column: 1 },
          '}',
          OPTIONS,
        );
      const range: unknown = await captured.formatting
        ?.get('csharp:range')
        ?.provideDocumentRangeFormattingEdits?.(fakeModel(MODEL_URI, 'csharp'), {}, OPTIONS);

      expect(onType).toBeUndefined();
      expect(range).toBeUndefined();
      expect(requests).toEqual([]);
    });

    describe('Enter inside a just-opened block (#1177)', () => {
      // Enter between Monaco's auto-closed braces, the caret on the middle line.
      const BLOCK: readonly string[] = [
        'public class Wave',
        '{',
        '    public void Hello() {',
        '        ',
        '    }',
        '}',
      ];
      const CARET: { lineNumber: number; column: number } = { lineNumber: 4, column: 9 };

      /**
       * Builds a model over lines, as the brace placement reads it.
       * @param lines The lines.
       * @returns Returns the model.
       */
      function blockModel(lines: readonly string[]): unknown {
        return {
          ...(fakeModel(MODEL_URI, 'csharp', lines.join('\n')) as object),
          getLineCount: (): number => lines.length,
          getLineContent: (line: number): string => lines[line - 1] ?? '',
          getLineMaxColumn: (line: number): number => (lines[line - 1] ?? '').length + 1,
        };
      }

      /**
       * Presses Enter in a model, as Monaco asks the on-type formatter.
       * @param lines The lines after the newline.
       * @returns Returns the edits.
       */
      async function enter(lines: readonly string[]): Promise<unknown> {
        const features: LspFeatures = await build();
        features.enableFormatting('csharp', ROSLYN);
        return captured.formatting
          ?.get('csharp:onType')
          ?.provideOnTypeFormattingEdits?.(blockModel(lines), CARET, '\n', OPTIONS);
      }

      it('formatsTheBlock_andKeepsOnlyTheEditsOnTheBracesLineAndAbove', async () => {
        formattingSupport = ROSLYN;
        responses['textDocument/onTypeFormatting'] = [];
        // Roslyn's answer for Allman: the brace onto its own line, and the blank line collapsed.
        responses['textDocument/rangeFormatting'] = [
          {
            range: { start: { line: 2, character: 23 }, end: { line: 2, character: 24 } },
            newText: '\n    ',
          },
          {
            range: { start: { line: 3, character: 0 }, end: { line: 4, character: 4 } },
            newText: '    ',
          },
        ];

        const edits: unknown = await enter(BLOCK);

        expect(requests.map((request: { method: string }): string => request.method)).toEqual([
          'textDocument/onTypeFormatting',
          'textDocument/rangeFormatting',
        ]);
        expect(requests[1]?.params).toEqual({
          textDocument: { uri: 'file:///root/app.ts' },
          options: OPTIONS,
          range: { start: { line: 2, character: 0 }, end: { line: 4, character: 5 } },
        });
        expect(edits).toEqual([
          {
            range: { startLineNumber: 3, startColumn: 24, endLineNumber: 3, endColumn: 25 },
            text: '\n    ',
          },
        ]);
      });

      it('leavesTheServersOwnNewlineEditsAlone_askingNothingMore', async () => {
        formattingSupport = ROSLYN;
        responses['textDocument/onTypeFormatting'] = [
          {
            range: { start: { line: 3, character: 0 }, end: { line: 3, character: 8 } },
            newText: '        ',
          },
        ];

        const edits: unknown = await enter(BLOCK);

        expect(requests.map((request: { method: string }): string => request.method)).toEqual([
          'textDocument/onTypeFormatting',
        ]);
        expect(edits).toHaveLength(1);
      });

      it('outsideAJustOpenedBlock_asksNothingMore', async () => {
        formattingSupport = ROSLYN;
        responses['textDocument/onTypeFormatting'] = [];

        const edits: unknown = await enter([
          'public class Wave',
          '{',
          '    var x = 1;',
          '        ',
          '    }',
          '}',
        ]);

        expect(requests).toHaveLength(1);
        expect(edits).toEqual([]);
      });
    });
  });

  it('opensBlockAt_isTheBlankLineBetweenAnOpeningAndAClosingBrace (#1177)', () => {
    const model: (lines: readonly string[]) => MonacoApi.editor.ITextModel = (
      lines: readonly string[],
    ): MonacoApi.editor.ITextModel =>
      ({
        getLineCount: (): number => lines.length,
        getLineContent: (line: number): string => lines[line - 1] ?? '',
      }) as unknown as MonacoApi.editor.ITextModel;

    expect(opensBlockAt(model(['void F() {', '    ', '}']), 2)).toBe(true);
    expect(opensBlockAt(model(['void F() {', '', '  } // end']), 2)).toBe(true);
    expect(opensBlockAt(model(['void F() {', '    x', '}']), 2)).toBe(false);
    expect(opensBlockAt(model(['void F()', '    ', '}']), 2)).toBe(false);
    expect(opensBlockAt(model(['void F() {', '    ']), 2)).toBe(false);
    expect(opensBlockAt(model(['    ', '}']), 1)).toBe(false);
  });

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

  describe('code lenses (#1149)', () => {
    const owned: unknown = {
      uri: { toString: (): string => MODEL_URI },
      getValue: (): string => '',
      getLanguageId: (): string => 'csharp',
    };
    const LENS: unknown = {
      range: { start: { line: 8, character: 11 }, end: { line: 8, character: 16 } },
      data: { ListIndex: 2 },
    };

    describe('switched by kind (#1215)', () => {
      it('lensesSwitchedOffForTheLanguage_areNotAskedFor', async () => {
        codeLensSupport = { resolve: true };
        responses['textDocument/codeLens'] = [LENS];
        const features: LspFeatures = await build();
        TestBed.inject(Settings).setLanguageOverride('csharp', 'codeLens', false);
        features.enableCodeLens('csharp');

        const list: { lenses: unknown[] } | undefined = await captured.codeLens
          ?.get('csharp')
          ?.provideCodeLenses(owned);

        expect(list).toBeUndefined();
        expect(requests.map((request: { method: string }): string => request.method)).not.toContain(
          'textDocument/codeLens',
        );
      });

      it('aKindSwitchedOff_isLeftOut_andTheRestShown', async () => {
        codeLensSupport = { resolve: false };
        responses['textDocument/codeLens'] = [
          {
            ...(LENS as object),
            command: { title: 'Run Test', command: 'dotnet.test.run', arguments: [{}] },
          },
          {
            ...(LENS as object),
            command: { title: '3 references', command: 'roslyn.client.peekReferences' },
          },
        ];
        const features: LspFeatures = await build();
        TestBed.inject(Settings).updateTextEditorSettings({ codeLensTests: false });
        features.enableCodeLens('csharp');

        const list: { lenses: { command?: { title: string } }[] } | undefined =
          (await captured.codeLens?.get('csharp')?.provideCodeLenses(owned)) as
            { lenses: { command?: { title: string } }[] } | undefined;

        expect(list?.lenses.map((lens): string | undefined => lens.command?.title)).toEqual([
          '3 references',
        ]);
      });

      it('aLensFilledInAsAKindSwitchedOff_showsNothing', async () => {
        codeLensSupport = { resolve: true };
        responses['textDocument/codeLens'] = [LENS];
        responses['codeLens/resolve'] = {
          ...(LENS as object),
          command: { title: '3 references', command: 'roslyn.client.peekReferences' },
        };
        const features: LspFeatures = await build();
        TestBed.inject(Settings).updateTextEditorSettings({ codeLensReferences: false });
        features.enableCodeLens('csharp');
        const provider: FakeCodeLensProvider | undefined = captured.codeLens?.get('csharp');
        const list: { lenses: unknown[] } | undefined = await provider?.provideCodeLenses(owned);

        const resolved: unknown = await provider?.resolveCodeLens(owned, list?.lenses[0]);

        expect((resolved as { command: unknown }).command).toEqual({ id: '', title: '' });
      });

      it('aReferenceCountWithNoCommand_listsTheReferencesWhereItSits', async () => {
        // lua-language-server's and Svelte's counts come with an empty command.
        codeLensSupport = { resolve: false };
        responses['textDocument/codeLens'] = [
          { ...(LENS as object), command: { title: '2 references', command: '' } },
        ];
        const features: LspFeatures = await build();
        features.enableCodeLens('csharp');

        const list: { lenses: { command?: { id: string; arguments?: unknown[] } }[] } | undefined =
          (await captured.codeLens?.get('csharp')?.provideCodeLenses(owned)) as
            { lenses: { command?: { id: string; arguments?: unknown[] } }[] } | undefined;

        expect(list?.lenses[0]?.command).toEqual({
          id: 'studio.lsp.codeLensReferences',
          title: '2 references',
          arguments: [expect.any(String), { line: 8, character: 11 }],
        });
      });

      it('aChangedSwitch_hasEveryEditorAskAgain', async () => {
        const features: LspFeatures = await build();
        features.enableCodeLens('csharp');
        const emitter: FakeEmitter | undefined = (
          features as unknown as { codeLensChanged?: FakeEmitter }
        ).codeLensChanged;
        const before: number = emitter?.fired ?? 0;

        TestBed.inject(Settings).setLanguageOverride('go', 'codeLensOther', false);
        TestBed.tick();

        expect(emitter?.fired).toBe(before + 1);
      });
    });

    it('areRegisteredOncePerLanguage_andARefreshAsksEachAgain', async () => {
      const features: LspFeatures = await build();
      features.enableCodeLens('csharp');
      features.enableCodeLens('csharp');
      features.enableCodeLens('fsharp');

      features.refreshCodeLenses();

      expect([...(captured.codeLens?.keys() ?? [])]).toEqual(['csharp', 'fsharp']);
      const emitter: FakeEmitter | undefined = (
        features as unknown as { codeLensChanged?: FakeEmitter }
      ).codeLensChanged;
      expect(emitter?.fired).toBe(2);
    });

    it.each<[string, string]>([
      ['2 references', 'references'],
      ['1 implementation', 'implementations'],
    ])('resolved_%s_listsThePlacesItBrought_as %s (#1207)', async (title: string, kind: string) => {
      codeLensSupport = { resolve: true };
      const place: unknown = {
        uri: 'file:///root/other.ts',
        range: { start: { line: 4, character: 2 }, end: { line: 4, character: 7 } },
      };
      responses['textDocument/codeLens'] = [LENS];
      responses['codeLens/resolve'] = {
        ...(LENS as object),
        command: {
          title,
          command: 'editor.action.showReferences',
          arguments: ['file:///root/app.ts', { line: 8, character: 11 }, [place, null, { uri: 7 }]],
        },
      };
      const features: LspFeatures = await build();
      features.enableCodeLens('csharp');
      const provider: FakeCodeLensProvider | undefined = captured.codeLens?.get('csharp');
      const list: { lenses: unknown[] } | undefined = await provider?.provideCodeLenses(owned);

      const resolved: unknown = await provider?.resolveCodeLens(owned, list?.lenses[0]);

      expect((resolved as { command: unknown }).command).toEqual({
        id: 'studio.lsp.codeLensLocations',
        title,
        arguments: [
          expect.any(String),
          { line: 8, character: 11 },
          kind,
          [
            {
              path: '/root/other.ts',
              range: { startLineNumber: 5, startColumn: 3, endLineNumber: 5, endColumn: 8 },
            },
          ],
        ],
      });
    });

    it.each(['1 implementation', '3 references'])(
      'aRustAnalyzerLens_%s_listsThePlacesItBrought (#1210)',
      async (title: string) => {
        codeLensSupport = { resolve: true };
        responses['textDocument/codeLens'] = [LENS];
        responses['codeLens/resolve'] = {
          ...(LENS as object),
          command: {
            title,
            command: 'rust-analyzer.showReferences',
            arguments: ['file:///root/app.ts', { line: 8, character: 11 }, []],
          },
        };
        const features: LspFeatures = await build();
        features.enableCodeLens('rust');
        const provider: FakeCodeLensProvider | undefined = captured.codeLens?.get('rust');
        const list: { lenses: unknown[] } | undefined = await provider?.provideCodeLenses(owned);

        const resolved: unknown = await provider?.resolveCodeLens(owned, list?.lenses[0]);

        expect((resolved as { command: { id: string } }).command.id).toBe(
          'studio.lsp.codeLensLocations',
        );
      },
    );

    it.each<[string, string, string]>([
      ['java.show.references', '2 references', 'references'],
      ['java.show.implementations', '1 implementation', 'implementations'],
      // jdtls names the kind in its command, so a count it words differently is still listed right.
      ['java.show.implementations', '0 subtypes', 'implementations'],
    ])(
      'aJdtlsLens_%s_%s_listsThePlacesItBrought_as %s (#1208)',
      async (name: string, title: string, kind: string) => {
        codeLensSupport = { resolve: true };
        const place: unknown = {
          uri: 'file:///root/App.java',
          range: { start: { line: 9, character: 4 }, end: { line: 9, character: 10 } },
        };
        responses['textDocument/codeLens'] = [LENS];
        responses['codeLens/resolve'] = {
          ...(LENS as object),
          command: {
            title,
            command: name,
            arguments: ['file:///root/Shapes.java', { line: 5, character: 10 }, [place]],
          },
        };
        const features: LspFeatures = await build();
        features.enableCodeLens('java');
        const provider: FakeCodeLensProvider | undefined = captured.codeLens?.get('java');
        const list: { lenses: unknown[] } | undefined = await provider?.provideCodeLenses(owned);

        const resolved: unknown = await provider?.resolveCodeLens(owned, list?.lenses[0]);

        expect((resolved as { command: unknown }).command).toEqual({
          id: 'studio.lsp.codeLensLocations',
          title,
          arguments: [
            expect.any(String),
            { line: 5, character: 10 },
            kind,
            [
              {
                path: '/root/App.java',
                range: { startLineNumber: 10, startColumn: 5, endLineNumber: 10, endColumn: 11 },
              },
            ],
          ],
        });
      },
    );

    it('aRustAnalyzerRunLens_runsAsARunConfigurationDoes (#1210)', async () => {
      const runnable: unknown = {
        label: 'test-mod tests',
        kind: 'cargo',
        args: { cwd: '/root', cargoArgs: ['test'], executableArgs: ['tests'] },
      };
      codeLensSupport = { resolve: true };
      responses['textDocument/codeLens'] = [
        {
          ...(LENS as object),
          command: {
            title: '▶︎ Run Tests',
            command: 'rust-analyzer.runSingle',
            arguments: [runnable],
          },
        },
      ];
      const features: LspFeatures = await build();
      const run: ReturnType<typeof vi.fn> = vi.fn();
      TestBed.inject(Builds).register({ runConfiguration: run } as unknown as BuildHandler);
      features.enableCodeLens('rust');
      const provider: FakeCodeLensProvider | undefined = captured.codeLens?.get('rust');
      const list: { lenses: { command: { id: string; arguments: unknown[] } }[] } | undefined =
        (await provider?.provideCodeLenses(owned)) as unknown as
          { lenses: { command: { id: string; arguments: unknown[] } }[] } | undefined;

      const command: { id: string; arguments: unknown[] } | undefined = list?.lenses[0].command;
      expect(command?.id).toBe('studio.lsp.runLens');

      captured.commands?.get('studio.lsp.runLens')?.(undefined, ...(command?.arguments ?? []));

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ program: 'cargo', args: ['test', '--', 'tests'], cwd: '/root' }),
        [],
        { restart: true },
      );
    });

    it('aRustAnalyzerDebugLens_launchesTheSameRunnable_underTheDebugger (#1210)', async () => {
      const runnable: unknown = {
        label: 'test tests::rectangle_area',
        kind: 'cargo',
        args: {
          cwd: '/root',
          cargoArgs: ['test', '--package', 'shapes', '--lib'],
          executableArgs: ['tests::rectangle_area', '--exact'],
        },
      };
      codeLensSupport = { resolve: true };
      responses['textDocument/codeLens'] = [
        {
          ...(LENS as object),
          command: {
            title: '⚙︎ Debug',
            command: 'rust-analyzer.debugSingle',
            arguments: [runnable],
          },
        },
      ];
      const features: LspFeatures = await build();
      const state: WritableSignal<DebugState> = signal<DebugState>('idle');
      const launch: ReturnType<typeof vi.fn> = vi.fn();
      TestBed.inject(Debugger).register({ state, launch } as unknown as DebugHandler);
      features.enableCodeLens('rust');
      const provider: FakeCodeLensProvider | undefined = captured.codeLens?.get('rust');
      const list: { lenses: { command: { id: string; arguments: unknown[] } }[] } | undefined =
        (await provider?.provideCodeLenses(owned)) as unknown as
          { lenses: { command: { id: string; arguments: unknown[] } }[] } | undefined;
      const command: { id: string; arguments: unknown[] } | undefined = list?.lenses[0].command;
      expect(command?.id).toBe('studio.lsp.debugLens');

      captured.commands?.get('studio.lsp.debugLens')?.(undefined, ...(command?.arguments ?? []));

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'debug',
          providerKind: 'rust',
          program: 'cargo',
          args: ['test', '--package', 'shapes', '--lib', '--', 'tests::rectangle_area', '--exact'],
          cwd: '/root',
        }),
      );

      // One session at a time: pressed while one runs, it starts nothing.
      launch.mockClear();
      state.set('running');
      captured.commands?.get('studio.lsp.debugLens')?.(undefined, ...(command?.arguments ?? []));
      expect(launch).not.toHaveBeenCalled();
    });

    it('aRustAnalyzerRunLens_thatCannotBeRead_showsItsTitleAlone (#1210)', async () => {
      codeLensSupport = { resolve: true };
      responses['textDocument/codeLens'] = [
        {
          ...(LENS as object),
          command: { title: '▶︎ Run', command: 'rust-analyzer.runSingle', arguments: [{}] },
        },
      ];
      const features: LspFeatures = await build();
      features.enableCodeLens('rust');
      const provider: FakeCodeLensProvider | undefined = captured.codeLens?.get('rust');
      const list: { lenses: { command: unknown }[] } | undefined =
        (await provider?.provideCodeLenses(owned)) as unknown as
          { lenses: { command: unknown }[] } | undefined;

      expect(list?.lenses[0].command).toEqual({ id: '', title: '▶︎ Run' });
    });

    it('resolved_withNoCommandName_showsItsCountAlone (#1207)', async () => {
      codeLensSupport = { resolve: true };
      responses['textDocument/codeLens'] = [LENS];
      responses['codeLens/resolve'] = {
        ...(LENS as object),
        command: { title: '0 references', command: '', arguments: [] },
      };
      const features: LspFeatures = await build();
      features.enableCodeLens('csharp');
      const provider: FakeCodeLensProvider | undefined = captured.codeLens?.get('csharp');
      const list: { lenses: unknown[] } | undefined = await provider?.provideCodeLenses(owned);

      const resolved: unknown = await provider?.resolveCodeLens(owned, list?.lenses[0]);

      expect((resolved as { command: unknown }).command).toEqual({ id: '', title: '0 references' });
    });

    it('areAskedFor_andFilledInAsShown_aReferencesLensListingItsSymbolsReferences', async () => {
      codeLensSupport = { resolve: true };
      responses['textDocument/codeLens'] = [LENS, { data: 'no range' }];
      responses['codeLens/resolve'] = {
        ...(LENS as object),
        command: {
          title: '3 references',
          command: 'roslyn.client.peekReferences',
          arguments: ['file:///root/app.ts', { line: 8, character: 11 }],
        },
      };
      const features: LspFeatures = await build();
      features.enableCodeLens('csharp');
      const provider: FakeCodeLensProvider | undefined = captured.codeLens?.get('csharp');

      const list: { lenses: unknown[] } | undefined = await provider?.provideCodeLenses(owned);
      expect(list?.lenses).toEqual([
        { range: { startLineNumber: 9, startColumn: 12, endLineNumber: 9, endColumn: 17 } },
      ]);
      const resolved: unknown = await provider?.resolveCodeLens(owned, list?.lenses[0]);

      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'codeLens/resolve',
        params: LENS,
      });
      expect(resolved).toEqual({
        range: { startLineNumber: 9, startColumn: 12, endLineNumber: 9, endColumn: 17 },
        command: {
          id: 'studio.lsp.codeLensReferences',
          title: '3 references',
          arguments: [MODEL_URI, { line: 8, character: 11 }],
        },
      });
    });

    it('aCommandTheServerRuns_isRunThere_andAnyOtherShowsItsTitleAlone', async () => {
      codeLensSupport = { resolve: false };
      serverCommands = ['dotnet.restore.project'];
      responses['textDocument/codeLens'] = [
        { ...(LENS as object), command: { title: 'Restore', command: 'dotnet.restore.project' } },
        { ...(LENS as object), command: { title: 'Debug test', command: 'unknown.debug' } },
      ];
      const features: LspFeatures = await build();
      features.enableCodeLens('csharp');

      const list: { lenses: unknown[] } | undefined = await captured.codeLens
        ?.get('csharp')
        ?.provideCodeLenses(owned);

      expect(
        (list?.lenses as { command?: { id: string; title: string } }[]).map(
          (lens: { command?: { id: string; title: string } }): unknown => lens.command,
        ),
      ).toEqual([
        {
          id: 'studio.lsp.executeCommand',
          title: 'Restore',
          arguments: ['/root::typescript', { title: 'Restore', command: 'dotnet.restore.project' }],
        },
        { id: '', title: 'Debug test' },
      ]);
    });

    it('aRunOrDebugTestLens_runsItsTestsOnTheDocumentsSession (#1150)', async () => {
      codeLensSupport = { resolve: true };
      testsRun = [];
      const runArgument: unknown = {
        textDocument: { uri: 'file:///root/app.ts' },
        range: { start: { line: 8, character: 16 }, end: { line: 8, character: 35 } },
        attachDebugger: false,
        runSettingsPath: null,
      };
      responses['textDocument/codeLens'] = [
        {
          ...(LENS as object),
          command: { title: 'Run Test', command: 'dotnet.test.run', arguments: [runArgument] },
        },
        {
          ...(LENS as object),
          command: {
            title: 'Debug Test',
            command: 'dotnet.test.run',
            arguments: [{ ...(runArgument as object), attachDebugger: true }],
          },
        },
      ];
      const model: unknown = { ...(owned as object), uri: { toString: (): string => MODEL_URI } };
      openModels.push(model);
      const features: LspFeatures = await build();
      features.enableCodeLens('csharp');

      const list: { lenses: unknown[] } | undefined = await captured.codeLens
        ?.get('csharp')
        ?.provideCodeLenses(model);
      const lenses: { command?: { id: string; title: string; arguments?: unknown[] } }[] =
        list?.lenses as { command?: { id: string; title: string; arguments?: unknown[] } }[];

      expect(lenses.map((lens) => lens.command?.title)).toEqual(['Run Test', 'Debug Test']);
      expect(lenses[1]?.command?.id).toBe('studio.lsp.runTests');
      expect(lenses[0]?.command?.id).toBe('studio.lsp.runTests');
      captured.commands?.get('studio.lsp.runTests')?.(
        undefined,
        ...(lenses[0]?.command?.arguments ?? []),
      );
      expect(testsRun).toEqual([runArgument]);
    });

    it('aRunTestLens_whereNothingRunsTests_showsItsTitleAlone (#1150)', async () => {
      codeLensSupport = { resolve: false };
      responses['textDocument/codeLens'] = [
        {
          ...(LENS as object),
          command: { title: 'Run Test', command: 'dotnet.test.run', arguments: [{}] },
        },
      ];
      const features: LspFeatures = await build();
      features.enableCodeLens('csharp');

      const list: { lenses: unknown[] } | undefined = await captured.codeLens
        ?.get('csharp')
        ?.provideCodeLenses(owned);

      expect((list?.lenses[0] as { command?: unknown }).command).toEqual({
        id: '',
        title: 'Run Test',
      });
    });

    it('askNothing_forADocumentWhoseServerShowsNone', async () => {
      const features: LspFeatures = await build();
      features.enableCodeLens('csharp');

      expect(await captured.codeLens?.get('csharp')?.provideCodeLenses(owned)).toBeUndefined();
      expect(requests).toEqual([]);
    });
  });

  describe('auto-insert (#1148)', () => {
    const SKELETON: unknown = {
      _vs_textEditFormat: 2,
      _vs_textEdit: {
        range: { start: { line: 7, character: 7 }, end: { line: 7, character: 7 } },
        newText: ' <summary>\n    /// $0\n    /// </summary>',
      },
    };

    /**
     * Builds an editor typed into, recording what is inserted.
     * @param inserted Receives each snippet inserted, and the selection it replaced.
     * @param version The model's version, which the test may move on.
     * @returns Returns the editor.
     */
    function typedInto(inserted: unknown[], version: { value: number }): unknown {
      const model: unknown = {
        uri: { toString: (): string => MODEL_URI },
        getValue: (): string => '',
        getVersionId: (): number => version.value,
        isDisposed: (): boolean => false,
        getOptions: (): unknown => ({ tabSize: 4, insertSpaces: true }),
        getLanguageId: (): string => 'csharp',
        getLineContent: (): string => '    ///',
      };
      return {
        getModel: (): unknown => model,
        getPosition: (): unknown => ({ lineNumber: 8, column: 8 }),
        setSelection: (range: unknown): void => void inserted.push({ select: range }),
        getContribution: (): unknown => ({
          insert: (template: string): void => void inserted.push(template),
        }),
      };
    }

    it('aCharacterTheServerDeclares_isAnsweredWithItsSnippet_atTheCaret', async () => {
      autoInsertTriggers = ["'", '/', '\n', '"'];
      responses['textDocument/_vs_onAutoInsert'] = SKELETON;
      await build();
      const inserted: unknown[] = [];

      autoInsertHandler?.(typedInto(inserted, { value: 1 }), '/');
      await flush();

      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'textDocument/_vs_onAutoInsert',
        params: {
          _vs_textDocument: { uri: 'file:///root/app.ts' },
          _vs_position: { line: 7, character: 7 },
          _vs_ch: '/',
          _vs_options: { tabSize: 4, insertSpaces: true },
        },
      });
      expect(inserted).toEqual([
        { select: { startLineNumber: 8, startColumn: 8, endLineNumber: 8, endColumn: 8 } },
        ' <summary>\n    /// $0\n    /// </summary>',
      ]);
    });

    it('withDocCommentAutoInsertOff_aDocCommentAsksNothing', async () => {
      autoInsertTriggers = ['/'];
      await build();
      const settings: Settings = TestBed.inject(Settings);
      settings.setLanguageOverride('csharp', 'docCommentAutoInsert', false);

      autoInsertHandler?.(typedInto([], { value: 1 }), '/');
      await flush();
      localStorage.removeItem('settings');

      expect(requests).toHaveLength(0);
    });

    it('aCharacterTheServerDoesNotDeclare_asksNothing', async () => {
      autoInsertTriggers = ['/'];
      await build();

      autoInsertHandler?.(typedInto([], { value: 1 }), 'x');
      await flush();

      expect(requests).toEqual([]);
    });

    it('anAnswerToADocumentThatChangedMeanwhile_isDropped', async () => {
      autoInsertTriggers = ['/'];
      responses['textDocument/_vs_onAutoInsert'] = SKELETON;
      await build();
      const inserted: unknown[] = [];
      const version: { value: number } = { value: 1 };

      autoInsertHandler?.(typedInto(inserted, version), '/');
      version.value = 2;
      await flush();

      expect(requests).toHaveLength(1);
      expect(inserted).toEqual([]);
    });
  });

  describe("folds, occurrences and a range's tokens (#1147)", () => {
    const ALL: LspStructureSupport = {
      folding: true,
      highlights: true,
      linkedEditing: true,
      rangeTokens: true,
      selectionRanges: true,
    };
    const owned: unknown = {
      uri: { toString: (): string => MODEL_URI },
      getValue: (): string => '',
    };

    it('areRegisteredOncePerLanguage_onlyForWhatTheServerGives', async () => {
      const features: LspFeatures = await build();
      features.enableStructure('csharp', ALL);
      features.enableStructure('csharp', ALL);
      features.enableStructure('go', {
        folding: true,
        highlights: false,
        linkedEditing: false,
        rangeTokens: false,
        selectionRanges: false,
      });

      expect([...(captured.structure?.keys() ?? [])]).toEqual([
        'csharp:folding',
        'csharp:highlights',
        'csharp:linkedEditing',
        'csharp:rangeTokens',
        'csharp:selectionRanges',
        'go:folding',
      ]);
    });

    it('colors_areAskedFor_onlyWhereMonacoHasNoneOfItsOwn (#1214)', async () => {
      const features: LspFeatures = await build();
      const colors: LspStructureSupport = { ...ALL, colors: true };
      for (const language of ['html', 'svelte', 'css', 'scss', 'less', 'json']) {
        features.enableStructure(language, colors);
      }
      features.enableStructure('csharp', ALL);

      // Monaco's own CSS and JSON workers already colour those: a server's swatches would show twice.
      expect(
        [...(captured.structure?.keys() ?? [])].filter((key: string): boolean =>
          key.endsWith(':colors'),
        ),
      ).toEqual(['html:colors', 'svelte:colors']);
    });

    it('colors_mapTheServersColours_leavingOutAnyItCannotRead (#1214)', async () => {
      structureSupport = { ...ALL, colors: true };
      const at: (line: number) => unknown = (line: number): unknown => ({
        start: { line, character: 7 },
        end: { line, character: 14 },
      });
      responses['textDocument/documentColor'] = [
        { range: at(0), color: { red: 1, green: 0, blue: 0, alpha: 1 } },
        { range: at(1), color: { red: 2, green: 0, blue: 0, alpha: 1 } },
        { range: at(2), color: 'red' },
        { color: { red: 0, green: 0, blue: 1, alpha: 0.5 } },
      ];
      const features: LspFeatures = await build();
      features.enableStructure('html', { ...ALL, colors: true });

      const found: unknown = await captured.structure
        ?.get('html:colors')
        ?.provideDocumentColors?.(owned);

      expect(requests.at(-1)?.method).toBe('textDocument/documentColor');
      expect(found).toEqual([
        {
          range: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 15 },
          color: { red: 1, green: 0, blue: 0, alpha: 1 },
        },
      ]);
    });

    it('colorPresentations_askHowToWriteThePickedColour_inItsPlace (#1214)', async () => {
      structureSupport = { ...ALL, colors: true };
      responses['textDocument/colorPresentation'] = [
        {
          label: 'rgb(255, 0, 0)',
          textEdit: {
            range: { start: { line: 0, character: 7 }, end: { line: 0, character: 14 } },
            newText: 'rgb(255, 0, 0)',
          },
        },
        { label: '#ff0000' },
        { textEdit: { newText: 'no label' } },
      ];
      const features: LspFeatures = await build();
      features.enableStructure('html', { ...ALL, colors: true });
      const picked: unknown = {
        range: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 15 },
        color: { red: 1, green: 0, blue: 0, alpha: 1 },
      };

      const presentations: unknown = await captured.structure
        ?.get('html:colors')
        ?.provideColorPresentations?.(owned, picked);

      expect(requests.at(-1)).toMatchObject({
        method: 'textDocument/colorPresentation',
        params: {
          color: { red: 1, green: 0, blue: 0, alpha: 1 },
          range: { start: { line: 0, character: 7 }, end: { line: 0, character: 14 } },
        },
      });
      expect(presentations).toEqual([
        {
          label: 'rgb(255, 0, 0)',
          textEdit: {
            range: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 15 },
            text: 'rgb(255, 0, 0)',
          },
        },
        { label: '#ff0000' },
      ]);
    });

    it('colors_whereTheServerFindsNone_askNothing (#1214)', async () => {
      structureSupport = ALL;
      const features: LspFeatures = await build();
      features.enableStructure('html', { ...ALL, colors: true });

      expect(
        await captured.structure?.get('html:colors')?.provideDocumentColors?.(owned),
      ).toBeUndefined();
      expect(requests.filter((request) => request.method === 'textDocument/documentColor')).toEqual(
        [],
      );
    });

    it('linkedEditing_asksTheServerForTheRangesEditedTogether', async () => {
      structureSupport = ALL;
      const tag: (line: number) => unknown = (line: number): unknown => ({
        start: { line, character: 1 },
        end: { line, character: 4 },
      });
      responses['textDocument/linkedEditingRange'] = {
        ranges: [tag(0), tag(2)],
        wordPattern: '[a-z]+',
      };
      const features: LspFeatures = await build();
      features.enableStructure('html', ALL);

      const linked: { ranges: unknown[]; wordPattern?: RegExp } | undefined =
        await captured.structure
          ?.get('html:linkedEditing')
          ?.provideLinkedEditingRanges?.(owned, { lineNumber: 1, column: 2 });

      expect(requests.at(-1)?.method).toBe('textDocument/linkedEditingRange');
      expect(linked?.ranges).toHaveLength(2);
      expect(linked?.wordPattern).toEqual(/[a-z]+/);
    });

    it('linkedEditing_withNoRangesThere_answersNothing', async () => {
      structureSupport = ALL;
      responses['textDocument/linkedEditingRange'] = null;
      const features: LspFeatures = await build();
      features.enableStructure('html', ALL);

      await expect(
        captured.structure
          ?.get('html:linkedEditing')
          ?.provideLinkedEditingRanges?.(owned, { lineNumber: 1, column: 2 }),
      ).resolves.toBeUndefined();
    });

    it('selectionRanges_climbFromTheIdentifierOutward_oneChainPerCaret (#1155)', async () => {
      structureSupport = ALL;
      const span: (line: number, from: number, to: number) => unknown = (
        line: number,
        from: number,
        to: number,
      ): unknown => ({
        start: { line, character: from },
        end: { line, character: to },
      });
      responses['textDocument/selectionRange'] = [
        {
          range: span(5, 23, 29),
          parent: { range: span(5, 16, 29), parent: { range: span(5, 0, 41) } },
        },
        { range: span(9, 4, 8) },
      ];
      const features: LspFeatures = await build();
      features.enableStructure('csharp', ALL);

      const ranges: unknown = await captured.structure
        ?.get('csharp:selectionRanges')
        ?.provideSelectionRanges?.(owned, [
          { lineNumber: 6, column: 25 },
          { lineNumber: 10, column: 6 },
        ]);

      expect(requests.at(-1)).toMatchObject({
        method: 'textDocument/selectionRange',
        params: {
          textDocument: { uri: 'file:///root/app.ts' },
          positions: [
            { line: 5, character: 24 },
            { line: 9, character: 5 },
          ],
        },
      });
      const monacoRange: (line: number, from: number, to: number) => unknown = (
        line: number,
        from: number,
        to: number,
      ): unknown => ({
        range: { startLineNumber: line, startColumn: from, endLineNumber: line, endColumn: to },
      });
      expect(ranges).toEqual([
        [monacoRange(6, 24, 30), monacoRange(6, 17, 30), monacoRange(6, 1, 42)],
        [monacoRange(10, 5, 9)],
      ]);
    });

    it('selectionRanges_thatDoNotAnswerEveryCaret_orAServerThatGivesNone_fallBackToMonacos', async () => {
      structureSupport = { ...ALL, selectionRanges: false };
      const features: LspFeatures = await build();
      features.enableStructure('csharp', ALL);
      const provider: FakeStructureProvider | undefined =
        captured.structure?.get('csharp:selectionRanges');

      expect(await provider?.provideSelectionRanges?.(owned, [{ lineNumber: 1, column: 1 }])).toBe(
        undefined,
      );
      expect(requests).toEqual([]);

      structureSupport = ALL;
      responses['textDocument/selectionRange'] = [];
      expect(await provider?.provideSelectionRanges?.(owned, [{ lineNumber: 1, column: 1 }])).toBe(
        undefined,
      );
    });

    it('folds_leavesTheDocumentAlone_whenFoldingProviderChoosesSomethingElse', async () => {
      structureSupport = ALL;
      responses['textDocument/foldingRange'] = [{ startLine: 0, endLine: 2 }];
      const features: LspFeatures = await build();
      TestBed.inject(Settings).setLanguageOverride('csharp', 'foldingProvider', 'braces');
      features.enableStructure('csharp', ALL);

      const folds: unknown = await captured.structure
        ?.get('csharp:folding')
        ?.provideFoldingRanges?.(fakeModel(MODEL_URI));

      expect(folds).toBeUndefined();
    });

    it('folds_asTheServerFoldsThem_withTheirKinds_droppingWhatFoldsNothing', async () => {
      structureSupport = ALL;
      responses['textDocument/foldingRange'] = [
        { startLine: 14, endLine: 18, kind: 'implementation' },
        { startLine: 13, endLine: 24, kind: 'region', collapsedText: 'Counting' },
        { startLine: 6, endLine: 8, kind: 'comment' },
        { startLine: 0, endLine: 2, kind: 'imports' },
        { startLine: 30, endLine: 30 },
        { endLine: 4 },
      ];
      const features: LspFeatures = await build();
      features.enableStructure('csharp', ALL);

      const folds: unknown = await captured.structure
        ?.get('csharp:folding')
        ?.provideFoldingRanges?.(owned);

      expect(folds).toEqual([
        { start: 15, end: 19 },
        { start: 14, end: 25, kind: 'region' },
        { start: 7, end: 9, kind: 'comment' },
        { start: 1, end: 3, kind: 'imports' },
      ]);
    });

    it('occurrences_tellReadsFromWrites', async () => {
      structureSupport = ALL;
      responses['textDocument/documentHighlight'] = [
        {
          range: { start: { line: 11, character: 16 }, end: { line: 11, character: 21 } },
          kind: 1,
        },
        { range: { start: { line: 17, character: 8 }, end: { line: 17, character: 13 } }, kind: 3 },
        {
          range: { start: { line: 17, character: 16 }, end: { line: 17, character: 21 } },
          kind: 2,
        },
      ];
      const features: LspFeatures = await build();
      features.enableStructure('csharp', ALL);

      const highlights: unknown = await captured.structure
        ?.get('csharp:highlights')
        ?.provideDocumentHighlights?.(owned, { lineNumber: 12, column: 17 });

      expect(requests.at(-1)?.params).toEqual({
        textDocument: { uri: 'file:///root/app.ts' },
        position: { line: 11, character: 16 },
      });
      expect(highlights).toEqual([
        {
          range: { startLineNumber: 12, startColumn: 17, endLineNumber: 12, endColumn: 22 },
          kind: 0,
        },
        {
          range: { startLineNumber: 18, startColumn: 9, endLineNumber: 18, endColumn: 14 },
          kind: 2,
        },
        {
          range: { startLineNumber: 18, startColumn: 17, endLineNumber: 18, endColumn: 22 },
          kind: 1,
        },
      ]);
    });

    it('aRangesTokens_areAskedForTheRangeShown_andRemappedOntoTheFixedLegend', async () => {
      structureSupport = ALL;
      semanticLegend = {
        tokenTypes: ['class', 'method', 'field', 'keyword'],
        tokenModifiers: ['static'],
      };
      responses['textDocument/semanticTokens/range'] = { data: [10, 4, 6, 0, 0] };
      const features: LspFeatures = await build();
      features.enableStructure('csharp', ALL);

      const tokens: { data: Uint32Array } | null | undefined = await captured.structure
        ?.get('csharp:rangeTokens')
        ?.provideDocumentRangeSemanticTokens?.(owned, {
          startLineNumber: 11,
          startColumn: 1,
          endLineNumber: 19,
          endColumn: 1,
        });

      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'textDocument/semanticTokens/range',
        params: {
          textDocument: { uri: 'file:///root/app.ts' },
          range: { start: { line: 10, character: 0 }, end: { line: 18, character: 0 } },
        },
      });
      expect([...(tokens?.data ?? [])]).toEqual([10, 4, 6, 2, 0]);
    });

    it('aDocumentWhoseServerGivesNone_isLeftToTheHeuristics', async () => {
      const features: LspFeatures = await build();
      features.enableStructure('csharp', ALL);

      expect(
        await captured.structure?.get('csharp:folding')?.provideFoldingRanges?.(owned),
      ).toBeUndefined();
      expect(
        await captured.structure
          ?.get('csharp:rangeTokens')
          ?.provideDocumentRangeSemanticTokens?.(owned, {}),
      ).toBeNull();
      expect(requests).toEqual([]);
      expect(braceFoldingSuppressedWhen?.(owned)).toBe(false);
      structureSupport = ALL;
      expect(braceFoldingSuppressedWhen?.(owned)).toBe(true);
    });
  });

  describe('inlay hints (#1145)', () => {
    const owned: unknown = {
      uri: { toString: (): string => MODEL_URI },
      getValue: (): string => '',
    };
    const SHOWN: unknown = { startLineNumber: 1, startColumn: 1, endLineNumber: 20, endColumn: 1 };
    const NAME_HINT: unknown = {
      position: { line: 9, character: 35 },
      label: 'name:',
      kind: 2,
      paddingRight: true,
      data: { ResultId: 1 },
    };

    it('areRegisteredOncePerLanguage_withAnEventThatAsksAgain', async () => {
      const features: LspFeatures = await build();
      features.enableInlayHints('csharp');
      features.enableInlayHints('csharp');

      expect([...(captured.inlayHints?.keys() ?? [])]).toEqual(['csharp']);
      expect(captured.inlayHints?.get('csharp')?.onDidChangeInlayHints).toBeDefined();
    });

    it('askForTheRangeShown_andMapTheServersHints', async () => {
      inlayHintSupport = { resolve: true };
      responses['textDocument/inlayHint'] = [
        NAME_HINT,
        {
          position: { line: 9, character: 12 },
          label: [{ value: 'Person' }, { value: '?', tooltip: 'nullable' }],
          kind: 1,
          textEdits: [
            {
              range: { start: { line: 9, character: 8 }, end: { line: 9, character: 11 } },
              newText: 'Person?',
            },
          ],
        },
        { label: 'no position' },
      ];
      const features: LspFeatures = await build();
      features.enableInlayHints('csharp');

      const list: { hints: unknown[] } | undefined = await captured.inlayHints
        ?.get('csharp')
        ?.provideInlayHints(owned, SHOWN);

      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'textDocument/inlayHint',
        params: {
          textDocument: { uri: 'file:///root/app.ts' },
          range: { start: { line: 0, character: 0 }, end: { line: 19, character: 0 } },
        },
      });
      expect(list?.hints).toEqual([
        { label: 'name:', position: { lineNumber: 10, column: 36 }, kind: 2, paddingRight: true },
        {
          label: [{ label: 'Person' }, { label: '?', tooltip: 'nullable' }],
          position: { lineNumber: 10, column: 13 },
          kind: 1,
          textEdits: [
            {
              range: { startLineNumber: 10, startColumn: 9, endLineNumber: 10, endColumn: 12 },
              text: 'Person?',
            },
          ],
        },
      ]);
    });

    it('aHoveredHint_isFilledInWithItsTooltip', async () => {
      inlayHintSupport = { resolve: true };
      responses['textDocument/inlayHint'] = [NAME_HINT];
      responses['inlayHint/resolve'] = {
        ...(NAME_HINT as object),
        tooltip: { kind: 'markdown', value: '(parameter) string name' },
      };
      const features: LspFeatures = await build();
      features.enableInlayHints('csharp');
      const provider: FakeInlayHintsProvider | undefined = captured.inlayHints?.get('csharp');
      const list: { hints: unknown[] } | undefined = await provider?.provideInlayHints(
        owned,
        SHOWN,
      );

      const resolved: unknown = await provider?.resolveInlayHint(list?.hints[0]);

      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'inlayHint/resolve',
        params: NAME_HINT,
      });
      expect(resolved).toMatchObject({
        label: 'name:',
        tooltip: { value: '(parameter) string name' },
      });
    });

    it('askNothing_forADocumentWhoseServerSetsNone', async () => {
      const features: LspFeatures = await build();
      features.enableInlayHints('csharp');

      expect(await captured.inlayHints?.get('csharp')?.provideInlayHints(owned, SHOWN)).toBe(
        undefined,
      );
      expect(requests).toEqual([]);
    });

    it('aRefresh_firesTheEvent_soEditorsAskAgain', async () => {
      const features: LspFeatures = await build();
      features.refreshInlayHints();
      features.enableInlayHints('csharp');

      features.refreshInlayHints();

      const emitter: FakeEmitter | undefined = (
        features as unknown as { inlayHintsChanged?: FakeEmitter }
      ).inlayHintsChanged;
      expect(emitter?.fired).toBe(1);
    });
  });

  describe('implementations and type definitions (#1142)', () => {
    const owned: unknown = { uri: { toString: (): string => MODEL_URI } };
    const at: { lineNumber: number; column: number } = { lineNumber: 3, column: 7 };

    it('askTheServerByTheirOwnMethods_andAnswerWithPaths', async () => {
      responses['textDocument/implementation'] = [
        {
          uri: 'file:///root/formal.ts',
          range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
        },
        {
          targetUri: 'file:///root/casual.ts',
          targetSelectionRange: {
            start: { line: 6, character: 4 },
            end: { line: 6, character: 9 },
          },
        },
      ];
      responses['textDocument/typeDefinition'] = [
        {
          uri: 'file:///root/person.ts',
          range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
        },
      ];
      navigationSupport = {
        declaration: false,
        implementation: true,
        typeDefinition: true,
        callHierarchy: false,
        typeHierarchy: false,
        sourceHeader: false,
      };
      const features: LspFeatures = await build();
      const model: Parameters<LspFeatures['implementations']>[0] = owned as Parameters<
        LspFeatures['implementations']
      >[0];

      expect(features.servesNavigation(model, 'implementation')).toBe(true);
      expect(features.servesNavigation(model, 'typeDefinition')).toBe(true);
      expect(await features.implementations(model, at)).toEqual([
        {
          path: '/root/formal.ts',
          range: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 10 },
        },
        {
          path: '/root/casual.ts',
          range: { startLineNumber: 7, startColumn: 5, endLineNumber: 7, endColumn: 10 },
        },
      ]);
      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'textDocument/implementation',
        params: {
          textDocument: { uri: 'file:///root/app.ts' },
          position: { line: 2, character: 6 },
        },
      });
      expect(await features.typeDefinitions(model, at)).toEqual([
        {
          path: '/root/person.ts',
          range: { startLineNumber: 1, startColumn: 14, endLineNumber: 1, endColumn: 20 },
        },
      ]);
      expect(requests.at(-1)?.method).toBe('textDocument/typeDefinition');
    });

    it('sourceDefinitions_runTheServersCommand_andAnswerByPath (#1207)', async () => {
      serverCommands = ['_typescript.goToSourceDefinition'];
      responses['workspace/executeCommand'] = [
        {
          uri: 'file:///root/node_modules/pkg/index.js',
          range: { start: { line: 4, character: 9 }, end: { line: 4, character: 12 } },
        },
      ];
      const features: LspFeatures = await build();
      const model: Parameters<LspFeatures['sourceDefinitions']>[0] = owned as Parameters<
        LspFeatures['sourceDefinitions']
      >[0];

      expect(features.servesSourceDefinition(model)).toBe(true);
      expect(await features.sourceDefinitions(model, at)).toEqual([
        {
          path: '/root/node_modules/pkg/index.js',
          range: { startLineNumber: 5, startColumn: 10, endLineNumber: 5, endColumn: 13 },
        },
      ]);
      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'workspace/executeCommand',
        params: {
          command: '_typescript.goToSourceDefinition',
          arguments: ['file:///root/app.ts', { line: 2, character: 6 }],
        },
      });
    });

    it('projectConfigurations_askTsserverWhichConfigurationTheFileIsIn (#1207)', async () => {
      serverCommands = ['typescript.tsserverRequest'];
      responses['workspace/executeCommand'] = {
        type: 'response',
        success: true,
        body: {
          configFileName: '/root/packages/app/tsconfig.json',
          languageServiceDisabled: false,
        },
      };
      const features: LspFeatures = await build();
      const model: Parameters<LspFeatures['projectConfigurations']>[0] = owned as Parameters<
        LspFeatures['projectConfigurations']
      >[0];

      expect(features.servesProjectConfiguration(model)).toBe(true);
      expect(await features.projectConfigurations(model)).toEqual([
        {
          path: '/root/packages/app/tsconfig.json',
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        },
      ]);
      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'workspace/executeCommand',
        params: {
          command: 'typescript.tsserverRequest',
          arguments: ['projectInfo', { file: 'file:///root/app.ts', needFileNameList: false }],
        },
      });
    });

    it('projectConfigurations_ofAFileInAnInferredProject_areNone (#1207)', async () => {
      serverCommands = ['typescript.tsserverRequest'];
      responses['workspace/executeCommand'] = {
        body: { configFileName: '/dev/null/inferredProject1*' },
      };
      const features: LspFeatures = await build();
      const model: Parameters<LspFeatures['projectConfigurations']>[0] = owned as Parameters<
        LspFeatures['projectConfigurations']
      >[0];

      expect(await features.projectConfigurations(model)).toEqual([]);
    });

    it('projectConfigurations_areNull_andNeverAsked_whereTheServerDoesNotRunTheCommand (#1207)', async () => {
      const features: LspFeatures = await build();
      const model: Parameters<LspFeatures['projectConfigurations']>[0] = owned as Parameters<
        LspFeatures['projectConfigurations']
      >[0];

      expect(features.servesProjectConfiguration(model)).toBe(false);
      expect(await features.projectConfigurations(model)).toBeNull();
    });

    it('sourceDefinitions_areNull_andNeverAsked_whereTheServerDoesNotRunTheCommand (#1207)', async () => {
      const features: LspFeatures = await build();
      const model: Parameters<LspFeatures['sourceDefinitions']>[0] = owned as Parameters<
        LspFeatures['sourceDefinitions']
      >[0];

      expect(features.servesSourceDefinition(model)).toBe(false);
      expect(await features.sourceDefinitions(model, at)).toBeNull();
    });

    it('areNull_andNeverAsked_whereTheServerDoesNotOfferThem_orNoServerServes', async () => {
      navigationSupport = {
        declaration: false,
        implementation: false,
        typeDefinition: true,
        callHierarchy: false,
        typeHierarchy: false,
        sourceHeader: false,
      };
      const features: LspFeatures = await build();
      const model: Parameters<LspFeatures['implementations']>[0] = owned as Parameters<
        LspFeatures['implementations']
      >[0];
      const unowned: Parameters<LspFeatures['implementations']>[0] = {
        uri: { toString: (): string => 'inmemory://model/unowned' },
      } as Parameters<LspFeatures['implementations']>[0];
      const asked: number = requests.length;

      expect(features.servesNavigation(model, 'implementation')).toBe(false);
      expect(await features.implementations(model, at)).toBeNull();
      expect(features.servesNavigation(unowned, 'typeDefinition')).toBe(false);
      expect(await features.typeDefinitions(unowned, at)).toBeNull();
      expect(requests.length).toBe(asked);
    });

    it('areNotServed_byAServerThatSaidNothingOfThem', async () => {
      const features: LspFeatures = await build();
      const model: Parameters<LspFeatures['implementations']>[0] = owned as Parameters<
        LspFeatures['implementations']
      >[0];

      expect(features.servesNavigation(model, 'implementation')).toBe(false);
      expect(features.servesNavigation(model, 'typeDefinition')).toBe(false);
    });
  });

  describe('declarations and the header or source of a file (#1213)', () => {
    const owned: unknown = { uri: { toString: (): string => MODEL_URI } };
    const at: { lineNumber: number; column: number } = { lineNumber: 11, column: 20 };
    const CLANGD: LspNavigationSupport = {
      declaration: true,
      implementation: false,
      typeDefinition: false,
      callHierarchy: false,
      typeHierarchy: false,
      sourceHeader: true,
    };

    it('declarations_areAnsweredByPath', async () => {
      responses['textDocument/declaration'] = [
        {
          uri: 'file:///root/shapes.hpp',
          range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } },
        },
      ];
      navigationSupport = CLANGD;
      const features: LspFeatures = await build();

      const found: readonly LspDefinition[] | null = await features.declarations(
        owned as Parameters<LspFeatures['declarations']>[0],
        at,
      );

      expect(found?.map((place: LspDefinition): string => place.path)).toEqual([
        '/root/shapes.hpp',
      ]);
    });

    it('sourceHeaderOf_readsTheUriClangdAnswers_askingWithTheDocumentsUri', async () => {
      responses['textDocument/switchSourceHeader'] = 'file:///root/shapes.hpp';
      navigationSupport = CLANGD;
      const features: LspFeatures = await build();

      expect(
        await features.sourceHeaderOf(owned as Parameters<LspFeatures['sourceHeaderOf']>[0]),
      ).toBe('/root/shapes.hpp');
    });

    it('sourceHeaderOf_isNull_whenTheFileHasNoCounterpart', async () => {
      responses['textDocument/switchSourceHeader'] = null;
      navigationSupport = CLANGD;
      const features: LspFeatures = await build();

      expect(
        await features.sourceHeaderOf(owned as Parameters<LspFeatures['sourceHeaderOf']>[0]),
      ).toBeNull();
    });

    it('neitherIsAsked_ofAServerThatDoesNotOfferThem', async () => {
      navigationSupport = { ...CLANGD, declaration: false, sourceHeader: false };
      const features: LspFeatures = await build();
      const model: Parameters<LspFeatures['declarations']>[0] = owned as Parameters<
        LspFeatures['declarations']
      >[0];

      expect(await features.declarations(model, at)).toBeNull();
      expect(await features.sourceHeaderOf(model)).toBeNull();
    });
  });

  describe('call and type hierarchies (#1153)', () => {
    const owned: unknown = { uri: { toString: (): string => MODEL_URI } };
    const at: { lineNumber: number; column: number } = { lineNumber: 11, column: 20 };
    const HIERARCHIES: LspNavigationSupport = {
      declaration: false,
      implementation: false,
      typeDefinition: false,
      callHierarchy: true,
      typeHierarchy: true,
      sourceHeader: false,
    };
    const span: (line: number, from: number, to: number) => unknown = (
      line: number,
      from: number,
      to: number,
    ): unknown => ({
      start: { line, character: from },
      end: { line, character: to },
    });
    /**
     * Builds a server's hierarchy item, as Roslyn 5.13 answers one.
     * @param name The symbol's name.
     * @param uri Its document.
     * @param line Its line.
     * @returns Returns the item.
     */
    const item: (name: string, uri: string, line: number) => unknown = (
      name: string,
      uri: string,
      line: number,
    ): unknown => ({
      name,
      kind: 6,
      detail: 'Fixture.Services.FormalGreeter',
      uri,
      range: span(line, 4, 40),
      selectionRange: span(line, 18, 23),
      data: { SymbolKeyData: `key:${name}` },
    });
    const model: () => Parameters<LspFeatures['hierarchy']>[0] = (): Parameters<
      LspFeatures['hierarchy']
    >[0] => owned as Parameters<LspFeatures['hierarchy']>[0];

    it('preparesTheRoot_andWalksALevelAtATime_handingTheServerItsOwnItemBack', async () => {
      navigationSupport = HIERARCHIES;
      const root: unknown = item('Greet(string)', 'file:///root/formal.ts', 10);
      responses['textDocument/prepareCallHierarchy'] = [root];
      responses['callHierarchy/incomingCalls'] = [
        { from: item('Main()', 'file:///root/program.ts', 4), fromRanges: [span(8, 4, 9)] },
      ];
      responses['callHierarchy/outgoingCalls'] = [
        { to: item('Format(string)', 'file:///root/text.ts', 2), fromRanges: [] },
        { to: { name: 'malformed' } },
      ];
      const features: LspFeatures = await build();

      const source: HierarchySource | null = await features.hierarchy(model(), at, 'calls');

      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'textDocument/prepareCallHierarchy',
        params: {
          textDocument: { uri: 'file:///root/app.ts' },
          position: { line: 10, character: 19 },
        },
      });
      expect(source?.kind).toBe('calls');
      expect(source?.roots).toEqual([
        {
          name: 'Greet(string)',
          detail: 'Fixture.Services.FormalGreeter',
          kind: 6,
          location: {
            path: '/root/formal.ts',
            range: { startLineNumber: 11, startColumn: 19, endLineNumber: 11, endColumn: 24 },
          },
          item: root,
        },
      ]);

      const callers: readonly HierarchyNode[] | null | undefined = await source?.children(
        source.roots[0],
        'callers',
      );
      expect(requests.at(-1)).toEqual({
        sessionId: '/root::typescript',
        method: 'callHierarchy/incomingCalls',
        params: { item: root },
      });
      expect(callers?.map((node: HierarchyNode): string => node.name)).toEqual(['Main()']);
      expect(callers?.[0]?.location.path).toBe('/root/program.ts');

      const callees: readonly HierarchyNode[] | null | undefined = await source?.children(
        source.roots[0],
        'callees',
      );
      expect(requests.at(-1)?.method).toBe('callHierarchy/outgoingCalls');
      expect(callees?.map((node: HierarchyNode): string => node.name)).toEqual(['Format(string)']);
    });

    it('typeHierarchies_walkBaseAndDerivedTypes_andAFailedWalkIsNull', async () => {
      navigationSupport = HIERARCHIES;
      const root: unknown = item('FormalGreeter', 'file:///root/formal.ts', 4);
      responses['textDocument/prepareTypeHierarchy'] = [root];
      responses['typeHierarchy/supertypes'] = [item('IGreeter', 'file:///root/greeter.ts', 2)];
      responses['typeHierarchy/subtypes'] = new Error('The symbol could not be resolved.');
      const features: LspFeatures = await build();

      const source: HierarchySource | null = await features.hierarchy(model(), at, 'types');

      expect(requests.at(-1)?.method).toBe('textDocument/prepareTypeHierarchy');
      const bases: readonly HierarchyNode[] | null | undefined = await source?.children(
        source.roots[0],
        'supertypes',
      );
      expect(bases?.map((node: HierarchyNode): string => node.name)).toEqual(['IGreeter']);
      expect(await source?.children(source.roots[0], 'subtypes')).toBeNull();
    });

    it('nothingAtTheCaret_hasNoRoots_andAServerThatGivesNone_isNeverAsked', async () => {
      navigationSupport = { ...HIERARCHIES, typeHierarchy: false };
      responses['textDocument/prepareCallHierarchy'] = null;
      const features: LspFeatures = await build();

      expect((await features.hierarchy(model(), at, 'calls'))?.roots).toEqual([]);
      const asked: number = requests.length;
      expect(await features.hierarchy(model(), at, 'types')).toBeNull();
      expect(requests.length).toBe(asked);
    });
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

  describe('clangd, as it really answers (#1213)', () => {
    const model: Parameters<LspFeatures['codeActions']>[0] = {
      uri: { toString: (): string => MODEL_URI },
      getValue: (): string => '',
    } as unknown as Parameters<LspFeatures['codeActions']>[0];
    const caret: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    } = { startLineNumber: 9, startColumn: 16, endLineNumber: 9, endColumn: 16 };
    const TWEAK: unknown = {
      command: {
        arguments: [
          {
            file: 'file:///root/app.ts',
            selection: { start: { line: 8, character: 15 }, end: { line: 8, character: 19 } },
            tweakID: 'DefineInline',
          },
        ],
        command: 'clangd.applyTweak',
        title: 'Move function body to declaration',
      },
      kind: 'refactor',
      title: 'Move function body to declaration',
    };

    it('inlayHints_readItsLabelParts', async () => {
      inlayHintSupport = { resolve: false };
      responses['textDocument/inlayHint'] = [
        {
          kind: 2,
          label: [{ value: 'prec:' }],
          paddingLeft: false,
          paddingRight: true,
          position: { character: 19, line: 22 },
        },
        {
          kind: 1,
          label: [{ value: ': Point' }],
          paddingLeft: false,
          paddingRight: false,
          position: { character: 13, line: 37 },
        },
      ];
      const features: LspFeatures = await build();
      features.enableInlayHints('cpp');

      const list: { hints: unknown[] } | undefined = await captured.inlayHints
        ?.get('cpp')
        ?.provideInlayHints(model, caret);

      expect(list?.hints).toEqual([
        {
          label: [{ label: 'prec:' }],
          position: { lineNumber: 23, column: 20 },
          kind: 2,
          paddingRight: true,
        },
        { label: [{ label: ': Point' }], position: { lineNumber: 38, column: 14 }, kind: 1 },
      ]);
    });

    it('aFixIt_carriesItsEdit_asDocumentChanges_whichStudioAsksFor', async () => {
      codeActionSupport = 'actions';
      responses['textDocument/codeAction'] = [
        {
          diagnostics: [
            {
              code: 'expected_semi_after_stmt',
              message: "Expected ';' after return statement (fix available)",
              range: { start: { line: 38, character: 2 }, end: { line: 38, character: 8 } },
              severity: 1,
              source: 'clang',
            },
          ],
          edit: {
            documentChanges: [
              {
                edits: [
                  {
                    newText: ';',
                    range: { start: { line: 37, character: 12 }, end: { line: 37, character: 12 } },
                  },
                ],
                textDocument: { uri: 'file:///root/app.ts', version: 1 },
              },
            ],
          },
          isPreferred: true,
          kind: 'quickfix',
          title: "insert ';'",
        },
      ];
      const features: LspFeatures = await build();

      const actions: readonly LspCodeAction[] | null = await features.codeActions(model, caret);

      expect(actions?.[0]).toMatchObject({ title: "insert ';'", kind: 'quickfix' });
      expect(actions?.[0].isPreferred).toBe(true);
      expect(actions?.[0].edit?.files.map((file: { path: string }): string => file.path)).toEqual([
        '/root/app.ts',
      ]);
    });

    it('aTweak_isACommandTheServerRuns_andCarriesItsArgumentsBackUntouched', async () => {
      codeActionSupport = 'actions';
      serverCommands = ['clangd.applyFix', 'clangd.applyRename', 'clangd.applyTweak'];
      responses['textDocument/codeAction'] = [TWEAK];
      const features: LspFeatures = await build();

      const actions: readonly LspCodeAction[] | null = await features.codeActions(model, caret);
      const tweak: LspCodeAction = actions![0];

      expect(tweak).toMatchObject({ kind: 'refactor', edit: null });
      expect(await features.executeCommand(model, tweak.command!)).toEqual({ ran: true });
      expect(requests.at(-1)).toMatchObject({
        method: 'workspace/executeCommand',
        params: {
          command: 'clangd.applyTweak',
          arguments: (TWEAK as { command: { arguments: unknown } }).command.arguments,
        },
      });
    });
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
              reason: "Renaming or deleting files isn't supported yet.",
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

    it('bringTheServerUpToDate_first_soTheirEditsLandOnTheTextShown (#1207)', async () => {
      codeActionSupport = 'resolve';
      const order: string[] = [];
      syncHook = (): Promise<void> => {
        order.push('sync');
        return Promise.resolve();
      };
      responses['textDocument/codeAction'] = [];
      const features: LspFeatures = await build();
      const live: MonacoApi.editor.ITextModel = {
        ...(model as object),
        getValue: (): string => 'text',
      } as MonacoApi.editor.ITextModel;

      await features.codeActions(live, caret);

      expect(order).toEqual(['sync']);
    });

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

    it.each<[string, number]>([
      ['kotlin', 1],
      ['java', 2],
    ])(
      'convertJavaToKotlin_inA_%s_file_leaves_%i_action(s) (#1209)',
      async (languageId: string, count: number) => {
        codeActionSupport = 'actions';
        responses['textDocument/codeAction'] = [
          { title: 'Convert Java to Kotlin', command: 'convertJavaToKotlin', arguments: [] },
          { title: 'Fix', kind: 'quickfix' },
        ];
        const features: LspFeatures = await build();
        const typed: MonacoApi.editor.ITextModel = {
          ...(model as object),
          getLanguageId: (): string => languageId,
        } as MonacoApi.editor.ITextModel;

        expect((await features.codeActions(typed, caret))?.length).toBe(count);
      },
    );

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

    it('roslynsFixAllAndNestedActions_areRead_withTheirScopesPathsAndChildren (#1151)', async () => {
      codeActionSupport = 'resolve';
      const fixAllData: unknown = {
        UniqueIdentifier: 'Fix All: Remove unused variable',
        CodeActionPath: ['Remove unused variable'],
        FixAllFlavors: ['Document', 'Project', 'Solution', 42],
      };
      responses['textDocument/codeAction'] = [
        {
          title: 'Remove unused variable',
          kind: 'quickfix',
          data: { CodeActionPath: ['Remove unused variable'] },
        },
        {
          title: 'Fix All: Remove unused variable',
          kind: 'quickfix',
          command: {
            title: 'Fix All: Remove unused variable',
            command: 'roslyn.client.fixAllCodeAction',
            arguments: [fixAllData],
          },
          data: fixAllData,
        },
        {
          title: 'Suppress or configure issues',
          kind: 'quickfix',
          command: {
            title: 'Suppress or configure issues',
            command: 'roslyn.client.nestedCodeAction',
            arguments: [
              {
                CodeActionPath: ['Suppress or configure issues'],
                NestedCodeActions: [
                  {
                    title: 'in Source',
                    kind: 'quickfix',
                    data: {
                      CodeActionPath: [
                        'Suppress or configure issues',
                        'Suppress CS0219',
                        'in Source',
                      ],
                    },
                  },
                  { notAnAction: true },
                ],
              },
            ],
          },
        },
      ];
      const features: LspFeatures = await build();

      const [fix, fixAll, nested] = (await features.codeActions(model, caret)) ?? [];

      expect(fix?.path).toEqual(['Remove unused variable']);
      expect(fix?.fixAllScopes).toBeUndefined();
      expect(fixAll?.fixAllScopes).toEqual(['Document', 'Project', 'Solution']);
      expect(fixAll?.path).toEqual(['Remove unused variable']);
      // The nested group's data rides on its command's argument.
      expect(nested?.path).toEqual(['Suppress or configure issues']);
      expect(nested?.children?.map((child: LspCodeAction): string => child.title)).toEqual([
        'in Source',
      ]);
      expect(nested?.children?.[0]?.path).toEqual([
        'Suppress or configure issues',
        'Suppress CS0219',
        'in Source',
      ]);
    });

    it('resolveFixAll_asksForOneScopesEdit_withTheActionsData_andRunsNothingAfter (#1151)', async () => {
      codeActionSupport = 'resolve';
      const data: unknown = {
        CodeActionPath: ['Remove unused variable'],
        FixAllFlavors: ['Solution'],
      };
      responses['textDocument/codeAction'] = [
        {
          title: 'Fix All: Remove unused variable',
          kind: 'quickfix',
          command: {
            title: 'Fix All: Remove unused variable',
            command: 'roslyn.client.fixAllCodeAction',
            arguments: [data],
          },
        },
      ];
      responses['codeAction/resolveFixAll'] = {
        scope: 'Solution',
        title: 'Fix All: Remove unused variable',
        data,
        edit: {
          documentChanges: [
            {
              textDocument: { uri: 'file:///root/a.cs', version: null },
              edits: [
                {
                  range: { start: { line: 8, character: 4 }, end: { line: 9, character: 8 } },
                  newText: '',
                },
              ],
            },
            {
              textDocument: { uri: 'file:///root/b.cs', version: null },
              edits: [
                {
                  range: { start: { line: 2, character: 4 }, end: { line: 3, character: 8 } },
                  newText: '',
                },
              ],
            },
          ],
        },
      };
      const features: LspFeatures = await build();
      const [fixAll] = (await features.codeActions(model, caret)) ?? [];

      const resolved: LspCodeAction = await features.resolveFixAll(model, fixAll, 'Solution');

      expect(requests.at(-1)).toMatchObject({
        method: 'codeAction/resolveFixAll',
        // With no data of its own, the action's data is its command's argument.
        params: { title: 'Fix All: Remove unused variable', data, scope: 'Solution' },
      });
      expect(resolved.edit?.files.map((file: { path: string }): string => file.path)).toEqual([
        '/root/a.cs',
        '/root/b.cs',
      ]);
      expect(resolved.command).toBeNull();

      responses['codeAction/resolveFixAll'] = new Error('gone');
      expect((await features.resolveFixAll(model, fixAll, 'Solution')).edit).toBeNull();
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

  it('semanticTokens_coloursTheTypeScriptMemberAsAMethod_andDropsItsLocalModifier (#1207)', async () => {
    // typescript-language-server's legend: `member` is a method, and `local` is a modifier the fixed
    // legend has no use for.
    semanticLegend = { tokenTypes: ['member'], tokenModifiers: ['static', 'local'] };
    responses['textDocument/semanticTokens/full'] = { data: [0, 0, 4, 0, 3] };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(model);

    // Fixed legend: method=13, static=3 (bit value 8).
    expect([...(tokens?.data ?? [])]).toEqual([0, 0, 4, 13, 8]);
  });

  it.each([
    ['builtinType', 'type'],
    ['typeAlias', 'type'],
    ['union', 'struct'],
    ['lifetime', 'typeParameter'],
    ['constParameter', 'typeParameter'],
    ['const', 'enumMember'],
    ['static', 'enumMember'],
    ['attribute', 'decorator'],
    ['builtinAttribute', 'decorator'],
    ['derive', 'decorator'],
    ['deriveHelper', 'decorator'],
    ['toolModule', 'decorator'],
    ['procMacro', 'macro'],
    ['selfKeyword', 'keyword'],
    ['selfTypeKeyword', 'keyword'],
    ['boolean', 'keyword'],
    ['character', 'string'],
  ])('semanticTokens_coloursRustsOwn_%s_as_%s (#1210)', async (name: string, standard: string) => {
    semanticLegend = { tokenTypes: [name], tokenModifiers: [] };
    responses['textDocument/semanticTokens/full'] = { data: [0, 0, 4, 0, 0] };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(model);

    expect(tokens?.data[3]).toBe(SEMANTIC_TOKEN_TYPES.indexOf(standard));
  });

  it.each(['unresolvedReference', 'formatSpecifier', 'attributeBracket', 'escapeSequence'])(
    'semanticTokens_dropsRusts_%s_soTheGrammarsColourStands (#1210)',
    async (name: string) => {
      semanticLegend = { tokenTypes: [name, 'keyword'], tokenModifiers: [] };
      responses['textDocument/semanticTokens/full'] = {
        data: [0, 0, 4, 0, 0, 0, 5, 2, 1, 0],
      };
      await build();
      const model: unknown = { uri: { toString: (): string => MODEL_URI } };
      const tokens: { data: Uint32Array } | undefined =
        await captured.semantic?.provideDocumentSemanticTokens(model);

      expect([...(tokens?.data ?? [])]).toEqual([
        0,
        5,
        2,
        SEMANTIC_TOKEN_TYPES.indexOf('keyword'),
        0,
      ]);
    },
  );

  it.each([
    ['annotation', 'decorator'],
    ['annotationMember', 'method'],
    ['record', 'class'],
    ['recordComponent', 'property'],
  ])('semanticTokens_coloursJavas_%s_as_%s (#1208)', async (name: string, standard: string) => {
    semanticLegend = { tokenTypes: [name], tokenModifiers: [] };
    responses['textDocument/semanticTokens/full'] = { data: [0, 0, 4, 0, 0] };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(model);

    expect(tokens?.data[3]).toBe(SEMANTIC_TOKEN_TYPES.indexOf(standard));
  });

  it('semanticTokens_keepsJavasStandardModifiers_andDropsItsOwn (#1208)', async () => {
    // Part of jdtls's legend: `readonly` and `declaration` are standard, `public` and `generic` its own.
    semanticLegend = {
      tokenTypes: ['record'],
      tokenModifiers: ['readonly', 'declaration', 'public', 'generic'],
    };
    responses['textDocument/semanticTokens/full'] = { data: [0, 0, 4, 0, 0b1111] };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(model);

    expect(tokens?.data[4]).toBe(
      (1 << SEMANTIC_TOKEN_MODIFIERS.indexOf('readonly')) |
        (1 << SEMANTIC_TOKEN_MODIFIERS.indexOf('declaration')),
    );
  });

  it('semanticTokens_coloursClangdsConceptsAsTypes_itsInactiveCodeAsComments_andLeavesBrackets (#1213)', async () => {
    // Part of clangd's legend. `comment` is how it marks what the preprocessor skipped, and `bracket`
    // is punctuation, left to the grammar.
    semanticLegend = { tokenTypes: ['concept', 'bracket', 'comment'], tokenModifiers: [] };
    responses['textDocument/semanticTokens/full'] = {
      data: [0, 0, 6, 0, 0, 0, 7, 1, 1, 0, 1, 0, 9, 2, 0],
    };
    await build();
    const model: unknown = { uri: { toString: (): string => MODEL_URI } };
    const tokens: { data: Uint32Array } | undefined =
      await captured.semantic?.provideDocumentSemanticTokens(model);

    // Fixed legend: type=1, comment=17. The dropped bracket leaves the comment on the next line.
    expect([...(tokens?.data ?? [])]).toEqual([0, 0, 6, 1, 0, 1, 0, 9, 17, 0]);
  });

  describe("rust-analyzer's own navigations (#1210)", () => {
    const POSITION: { lineNumber: number; column: number } = { lineNumber: 3, column: 5 };
    const MODEL: unknown = {
      uri: { toString: (): string => MODEL_URI },
      getValue: (): string => '',
    };

    it('parentModules_asksByDocumentAndPosition_takingALocationOrALink', async () => {
      navigationSupport = {
        declaration: false,
        sourceHeader: false,
        implementation: false,
        typeDefinition: false,
        callHierarchy: false,
        typeHierarchy: false,
        parentModule: true,
      };
      responses['experimental/parentModule'] = [
        {
          targetUri: 'file:///root/Cargo.toml',
          targetRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          targetSelectionRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
      ];
      const features: LspFeatures = await build();

      const places: unknown = await features.parentModules(MODEL as never, POSITION);

      expect(places).toMatchObject([{ path: '/root/Cargo.toml' }]);
      expect(requests.at(-1)?.params).toEqual({
        textDocument: { uri: 'file:///root/app.ts' },
        position: { line: 2, character: 4 },
      });
    });

    it('cargoManifests_asksByDocument', async () => {
      navigationSupport = {
        declaration: false,
        sourceHeader: false,
        implementation: false,
        typeDefinition: false,
        callHierarchy: false,
        typeHierarchy: false,
        cargoManifest: true,
      };
      responses['experimental/openCargoToml'] = {
        uri: 'file:///root/Cargo.toml',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };
      const features: LspFeatures = await build();

      expect(await features.cargoManifests(MODEL as never)).toMatchObject([
        { path: '/root/Cargo.toml' },
      ]);
    });

    it('anotherServer_isAskedNeither', async () => {
      navigationSupport = {
        declaration: false,
        sourceHeader: false,
        implementation: true,
        typeDefinition: true,
        callHierarchy: true,
        typeHierarchy: true,
      };
      const features: LspFeatures = await build();

      expect(features.servesParentModule(MODEL as never)).toBe(false);
      expect(features.servesCargoManifest(MODEL as never)).toBe(false);
      expect(await features.parentModules(MODEL as never, POSITION)).toBeNull();
      expect(await features.cargoManifests(MODEL as never)).toBeNull();
    });
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

  it('semanticTokens_whenSemanticHighlightingIsOff_makesNoRequest', async () => {
    semanticLegend = { tokenTypes: ['class'], tokenModifiers: [] };
    responses['textDocument/semanticTokens/full'] = { data: [0, 0, 1, 0, 0] };
    semanticHighlightingOn = false;
    await build();
    const model: unknown = fakeModel(MODEL_URI, 'typescript', 'Widget');
    const tokens: unknown = await captured.semantic?.provideDocumentSemanticTokens(model);
    semanticHighlightingOn = true;

    expect(requests).toHaveLength(0);
    expect(tokens).toBeUndefined();
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
