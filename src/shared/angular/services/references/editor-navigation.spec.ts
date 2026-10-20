import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { Mock, MockInstance } from 'vitest';
import { Editors } from '@shared/angular/services/editors/editors';
import { LspDefinition, LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import { captureEditorCapabilities } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { EditorNavigation } from './editor-navigation';
import { ReferenceItem, ReferenceList } from './reference-list';
import { ReferencesRouter } from './references-router';

/**
 * The model URI of the editor under test.
 */
const MODEL_URI: string = 'inmemory://model/1';

/**
 * The lines of the editor's model.
 */
const LINES: readonly string[] = [
  'class Greeter {',
  '  greet(): void {}',
  '}',
  'new Greeter().greet();',
];

/**
 * A stand-in editor and what was done to it.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly model: MonacoApi.editor.ITextModel;
  readonly calls: string[];
}

/**
 * Builds a range on one line.
 * @param line The line.
 * @param start The first column.
 * @param end The column after the last.
 * @returns Returns the range.
 */
function span(line: number, start: number, end: number): MonacoApi.IRange {
  return { startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end };
}

/**
 * Builds a stand-in editor, its caret on `greet` in line 2.
 * @returns Returns the editor, its model and its recorder.
 */
function fakeEditor(): FakeEditor {
  const calls: string[] = [];
  const model: unknown = {
    uri: { toString: (): string => MODEL_URI },
    getLanguageId: (): string => 'typescript',
    isDisposed: (): boolean => false,
    getLinesContent: (): string[] => [...LINES],
    getWordAtPosition: (): MonacoApi.editor.IWordAtPosition => ({
      word: 'greet',
      startColumn: 3,
      endColumn: 8,
    }),
  };
  const container: HTMLElement = document.createElement('div');
  const editor: unknown = {
    getModel: (): unknown => model,
    getPosition: (): MonacoApi.IPosition => ({ lineNumber: 2, column: 4 }),
    getContainerDomNode: (): HTMLElement => container,
    layout: (): void => undefined,
    setSelection: (range: MonacoApi.IRange): void =>
      void calls.push(
        `select ${range.startLineNumber}:${range.startColumn}-${range.endLineNumber}:${range.endColumn}`,
      ),
    revealRangeInCenter: (range: MonacoApi.IRange): void =>
      void calls.push(`centre ${range.startLineNumber}:${range.startColumn}`),
    setPosition: (position: MonacoApi.IPosition): void =>
      void calls.push(`position ${position.lineNumber}:${position.column}`),
    revealPositionInCenter: (position: MonacoApi.IPosition): void =>
      void calls.push(`centre ${position.lineNumber}:${position.column}`),
    focus: (): void => void calls.push('focus'),
  };
  return {
    editor: editor as MonacoApi.editor.ICodeEditor,
    model: model as MonacoApi.editor.ITextModel,
    calls,
  };
}

/**
 * Builds a fake Monaco instance for the editor's window, prepared as the real one is, holding the
 * given models.
 * @param models The models of the open editors.
 * @returns Returns the instance.
 */
function fakeMonaco(models: readonly MonacoApi.editor.ITextModel[]): typeof MonacoApi {
  const monaco: typeof MonacoApi = {
    editor: { getModels: (): readonly MonacoApi.editor.ITextModel[] => models },
    languages: {
      registerDefinitionProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      registerReferenceProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      registerRenameProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      registerCodeActionProvider: (): MonacoApi.IDisposable => ({
        dispose: (): void => undefined,
      }),
      registerHoverProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      registerColorProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      setLanguageConfiguration: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
    },
    CancellationTokenSource: class {
      public readonly token: MonacoApi.CancellationToken = {
        isCancellationRequested: false,
      } as MonacoApi.CancellationToken;
      public dispose(): void {
        // Nothing to release.
      }
    },
  } as unknown as typeof MonacoApi;
  captureEditorCapabilities(monaco);
  return monaco;
}

describe('EditorNavigation (#1014)', () => {
  let fake: FakeEditor;
  let monaco: typeof MonacoApi;
  let lsp: {
    servesDocument: Mock<LspFeatures['servesDocument']>;
    definitions: Mock<LspFeatures['definitions']>;
    references: Mock<LspFeatures['references']>;
  };
  let opener: Mock<(path: string) => Promise<boolean>>;
  let shown: ReferenceList[];

  /**
   * Builds the service, its editor attached to a tab whose References panel records what it is shown.
   * @param attached Whether a panel answers the editor.
   * @returns Returns the service.
   */
  function build(attached: boolean = true): EditorNavigation {
    TestBed.configureTestingModule({ providers: [{ provide: LspFeatures, useValue: lsp }] });
    const navigation: EditorNavigation = TestBed.inject(EditorNavigation);
    navigation.useFileOpener(opener);
    if (attached) {
      TestBed.inject(ReferencesRouter).attach(fake.editor, {
        openReferences: (list: ReferenceList): void => void shown.push(list),
      });
    }
    return navigation;
  }

  beforeEach(() => {
    fake = fakeEditor();
    monaco = fakeMonaco([fake.model]);
    (window as unknown as { monaco?: unknown }).monaco = monaco;
    lsp = {
      servesDocument: vi.fn<LspFeatures['servesDocument']>((): boolean => false),
      definitions: vi.fn<LspFeatures['definitions']>((): Promise<readonly LspDefinition[] | null> =>
        Promise.resolve(null),
      ),
      references: vi.fn<LspFeatures['references']>((): Promise<readonly ReferenceItem[] | null> =>
        Promise.resolve(null),
      ),
    };
    opener = vi.fn<(path: string) => Promise<boolean>>((): Promise<boolean> =>
      Promise.resolve(true),
    );
    shown = [];
  });

  afterEach(() => {
    delete (window as unknown as { monaco?: unknown }).monaco;
  });

  describe('find all references', () => {
    it('fromTheLanguageServer_revealsThePanelSearching_thenFillsIt', async () => {
      const navigation: EditorNavigation = build();
      const found: readonly ReferenceItem[] = [
        { path: '/root/app.ts', range: span(2, 3, 8), preview: '  greet(): void {}' },
        { path: '/root/lib/use.ts', range: span(9, 1, 6), preview: 'greet();' },
      ];
      lsp.references.mockResolvedValue(found);

      await navigation.findReferences(fake.editor);

      expect(lsp.references).toHaveBeenCalledWith(fake.model, { lineNumber: 2, column: 4 });
      expect(shown).toEqual([
        { kind: 'references', symbol: 'greet', status: 'searching', items: [] },
        { kind: 'references', symbol: 'greet', status: 'done', items: found },
      ]);
    });

    it('aNewerSearch_replacesAnOlderOne_whoseLateAnswerIsDropped', async () => {
      const navigation: EditorNavigation = build();
      let answerFirst: (items: readonly ReferenceItem[]) => void = (): void => undefined;
      lsp.references
        .mockImplementationOnce(
          (): Promise<readonly ReferenceItem[]> =>
            new Promise<readonly ReferenceItem[]>((resolve) => {
              answerFirst = resolve;
            }),
        )
        .mockResolvedValueOnce([]);

      const first: Promise<void> = navigation.findReferences(fake.editor);
      await navigation.findReferences(fake.editor);
      answerFirst([{ path: '/stale.ts', range: span(1, 1, 2), preview: '' }]);
      await first;

      expect(shown.map((list: ReferenceList): string => list.status)).toEqual([
        'searching',
        'searching',
        'done',
      ]);
      expect(shown.at(-1)?.items).toEqual([]);
    });

    it('noServer_asksMonacosReferenceProviders_previewingTheirLinesFromTheModels', async () => {
      const navigation: EditorNavigation = build();
      TestBed.inject(Editors).register(MODEL_URI, {
        documentId: 'doc-1',
        path: '/root/app.ts',
        name: 'app.ts',
      });
      monaco.languages.registerReferenceProvider('typescript', {
        provideReferences: (): MonacoApi.languages.Location[] => [
          { uri: fake.model.uri, range: span(2, 3, 8) },
          { uri: fake.model.uri, range: span(4, 15, 20) },
        ],
      });

      await navigation.findReferences(fake.editor);

      expect(shown.at(-1)).toEqual({
        kind: 'references',
        symbol: 'greet',
        status: 'done',
        items: [
          { path: '/root/app.ts', range: span(2, 3, 8), preview: '  greet(): void {}' },
          { path: '/root/app.ts', range: span(4, 15, 20), preview: 'new Greeter().greet();' },
        ],
      });
    });

    it('nothingServesTheLanguage_saysSo', async () => {
      const navigation: EditorNavigation = build();

      await navigation.findReferences(fake.editor);

      expect(shown.at(-1)).toMatchObject({ status: 'unavailable', items: [] });
    });

    it('noPanelAnswers_searchesNothing', async () => {
      const navigation: EditorNavigation = build(false);

      await navigation.findReferences(fake.editor);

      expect(lsp.references).not.toHaveBeenCalled();
      expect(shown).toEqual([]);
    });

    it('offersReferences_whereAProviderServesTheLanguage_orAServerTheDocument', () => {
      const navigation: EditorNavigation = build();

      expect(navigation.offersReferences(fake.editor)).toBe(false);
      lsp.servesDocument.mockReturnValue(true);
      expect(navigation.offersReferences(fake.editor)).toBe(true);
      lsp.servesDocument.mockReturnValue(false);
      monaco.languages.registerReferenceProvider('typescript', { provideReferences: () => [] });
      expect(navigation.offersReferences(fake.editor)).toBe(true);
    });
  });

  describe('go to a listed place', () => {
    it('inTheEditorsOwnDocument_selectsItsSpan_centred_andFocused', async () => {
      const navigation: EditorNavigation = build();
      TestBed.inject(Editors).register(MODEL_URI, {
        documentId: 'doc-1',
        path: '/root/app.ts',
        name: 'app.ts',
      });

      await navigation.goTo(fake.editor, { path: '/root/app.ts', range: span(4, 15, 20) }, true);

      expect(fake.calls).toEqual(['select 4:15-4:20', 'centre 4:15', 'focus']);
      expect(opener).not.toHaveBeenCalled();
    });

    it('inAnotherFile_fromAPanel_opensIt_thenSelectsTheSpanInItsEditor', async () => {
      const navigation: EditorNavigation = build();
      const editors: Editors = TestBed.inject(Editors);
      opener.mockImplementation((): Promise<boolean> => {
        editors.register('inmemory://model/2', {
          documentId: 'doc-2',
          path: '/root/lib/use.ts',
          name: 'use.ts',
        });
        return Promise.resolve(true);
      });
      const reveal: MockInstance<Editors['requestReveal']> = vi.spyOn(editors, 'requestReveal');

      await navigation.goTo(null, { path: '/root/lib/use.ts', range: span(9, 1, 6) }, true);

      expect(opener).toHaveBeenCalledWith('/root/lib/use.ts');
      expect(reveal).toHaveBeenCalledWith('doc-2', 9, 1, 6);
    });

    it('aDocumentWithNoFile_namedByItsModel_isRevealedWithoutOpeningAnything', async () => {
      const navigation: EditorNavigation = build();
      const editors: Editors = TestBed.inject(Editors);
      editors.register('inmemory://model/7', { documentId: 'doc-7', path: null, name: 'Untitled' });
      const reveal: MockInstance<Editors['requestReveal']> = vi.spyOn(editors, 'requestReveal');

      await navigation.goTo(null, { path: 'inmemory://model/7', range: span(3, 2, 4) }, true);

      expect(opener).not.toHaveBeenCalled();
      expect(reveal).toHaveBeenCalledWith('doc-7', 3, 2, 4);
    });
  });
});
