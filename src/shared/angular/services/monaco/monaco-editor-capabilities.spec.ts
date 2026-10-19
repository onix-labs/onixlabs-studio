import type * as MonacoApi from 'monaco-editor';
import {
  captureEditorCapabilities,
  hasComments,
  hasDefinitionProvider,
  hasReferenceProvider,
  hasRenameProvider,
  providedDefinitions,
  providedReferences,
  ProvidedRename,
  providedRenameEdits,
  providedRenameLocation,
} from './monaco-editor-capabilities';

/**
 * A fake Monaco instance: a languages namespace whose registrations record what they are given, and a
 * cancellation token source.
 */
interface FakeMonaco {
  readonly monaco: typeof MonacoApi;
  readonly definitionProviders: MonacoApi.languages.DefinitionProvider[];
  readonly referenceProviders: MonacoApi.languages.ReferenceProvider[];
  readonly renameProviders: MonacoApi.languages.RenameProvider[];
  readonly configurations: string[];
}

/**
 * Builds a fake Monaco instance.
 * @returns Returns it, with what its original registrations were given.
 */
function fakeMonaco(): FakeMonaco {
  const definitionProviders: MonacoApi.languages.DefinitionProvider[] = [];
  const referenceProviders: MonacoApi.languages.ReferenceProvider[] = [];
  const renameProviders: MonacoApi.languages.RenameProvider[] = [];
  const configurations: string[] = [];
  const monaco: typeof MonacoApi = {
    languages: {
      registerDefinitionProvider: (
        _selector: MonacoApi.languages.LanguageSelector,
        provider: MonacoApi.languages.DefinitionProvider,
      ): MonacoApi.IDisposable => {
        definitionProviders.push(provider);
        return { dispose: (): void => undefined };
      },
      registerReferenceProvider: (
        _selector: MonacoApi.languages.LanguageSelector,
        provider: MonacoApi.languages.ReferenceProvider,
      ): MonacoApi.IDisposable => {
        referenceProviders.push(provider);
        return { dispose: (): void => undefined };
      },
      registerRenameProvider: (
        _selector: MonacoApi.languages.LanguageSelector,
        provider: MonacoApi.languages.RenameProvider,
      ): MonacoApi.IDisposable => {
        renameProviders.push(provider);
        return { dispose: (): void => undefined };
      },
      setLanguageConfiguration: (languageId: string): MonacoApi.IDisposable => {
        configurations.push(languageId);
        return { dispose: (): void => undefined };
      },
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
  return { monaco, definitionProviders, referenceProviders, renameProviders, configurations };
}

/**
 * Builds a model of the given language and URI.
 * @param language The language identifier.
 * @returns Returns the model.
 */
function modelOf(language: string): MonacoApi.editor.ITextModel {
  return { getLanguageId: (): string => language } as unknown as MonacoApi.editor.ITextModel;
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

describe('monaco-editor-capabilities', () => {
  it('capture_recordsDefinitionProviders_andStillRegistersThem', () => {
    const fake: FakeMonaco = fakeMonaco();
    captureEditorCapabilities(fake.monaco);
    const provider: MonacoApi.languages.DefinitionProvider = {
      provideDefinition: (): null => null,
    };

    const disposable: MonacoApi.IDisposable = fake.monaco.languages.registerDefinitionProvider(
      ['typescript', { language: 'javascript' }],
      provider,
    );

    expect(fake.definitionProviders).toEqual([provider]);
    expect(hasDefinitionProvider(fake.monaco, 'typescript')).toBe(true);
    expect(hasDefinitionProvider(fake.monaco, 'javascript')).toBe(true);
    expect(hasDefinitionProvider(fake.monaco, 'plaintext')).toBe(false);
    disposable.dispose();
    expect(hasDefinitionProvider(fake.monaco, 'typescript')).toBe(false);
  });

  it('capture_recordsCommentRules_andStillSetsTheConfiguration', () => {
    const fake: FakeMonaco = fakeMonaco();
    captureEditorCapabilities(fake.monaco);

    fake.monaco.languages.setLanguageConfiguration('typescript', {
      comments: { lineComment: '//' },
    });
    fake.monaco.languages.setLanguageConfiguration('html', {
      comments: { blockComment: ['<!--', '-->'] },
    });
    const brackets: MonacoApi.IDisposable = fake.monaco.languages.setLanguageConfiguration(
      'plaintext',
      { brackets: [['(', ')']] },
    );

    expect(fake.configurations).toEqual(['typescript', 'html', 'plaintext']);
    expect(hasComments(fake.monaco, 'typescript')).toBe(true);
    // A block comment alone still comments a line: Monaco wraps it.
    expect(hasComments(fake.monaco, 'html')).toBe(true);
    expect(hasComments(fake.monaco, 'plaintext')).toBe(false);
    expect(hasComments(fake.monaco, 'never-configured')).toBe(false);
    expect((): void => brackets.dispose()).not.toThrow();
  });

  it('capture_onceOnly_soASecondCaptureDoesNotWrapTwice', () => {
    const fake: FakeMonaco = fakeMonaco();
    captureEditorCapabilities(fake.monaco);
    captureEditorCapabilities(fake.monaco);

    fake.monaco.languages.registerDefinitionProvider('typescript', {
      provideDefinition: (): null => null,
    });

    expect(fake.definitionProviders.length).toBe(1);
  });

  it('providedDefinitions_newestFirst_skippingProvidersThatAnswerNothing_linksByTheirName', async () => {
    const fake: FakeMonaco = fakeMonaco();
    captureEditorCapabilities(fake.monaco);
    const uri: MonacoApi.Uri = { toString: (): string => 'inmemory://model/1' } as MonacoApi.Uri;
    fake.monaco.languages.registerDefinitionProvider('typescript', {
      provideDefinition: (): MonacoApi.languages.Location => ({ uri, range: span(9, 1, 2) }),
    });
    fake.monaco.languages.registerDefinitionProvider('typescript', {
      provideDefinition: (): MonacoApi.languages.LocationLink[] => [
        { uri, range: span(3, 1, 30), targetSelectionRange: span(3, 7, 14) },
      ],
    });
    fake.monaco.languages.registerDefinitionProvider('typescript', {
      provideDefinition: (): null => null,
    });

    const found: readonly MonacoApi.languages.Location[] = await providedDefinitions(
      fake.monaco,
      modelOf('typescript'),
      { lineNumber: 1, column: 1 },
    );

    expect(found).toEqual([{ uri, range: span(3, 7, 14) }]);
  });

  it('providedDefinitions_isEmpty_forALanguageNoProviderServes_orWhenAProviderFails', async () => {
    const fake: FakeMonaco = fakeMonaco();
    captureEditorCapabilities(fake.monaco);
    fake.monaco.languages.registerDefinitionProvider('typescript', {
      provideDefinition: (): never => {
        throw new Error('worker gone');
      },
    });

    expect(
      await providedDefinitions(fake.monaco, modelOf('typescript'), { lineNumber: 1, column: 1 }),
    ).toEqual([]);
    expect(
      await providedDefinitions(fake.monaco, modelOf('rust'), { lineNumber: 1, column: 1 }),
    ).toEqual([]);
  });

  it('capture_recordsReferenceProviders_andStillRegistersThem', () => {
    const fake: FakeMonaco = fakeMonaco();
    captureEditorCapabilities(fake.monaco);
    const provider: MonacoApi.languages.ReferenceProvider = {
      provideReferences: (): null => null,
    };

    const disposable: MonacoApi.IDisposable = fake.monaco.languages.registerReferenceProvider(
      'typescript',
      provider,
    );

    expect(fake.referenceProviders).toEqual([provider]);
    expect(hasReferenceProvider(fake.monaco, 'typescript')).toBe(true);
    expect(hasReferenceProvider(fake.monaco, 'rust')).toBe(false);
    disposable.dispose();
    expect(hasReferenceProvider(fake.monaco, 'typescript')).toBe(false);
  });

  it('providedReferences_newestFirst_includingTheDeclaration_skippingEmptyAndFailingProviders', async () => {
    const fake: FakeMonaco = fakeMonaco();
    captureEditorCapabilities(fake.monaco);
    const uri: MonacoApi.Uri = { toString: (): string => 'inmemory://model/1' } as MonacoApi.Uri;
    const contexts: MonacoApi.languages.ReferenceContext[] = [];
    fake.monaco.languages.registerReferenceProvider('typescript', {
      provideReferences: (
        _model: MonacoApi.editor.ITextModel,
        _position: MonacoApi.Position,
        context: MonacoApi.languages.ReferenceContext,
      ): MonacoApi.languages.Location[] => {
        contexts.push(context);
        return [
          { uri, range: span(2, 5, 8) },
          { uri, range: span(7, 1, 4) },
        ];
      },
    });
    fake.monaco.languages.registerReferenceProvider('typescript', {
      provideReferences: (): never => {
        throw new Error('worker gone');
      },
    });
    fake.monaco.languages.registerReferenceProvider('typescript', {
      provideReferences: (): MonacoApi.languages.Location[] => [],
    });

    const found: readonly MonacoApi.languages.Location[] = await providedReferences(
      fake.monaco,
      modelOf('typescript'),
      { lineNumber: 2, column: 6 },
    );

    expect(found).toEqual([
      { uri, range: span(2, 5, 8) },
      { uri, range: span(7, 1, 4) },
    ]);
    expect(contexts).toEqual([{ includeDeclaration: true }]);
    expect(
      await providedReferences(fake.monaco, modelOf('rust'), { lineNumber: 1, column: 1 }),
    ).toEqual([]);
  });

  describe('rename providers (#1015)', () => {
    /**
     * Builds a model with a word at every position.
     * @param language The language identifier.
     * @returns Returns the model.
     */
    function wordyModel(language: string): MonacoApi.editor.ITextModel {
      return {
        getLanguageId: (): string => language,
        getWordAtPosition: (): MonacoApi.editor.IWordAtPosition => ({
          word: 'greet',
          startColumn: 3,
          endColumn: 8,
        }),
      } as unknown as MonacoApi.editor.ITextModel;
    }

    /**
     * Builds a URI that prints as given.
     * @param value The URI.
     * @returns Returns it.
     */
    function uri(value: string): MonacoApi.Uri {
      return { toString: (): string => value } as unknown as MonacoApi.Uri;
    }

    it('capture_recordsRenameProviders_andStillRegistersThem_untilDisposed', () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      const provider: MonacoApi.languages.RenameProvider = {
        provideRenameEdits: (): null => null,
      };

      const registration: MonacoApi.IDisposable = fake.monaco.languages.registerRenameProvider(
        'typescript',
        provider,
      );

      expect(fake.renameProviders).toEqual([provider]);
      expect(hasRenameProvider(fake.monaco, 'typescript')).toBe(true);
      expect(hasRenameProvider(fake.monaco, 'python')).toBe(false);
      registration.dispose();
      expect(hasRenameProvider(fake.monaco, 'typescript')).toBe(false);
    });

    it('providedRenameLocation_asksTheNewestProvider_readsARejection_andFallsBackToTheWord', async () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      expect(
        await providedRenameLocation(fake.monaco, wordyModel('typescript'), {
          lineNumber: 2,
          column: 4,
        }),
      ).toBeNull();

      fake.monaco.languages.registerRenameProvider('typescript', {
        provideRenameEdits: (): null => null,
      });
      expect(
        await providedRenameLocation(fake.monaco, wordyModel('typescript'), {
          lineNumber: 2,
          column: 4,
        }),
      ).toEqual({ kind: 'ready', range: span(2, 3, 8), placeholder: 'greet' });

      fake.monaco.languages.registerRenameProvider('typescript', {
        provideRenameEdits: (): null => null,
        resolveRenameLocation: (): MonacoApi.languages.RenameLocation &
          MonacoApi.languages.Rejection => ({
          range: span(2, 1, 1),
          text: '',
          rejectReason: 'You cannot rename a keyword.',
        }),
      });
      expect(
        await providedRenameLocation(fake.monaco, wordyModel('typescript'), {
          lineNumber: 2,
          column: 4,
        }),
      ).toEqual({ kind: 'refused', reason: 'You cannot rename a keyword.' });
    });

    it('providedRenameEdits_groupsTheEditsByModel_countingFileOperations', async () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      fake.monaco.languages.registerRenameProvider('typescript', {
        provideRenameEdits: (): MonacoApi.languages.WorkspaceEdit => ({
          edits: [
            {
              resource: uri('inmemory://model/1'),
              textEdit: { range: span(1, 1, 6), text: 'salute' },
              versionId: 1,
            },
            {
              resource: uri('inmemory://model/2'),
              textEdit: { range: span(4, 2, 7), text: 'salute' },
              versionId: undefined,
            },
            {
              resource: uri('inmemory://model/1'),
              textEdit: { range: span(9, 1, 6), text: 'salute' },
              versionId: 1,
            },
            { oldResource: uri('inmemory://model/1'), newResource: uri('inmemory://model/3') },
          ],
        }),
      });

      const answer: ProvidedRename | null = await providedRenameEdits(
        fake.monaco,
        wordyModel('typescript'),
        { lineNumber: 1, column: 2 },
        'salute',
      );

      expect(answer).toEqual({
        kind: 'edits',
        files: [
          {
            uri: 'inmemory://model/1',
            edits: [
              { range: span(1, 1, 6), text: 'salute' },
              { range: span(9, 1, 6), text: 'salute' },
            ],
          },
          { uri: 'inmemory://model/2', edits: [{ range: span(4, 2, 7), text: 'salute' }] },
        ],
        fileOperations: 1,
      });
    });

    it('providedRenameEdits_readsARejection_andIsNullWithNoProvider', async () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      expect(
        await providedRenameEdits(
          fake.monaco,
          wordyModel('typescript'),
          { lineNumber: 1, column: 1 },
          'x',
        ),
      ).toBeNull();
      fake.monaco.languages.registerRenameProvider('typescript', {
        provideRenameEdits: (): MonacoApi.languages.WorkspaceEdit &
          MonacoApi.languages.Rejection => ({
          edits: [],
          rejectReason: 'Not a valid name.',
        }),
      });

      expect(
        await providedRenameEdits(
          fake.monaco,
          wordyModel('typescript'),
          { lineNumber: 1, column: 1 },
          '1x',
        ),
      ).toEqual({ kind: 'refused', reason: 'Not a valid name.' });
    });
  });
});
