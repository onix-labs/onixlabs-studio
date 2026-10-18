import type * as MonacoApi from 'monaco-editor';
import {
  captureEditorCapabilities,
  hasComments,
  hasDefinitionProvider,
  providedDefinitions,
} from './monaco-editor-capabilities';

/**
 * A fake Monaco instance: a languages namespace whose registrations record what they are given, and a
 * cancellation token source.
 */
interface FakeMonaco {
  readonly monaco: typeof MonacoApi;
  readonly definitionProviders: MonacoApi.languages.DefinitionProvider[];
  readonly configurations: string[];
}

/**
 * Builds a fake Monaco instance.
 * @returns Returns it, with what its original registrations were given.
 */
function fakeMonaco(): FakeMonaco {
  const definitionProviders: MonacoApi.languages.DefinitionProvider[] = [];
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
  return { monaco, definitionProviders, configurations };
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
});
