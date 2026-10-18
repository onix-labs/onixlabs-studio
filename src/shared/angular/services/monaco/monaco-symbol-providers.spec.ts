import type * as MonacoApi from 'monaco-editor';
import type { CodeSymbol } from '@shared/angular/services/lsp/lsp-symbols';
import { captureDocumentSymbolProviders, providedDocumentSymbols } from './monaco-symbol-providers';

/**
 * A fake Monaco instance: a languages namespace whose registration records what it is given, and a
 * cancellation token source.
 */
interface FakeMonaco {
  readonly monaco: typeof MonacoApi;
  readonly registered: MonacoApi.languages.DocumentSymbolProvider[];
  readonly disposed: number[];
}

/**
 * Builds a fake Monaco instance.
 * @returns Returns it, with what its original registration was given.
 */
function fakeMonaco(): FakeMonaco {
  const registered: MonacoApi.languages.DocumentSymbolProvider[] = [];
  const disposed: number[] = [];
  const monaco: typeof MonacoApi = {
    languages: {
      registerDocumentSymbolProvider: (
        _selector: MonacoApi.languages.LanguageSelector,
        provider: MonacoApi.languages.DocumentSymbolProvider,
      ): MonacoApi.IDisposable => {
        registered.push(provider);
        return { dispose: (): void => void disposed.push(registered.indexOf(provider)) };
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
  return { monaco, registered, disposed };
}

/**
 * Builds a model of the given language.
 * @param language The language identifier.
 * @returns Returns the model.
 */
function modelOf(language: string): MonacoApi.editor.ITextModel {
  return { getLanguageId: (): string => language } as unknown as MonacoApi.editor.ITextModel;
}

/**
 * Builds a provider that answers with one symbol of the given name.
 * @param name The symbol's name, or null to answer nothing.
 * @returns Returns the provider.
 */
function providerOf(name: string | null): MonacoApi.languages.DocumentSymbolProvider {
  return {
    provideDocumentSymbols: (): MonacoApi.languages.DocumentSymbol[] | undefined =>
      name === null
        ? undefined
        : [
            {
              name,
              detail: '',
              kind: 4, // Monaco's Class, numbered from zero.
              tags: [],
              range: { startLineNumber: 2, startColumn: 1, endLineNumber: 9, endColumn: 2 },
              selectionRange: {
                startLineNumber: 2,
                startColumn: 7,
                endLineNumber: 2,
                endColumn: 14,
              },
              children: [],
            },
          ],
  };
}

describe('captureDocumentSymbolProviders', () => {
  it('stillRegistersWithMonaco_andRecordsTheProvider_forProvidedDocumentSymbols', async () => {
    const fake: FakeMonaco = fakeMonaco();
    captureDocumentSymbolProviders(fake.monaco);
    const provider: MonacoApi.languages.DocumentSymbolProvider = providerOf('Greeter');

    fake.monaco.languages.registerDocumentSymbolProvider('typescript', provider);
    const symbols: readonly CodeSymbol[] | null = await providedDocumentSymbols(
      fake.monaco,
      modelOf('typescript'),
    );

    expect(fake.registered).toEqual([provider]);
    // Converted to the protocol's numbering: kinds from one, lines and characters from zero.
    expect(symbols).toEqual([
      {
        name: 'Greeter',
        kind: 5,
        range: { start: { line: 1, character: 0 }, end: { line: 8, character: 1 } },
        selectionRange: { start: { line: 1, character: 6 }, end: { line: 1, character: 13 } },
        children: [],
      },
    ]);
  });

  it('asksOnlyTheProvidersOfTheModelsLanguage', async () => {
    const fake: FakeMonaco = fakeMonaco();
    captureDocumentSymbolProviders(fake.monaco);
    fake.monaco.languages.registerDocumentSymbolProvider('json', providerOf('fromJson'));
    fake.monaco.languages.registerDocumentSymbolProvider(
      [{ language: 'css' }, 'scss'],
      providerOf('fromCss'),
    );

    expect((await providedDocumentSymbols(fake.monaco, modelOf('scss')))?.[0].name).toBe('fromCss');
    expect(await providedDocumentSymbols(fake.monaco, modelOf('python'))).toBeNull();
  });

  it('takesTheFirstProviderWithAnAnswer_latestRegisteredFirst', async () => {
    const fake: FakeMonaco = fakeMonaco();
    captureDocumentSymbolProviders(fake.monaco);
    fake.monaco.languages.registerDocumentSymbolProvider('typescript', providerOf('older'));
    fake.monaco.languages.registerDocumentSymbolProvider('typescript', providerOf(null));

    expect((await providedDocumentSymbols(fake.monaco, modelOf('typescript')))?.[0].name).toBe(
      'older',
    );
  });

  it('forgetsADisposedProvider', async () => {
    const fake: FakeMonaco = fakeMonaco();
    captureDocumentSymbolProviders(fake.monaco);
    const registration: MonacoApi.IDisposable =
      fake.monaco.languages.registerDocumentSymbolProvider('typescript', providerOf('gone'));

    registration.dispose();

    expect(fake.disposed).toEqual([0]);
    expect(await providedDocumentSymbols(fake.monaco, modelOf('typescript'))).toBeNull();
  });

  it('capturingTwice_recordsEachProviderOnce', async () => {
    const fake: FakeMonaco = fakeMonaco();
    captureDocumentSymbolProviders(fake.monaco);
    captureDocumentSymbolProviders(fake.monaco);
    fake.monaco.languages.registerDocumentSymbolProvider('typescript', providerOf('once'));

    expect(fake.registered).toHaveLength(1);
    expect(await providedDocumentSymbols(fake.monaco, modelOf('typescript'))).toHaveLength(1);
  });

  it('anInstanceNeverCaptured_hasNoProviders', async () => {
    expect(await providedDocumentSymbols(fakeMonaco().monaco, modelOf('typescript'))).toBeNull();
  });
});
