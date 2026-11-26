import type * as MonacoApi from 'monaco-editor';
import { markStudioProvider } from './monaco-editor-capabilities';
import {
  builtInFormattingEdits,
  captureBuiltInFormatters,
  setFormattingOverride,
} from './monaco-formatting-route';

/**
 * A fake of the formatting registration functions of Monaco's languages API: it keeps the providers
 * Monaco would run, newest last.
 */
class FakeLanguages {
  public readonly documents: MonacoApi.languages.DocumentFormattingEditProvider[] = [];
  public readonly ranges: MonacoApi.languages.DocumentRangeFormattingEditProvider[] = [];

  /**
   * Registers a whole-document formatter.
   * @param _selector The language selector.
   * @param provider The provider.
   * @returns Returns a disposable that removes it.
   */
  public registerDocumentFormattingEditProvider(
    _selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DocumentFormattingEditProvider,
  ): MonacoApi.IDisposable {
    this.documents.push(provider);
    return {
      dispose: (): void => void this.documents.splice(this.documents.indexOf(provider), 1),
    };
  }

  /**
   * Registers a range formatter.
   * @param _selector The language selector.
   * @param provider The provider.
   * @returns Returns a disposable that removes it.
   */
  public registerDocumentRangeFormattingEditProvider(
    _selector: MonacoApi.languages.LanguageSelector,
    provider: MonacoApi.languages.DocumentRangeFormattingEditProvider,
  ): MonacoApi.IDisposable {
    this.ranges.push(provider);
    return { dispose: (): void => void this.ranges.splice(this.ranges.indexOf(provider), 1) };
  }
}

/**
 * Builds an edit whose text names who made it.
 * @param text The text.
 * @returns Returns the edit.
 */
function edit(text: string): MonacoApi.languages.TextEdit {
  return { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text };
}

/**
 * Builds a stand-in JSON model.
 * @param name The model's name, to tell models apart.
 * @returns Returns the model.
 */
function jsonModel(name: string): MonacoApi.editor.ITextModel {
  const model: unknown = { name, getLanguageId: (): string => 'json' };
  return model as MonacoApi.editor.ITextModel;
}

describe('monaco formatting route (#1214)', () => {
  const OPTIONS: MonacoApi.languages.FormattingOptions = { tabSize: 2, insertSpaces: true };
  const TOKEN: MonacoApi.CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
  };
  const served: MonacoApi.editor.ITextModel = jsonModel('served');
  const unsaved: MonacoApi.editor.ITextModel = jsonModel('unsaved');
  let languages: FakeLanguages;
  let monaco: typeof MonacoApi;

  beforeEach(() => {
    languages = new FakeLanguages();
    monaco = { languages } as unknown as typeof MonacoApi;
    captureBuiltInFormatters(monaco);
    // Monaco's own JSON formatter.
    monaco.languages.registerDocumentFormattingEditProvider('json', {
      provideDocumentFormattingEdits: (): MonacoApi.languages.TextEdit[] => [edit('monaco')],
    });
    monaco.languages.registerDocumentRangeFormattingEditProvider('json', {
      provideDocumentRangeFormattingEdits: (): MonacoApi.languages.TextEdit[] => [
        edit('monaco range'),
      ],
    });
    setFormattingOverride(
      monaco,
      (
        model: MonacoApi.editor.ITextModel,
      ): Promise<MonacoApi.languages.TextEdit[] | undefined> | undefined =>
        model === served ? Promise.resolve([edit('server')]) : undefined,
    );
  });

  it('monacosOwnFormatter_handsAModelAServerFormats_toTheServer', async () => {
    const [registered] = languages.documents;

    expect(await registered.provideDocumentFormattingEdits(served, OPTIONS, TOKEN)).toEqual([
      edit('server'),
    ]);
    expect(await registered.provideDocumentFormattingEdits(unsaved, OPTIONS, TOKEN)).toEqual([
      edit('monaco'),
    ]);
  });

  it('builtInFormattingEdits_formatsWithMonacosOwn_wholeOrARange', async () => {
    expect(await builtInFormattingEdits(monaco, unsaved, OPTIONS, TOKEN, undefined)).toEqual([
      edit('monaco'),
    ]);
    const range: unknown = { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 };
    expect(
      await builtInFormattingEdits(monaco, unsaved, OPTIONS, TOKEN, range as MonacoApi.Range),
    ).toEqual([edit('monaco range')]);
  });

  it('studiosOwnFormatter_isRegisteredUntouched_andNeverTakenForMonacos', async () => {
    const studio: MonacoApi.languages.DocumentFormattingEditProvider = {
      provideDocumentFormattingEdits: (): MonacoApi.languages.TextEdit[] => [edit('studio')],
    };
    markStudioProvider(studio);

    monaco.languages.registerDocumentFormattingEditProvider('json', studio);

    expect(languages.documents.at(-1)).toBe(studio);
    expect(await builtInFormattingEdits(monaco, unsaved, OPTIONS, TOKEN, undefined)).toEqual([
      edit('monaco'),
    ]);
  });

  it('builtInFormattingEdits_isUndefined_forALanguageMonacoDoesNotFormat', async () => {
    const css: unknown = { getLanguageId: (): string => 'css' };

    expect(
      await builtInFormattingEdits(
        monaco,
        css as MonacoApi.editor.ITextModel,
        OPTIONS,
        TOKEN,
        undefined,
      ),
    ).toBeUndefined();
  });
});
