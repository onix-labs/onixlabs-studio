import type * as MonacoApi from 'monaco-editor';
import {
  captureEditorCapabilities,
  groupWorkspaceEdit,
  hasCodeActionProvider,
  markStudioProvider,
  ProvidedCodeActions,
  providedCodeActions,
  providedColourAt,
  providedColourEdits,
  ProvidedColour,
  resolveProvidedCodeAction,
  hasComments,
  hasDefinitionProvider,
  hasReferenceProvider,
  hasRenameProvider,
  providedDefinitions,
  ProvidedHover,
  providedHovers,
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
  readonly codeActionProviders: MonacoApi.languages.CodeActionProvider[];
  readonly hoverProviders: MonacoApi.languages.HoverProvider[];
  readonly colorProviders: MonacoApi.languages.DocumentColorProvider[];
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
  const codeActionProviders: MonacoApi.languages.CodeActionProvider[] = [];
  const hoverProviders: MonacoApi.languages.HoverProvider[] = [];
  const colorProviders: MonacoApi.languages.DocumentColorProvider[] = [];
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
      registerCodeActionProvider: (
        _selector: MonacoApi.languages.LanguageSelector,
        provider: MonacoApi.languages.CodeActionProvider,
      ): MonacoApi.IDisposable => {
        codeActionProviders.push(provider);
        return { dispose: (): void => undefined };
      },
      registerHoverProvider: (
        _selector: MonacoApi.languages.LanguageSelector,
        provider: MonacoApi.languages.HoverProvider,
      ): MonacoApi.IDisposable => {
        hoverProviders.push(provider);
        return { dispose: (): void => undefined };
      },
      registerColorProvider: (
        _selector: MonacoApi.languages.LanguageSelector,
        provider: MonacoApi.languages.DocumentColorProvider,
      ): MonacoApi.IDisposable => {
        colorProviders.push(provider);
        return { dispose: (): void => undefined };
      },
      setLanguageConfiguration: (languageId: string): MonacoApi.IDisposable => {
        configurations.push(languageId);
        return { dispose: (): void => undefined };
      },
      CodeActionTriggerType: { Invoke: 1, Auto: 2 },
    },
    Range: class {
      public constructor(
        public readonly startLineNumber: number,
        public readonly startColumn: number,
        public readonly endLineNumber: number,
        public readonly endColumn: number,
      ) {}
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
  return {
    monaco,
    definitionProviders,
    referenceProviders,
    renameProviders,
    codeActionProviders,
    hoverProviders,
    colorProviders,
    configurations,
  };
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

  describe('code actions (#1016)', () => {
    /**
     * Builds a code-action provider answering with the given actions, recording what it was asked.
     * @param actions The actions.
     * @param asked Records each context it is asked with.
     * @param released Counts how often its answer is released.
     * @returns Returns the provider.
     */
    function provider(
      actions: MonacoApi.languages.CodeAction[],
      asked: MonacoApi.languages.CodeActionContext[] = [],
      released: { count: number } = { count: 0 },
    ): MonacoApi.languages.CodeActionProvider {
      return {
        provideCodeActions: (
          _model: MonacoApi.editor.ITextModel,
          _range: MonacoApi.Range,
          context: MonacoApi.languages.CodeActionContext,
        ): MonacoApi.languages.CodeActionList => {
          asked.push(context);
          return { actions, dispose: (): void => void (released.count += 1) };
        },
      };
    }

    it('capture_recordsCodeActionProviders_butNotStudiosOwn_andStillRegistersThem', () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      const studios: MonacoApi.languages.CodeActionProvider = provider([]);
      markStudioProvider(studios);

      fake.monaco.languages.registerCodeActionProvider('csharp', studios);
      expect(hasCodeActionProvider(fake.monaco, 'csharp')).toBe(false);

      const disposable: MonacoApi.IDisposable = fake.monaco.languages.registerCodeActionProvider(
        'typescript',
        provider([]),
      );
      expect(fake.codeActionProviders).toHaveLength(2);
      expect(hasCodeActionProvider(fake.monaco, 'typescript')).toBe(true);
      disposable.dispose();
      expect(hasCodeActionProvider(fake.monaco, 'typescript')).toBe(false);
    });

    it('providedCodeActions_asksEveryProvider_newestFirst_withTheMarkersAndKind_andReleasesThem', async () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      const asked: MonacoApi.languages.CodeActionContext[] = [];
      const released: { count: number } = { count: 0 };
      fake.monaco.languages.registerCodeActionProvider(
        'typescript',
        provider([{ title: 'Older' }], asked, released),
      );
      fake.monaco.languages.registerCodeActionProvider(
        'typescript',
        provider([{ title: 'Newer' }], asked, released),
      );
      const studios: MonacoApi.languages.CodeActionProvider = provider([{ title: 'Studio' }]);
      markStudioProvider(studios);
      fake.monaco.languages.registerCodeActionProvider('typescript', studios);
      fake.monaco.languages.registerCodeActionProvider('typescript', {
        provideCodeActions: (): never => {
          throw new Error('boom');
        },
      });
      const marker: MonacoApi.editor.IMarkerData = {
        severity: 8,
        message: 'Cannot find name',
        ...span(1, 1, 4),
      };

      const answer: ProvidedCodeActions = await providedCodeActions(
        fake.monaco,
        modelOf('typescript'),
        span(1, 2, 2),
        [marker],
        'quickfix',
      );

      expect(
        answer.actions.map(
          (entry: ProvidedCodeActions['actions'][number]): string => entry.action.title,
        ),
      ).toEqual(['Newer', 'Older']);
      expect(asked).toEqual([
        { markers: [marker], only: 'quickfix', trigger: 1 },
        { markers: [marker], only: 'quickfix', trigger: 1 },
      ]);
      answer.dispose();
      expect(released.count).toBe(2);
    });

    it('resolveProvidedCodeAction_fillsInAMissingEdit_andLeavesAWholeActionAlone', async () => {
      const fake: FakeMonaco = fakeMonaco();
      const edit: MonacoApi.languages.WorkspaceEdit = { edits: [] };
      const resolving: MonacoApi.languages.CodeActionProvider = {
        ...provider([]),
        resolveCodeAction: (action: MonacoApi.languages.CodeAction) => ({ ...action, edit }),
      };

      expect(
        (
          await resolveProvidedCodeAction(fake.monaco, {
            action: { title: 'Fix' },
            provider: resolving,
          })
        ).edit,
      ).toBe(edit);
      const whole: MonacoApi.languages.CodeAction = { title: 'Fix', edit: { edits: [] } };
      expect(
        await resolveProvidedCodeAction(fake.monaco, { action: whole, provider: resolving }),
      ).toBe(whole);
    });

    it('groupWorkspaceEdit_groupsByDocument_andCountsFileOperations', () => {
      const uri: (value: string) => MonacoApi.Uri = (value: string): MonacoApi.Uri =>
        ({ toString: (): string => value }) as unknown as MonacoApi.Uri;

      expect(
        groupWorkspaceEdit({
          edits: [
            {
              resource: uri('inmemory://a'),
              textEdit: { range: span(1, 1, 2), text: 'x' },
              versionId: undefined,
            },
            {
              resource: uri('inmemory://a'),
              textEdit: { range: span(2, 1, 2), text: 'y' },
              versionId: undefined,
            },
            { newResource: uri('inmemory://b') },
          ],
        }),
      ).toEqual({
        files: [
          {
            uri: 'inmemory://a',
            edits: [
              { range: span(1, 1, 2), text: 'x' },
              { range: span(2, 1, 2), text: 'y' },
            ],
          },
        ],
        fileOperations: 1,
      });
    });
  });

  describe('hover providers (#1020)', () => {
    /**
     * Builds a hover provider answering with the given blocks.
     * @param values The blocks' markdown, or null to answer nothing.
     * @param range The span answered for, if any.
     * @returns Returns the provider.
     */
    function hoverProvider(
      values: readonly string[] | null,
      range?: MonacoApi.IRange,
    ): MonacoApi.languages.HoverProvider {
      return {
        provideHover: (): MonacoApi.languages.Hover | null =>
          values === null
            ? null
            : {
                contents: values.map((value: string): MonacoApi.IMarkdownString => ({ value })),
                ...(range === undefined ? {} : { range }),
              },
      };
    }

    it('capture_recordsHoverProviders_andStillRegistersThem_untilDisposed', async () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      const provider: MonacoApi.languages.HoverProvider = hoverProvider(['`x: number`']);

      const disposable: MonacoApi.IDisposable = fake.monaco.languages.registerHoverProvider(
        'typescript',
        provider,
      );

      expect(fake.hoverProviders).toEqual([provider]);
      expect(
        await providedHovers(fake.monaco, modelOf('typescript'), { lineNumber: 1, column: 1 }),
      ).toHaveLength(1);
      disposable.dispose();
      expect(
        await providedHovers(fake.monaco, modelOf('typescript'), { lineNumber: 1, column: 1 }),
      ).toEqual([]);
    });

    it('providedHovers_asksEveryProviderForTheLanguage_newestFirst_droppingEmptyAndFailingOnes', async () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      fake.monaco.languages.registerHoverProvider('typescript', hoverProvider(['older']));
      fake.monaco.languages.registerHoverProvider('typescript', hoverProvider(null));
      fake.monaco.languages.registerHoverProvider('typescript', hoverProvider(['  ', '']));
      fake.monaco.languages.registerHoverProvider('typescript', {
        provideHover: (): never => {
          throw new Error('boom');
        },
      });
      fake.monaco.languages.registerHoverProvider('csharp', hoverProvider(['other language']));
      fake.monaco.languages.registerHoverProvider(
        ['typescript'],
        hoverProvider(['newer', ' '], span(1, 2, 5)),
      );

      const hovers: readonly ProvidedHover[] = await providedHovers(
        fake.monaco,
        modelOf('typescript'),
        { lineNumber: 1, column: 3 },
      );

      expect(hovers).toEqual([
        { contents: [{ value: 'newer' }], range: span(1, 2, 5), studio: false },
        { contents: [{ value: 'older' }], range: null, studio: false },
      ]);
    });

    it('providedHovers_aLanguageServersAnswerStandsAlone_overMonacosWorker', async () => {
      // Matthew's live test of #1020 showed TypeScript's docs twice: the server's and the worker's.
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      fake.monaco.languages.registerHoverProvider('typescript', hoverProvider(['from the worker']));
      const server: MonacoApi.languages.HoverProvider = hoverProvider(['from the server']);
      markStudioProvider(server);
      fake.monaco.languages.registerHoverProvider('typescript', server);

      const served: readonly ProvidedHover[] = await providedHovers(
        fake.monaco,
        modelOf('typescript'),
        { lineNumber: 1, column: 1 },
      );
      expect(served.map((hover: ProvidedHover) => hover.contents[0].value)).toEqual([
        'from the server',
      ]);

      // Where the server says nothing, the worker's answer still shows.
      const silent: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(silent.monaco);
      silent.monaco.languages.registerHoverProvider(
        'typescript',
        hoverProvider(['from the worker']),
      );
      const quiet: MonacoApi.languages.HoverProvider = hoverProvider(null);
      markStudioProvider(quiet);
      silent.monaco.languages.registerHoverProvider('typescript', quiet);
      expect(
        (
          await providedHovers(silent.monaco, modelOf('typescript'), { lineNumber: 1, column: 1 })
        ).map((hover: ProvidedHover) => hover.contents[0].value),
      ).toEqual(['from the worker']);
    });
  });
  describe('colour providers (#1025)', () => {
    /**
     * Builds a colour provider that finds one colour at a span, and offers ways to write a new one.
     * @param range Where it finds the colour, or null to find none.
     * @param presentations The ways it offers, or a throw.
     * @returns Returns the provider.
     */
    function colorProvider(
      range: MonacoApi.IRange | null,
      presentations: MonacoApi.languages.IColorPresentation[] | 'throw' = [],
    ): MonacoApi.languages.DocumentColorProvider {
      return {
        provideDocumentColors: (): MonacoApi.languages.IColorInformation[] =>
          range === null ? [] : [{ range, color: { red: 1, green: 0, blue: 0, alpha: 1 } }],
        provideColorPresentations: (): MonacoApi.languages.IColorPresentation[] => {
          if (presentations === 'throw') {
            throw new Error('boom');
          }
          return presentations;
        },
      };
    }

    it('capture_recordsColourProviders_andStillRegistersThem_forgettingADisposedOne', async () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      const provider: MonacoApi.languages.DocumentColorProvider = colorProvider(span(1, 5, 9));

      const disposable: MonacoApi.IDisposable = fake.monaco.languages.registerColorProvider(
        'css',
        provider,
      );

      expect(fake.colorProviders).toEqual([provider]);
      expect((await providedColourAt(fake.monaco, modelOf('css'), span(1, 5, 9)))?.provider).toBe(
        provider,
      );
      disposable.dispose();
      expect(await providedColourAt(fake.monaco, modelOf('css'), span(1, 5, 9))).toBeNull();
    });

    it('providedColourAt_takesTheNewestProviderWithAColourStartingThere_skippingFailures', async () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      const older: MonacoApi.languages.DocumentColorProvider = colorProvider(span(1, 5, 9));
      fake.monaco.languages.registerColorProvider('css', older);
      fake.monaco.languages.registerColorProvider('css', colorProvider(span(1, 20, 24)));
      fake.monaco.languages.registerColorProvider('css', {
        provideDocumentColors: (): never => {
          throw new Error('boom');
        },
        provideColorPresentations: (): [] => [],
      });
      fake.monaco.languages.registerColorProvider('json', colorProvider(span(1, 5, 9)));

      const found: ProvidedColour | null = await providedColourAt(
        fake.monaco,
        modelOf('css'),
        span(1, 5, 9),
      );

      expect(found?.provider).toBe(older);
      expect(found?.info.range).toEqual(span(1, 5, 9));
      expect(await providedColourAt(fake.monaco, modelOf('less'), span(1, 5, 9))).toBeNull();
    });

    it('providedColourEdits_takesTheFirstWay_itsEditOrItsLabel_withItsFurtherEdits', async () => {
      const fake: FakeMonaco = fakeMonaco();
      captureEditorCapabilities(fake.monaco);
      const color: MonacoApi.languages.IColor = { red: 0, green: 0, blue: 1, alpha: 1 };
      const at: MonacoApi.languages.IColorInformation = {
        range: span(1, 5, 9),
        color: { red: 1, green: 0, blue: 0, alpha: 1 },
      };
      const labelled: ProvidedColour = {
        info: at,
        provider: colorProvider(null, [
          { label: 'blue', additionalTextEdits: [{ range: span(1, 1, 1), text: '@use x;' }] },
          { label: 'never' },
        ]),
      };
      const edited: ProvidedColour = {
        info: at,
        provider: colorProvider(null, [
          { label: 'blue', textEdit: { range: span(1, 4, 10), text: '(blue)' } },
        ]),
      };

      expect(await providedColourEdits(fake.monaco, modelOf('css'), labelled, color)).toEqual([
        { range: span(1, 5, 9), text: 'blue' },
        { range: span(1, 1, 1), text: '@use x;' },
      ]);
      expect(await providedColourEdits(fake.monaco, modelOf('css'), edited, color)).toEqual([
        { range: span(1, 4, 10), text: '(blue)' },
      ]);
      for (const provider of [colorProvider(null, []), colorProvider(null, 'throw')]) {
        expect(
          await providedColourEdits(fake.monaco, modelOf('css'), { info: at, provider }, color),
        ).toEqual([]);
      }
    });
  });
});
