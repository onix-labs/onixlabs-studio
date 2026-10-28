import {
  codeActionSupportOf,
  executeCommandsOf,
  formattingSupportOf,
  inlayHintSupportOf,
  autoInsertTriggersOf,
  codeLensSupportOf,
  structureSupportOf,
  navigationSupportOf,
  renameSupportOf,
  semanticLegendOf,
} from './lsp-capabilities';

describe('formattingSupportOf (#1141)', () => {
  it('readsRoslynsFormatters_andItsOnTypeTriggerCharacters', () => {
    // Exactly what Roslyn 5.4/5.13 advertise.
    expect(
      formattingSupportOf({
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        documentOnTypeFormattingProvider: {
          firstTriggerCharacter: '}',
          moreTriggerCharacter: [';', '\n'],
        },
      }),
    ).toEqual({ document: true, range: true, onTypeTriggers: ['}', ';', '\n'] });
  });

  it('acceptsProviderOptionObjects_andReadsAbsenceAsNotFormatting', () => {
    expect(formattingSupportOf({ documentFormattingProvider: { workDoneProgress: true } })).toEqual(
      {
        document: true,
        range: false,
        onTypeTriggers: [],
      },
    );
    expect(formattingSupportOf(undefined)).toEqual({
      document: false,
      range: false,
      onTypeTriggers: [],
    });
  });

  it('dropsMalformedAndDuplicateTriggerCharacters', () => {
    expect(
      formattingSupportOf({
        documentOnTypeFormattingProvider: {
          firstTriggerCharacter: '}',
          moreTriggerCharacter: ['}', 'ab', 3],
        },
      }).onTypeTriggers,
    ).toEqual(['}']);
  });
});

describe('navigationSupportOf (#1142)', () => {
  const NONE: unknown = {
    implementation: false,
    typeDefinition: false,
    callHierarchy: false,
    typeHierarchy: false,
  };

  it('readsImplementationTypeDefinitionAndHierarchies_asBooleansOrOptions', () => {
    // What Roslyn 5.13 advertises (#1153).
    expect(
      navigationSupportOf({
        implementationProvider: true,
        typeDefinitionProvider: { workDoneProgress: true },
        callHierarchyProvider: true,
        typeHierarchyProvider: {},
      }),
    ).toEqual({
      implementation: true,
      typeDefinition: true,
      callHierarchy: true,
      typeHierarchy: true,
    });
    expect(navigationSupportOf({ implementationProvider: false })).toEqual(NONE);
    expect(navigationSupportOf(undefined)).toEqual(NONE);
  });
});

describe('codeLensSupportOf (#1149)', () => {
  it('readsWhetherTheServerShowsLenses_andFillsThemInOnRequest', () => {
    // What Roslyn 5.13 advertises.
    expect(codeLensSupportOf({ codeLensProvider: { resolveProvider: true } })).toEqual({
      resolve: true,
    });
    expect(codeLensSupportOf({ codeLensProvider: {} })).toEqual({ resolve: false });
    expect(codeLensSupportOf({})).toBeUndefined();
  });
});

describe('autoInsertTriggersOf (#1148)', () => {
  it('readsTheCharactersRoslynAnswersByInsertingText', () => {
    // What Roslyn 5.13 advertises.
    expect(
      autoInsertTriggersOf({
        _vs_onAutoInsertProvider: { _vs_triggerCharacters: ["'", '/', '\n', '"', 'too long', 3] },
      }),
    ).toEqual(["'", '/', '\n', '"']);
    expect(autoInsertTriggersOf({ _vs_onAutoInsertProvider: { _vs_triggerCharacters: [] } })).toBe(
      undefined,
    );
    expect(autoInsertTriggersOf(undefined)).toBeUndefined();
  });
});

describe('structureSupportOf (#1147)', () => {
  it('readsFoldsOccurrencesRangeTokensAndSelectionRanges_aRangeOnlyWithALegend', () => {
    const legend: unknown = { tokenTypes: ['class'], tokenModifiers: [] };
    // What Roslyn 5.13 advertises, offered full and range.
    expect(
      structureSupportOf({
        foldingRangeProvider: true,
        documentHighlightProvider: true,
        selectionRangeProvider: true,
        semanticTokensProvider: { legend, range: true, full: false },
      }),
    ).toEqual({ folding: true, highlights: true, rangeTokens: true, selectionRanges: true });
    expect(structureSupportOf({ semanticTokensProvider: { range: true } })).toEqual({
      folding: false,
      highlights: false,
      rangeTokens: false,
      selectionRanges: false,
    });
    expect(structureSupportOf(undefined)).toEqual({
      folding: false,
      highlights: false,
      rangeTokens: false,
      selectionRanges: false,
    });
  });
});

describe('inlayHintSupportOf (#1145)', () => {
  it('readsWhetherTheServerSetsHints_andFillsThemInOnRequest', () => {
    // What Roslyn 5.13 advertises.
    expect(inlayHintSupportOf({ inlayHintProvider: { resolveProvider: true } })).toEqual({
      resolve: true,
    });
    expect(inlayHintSupportOf({ inlayHintProvider: true })).toEqual({ resolve: false });
    expect(inlayHintSupportOf({ inlayHintProvider: false })).toBeUndefined();
    expect(inlayHintSupportOf(undefined)).toBeUndefined();
  });
});

describe('semanticLegendOf', () => {
  it('extractsTheLegendWhenTheServerAdvertisesOne', () => {
    expect(
      semanticLegendOf({
        semanticTokensProvider: { legend: { tokenTypes: ['type'], tokenModifiers: ['mod'] } },
      }),
    ).toEqual({ tokenTypes: ['type'], tokenModifiers: ['mod'] });
  });

  it('returnsNullWhenTheLegendIsAbsentOrMalformed', () => {
    expect(semanticLegendOf(undefined)).toBeNull();
    expect(semanticLegendOf({})).toBeNull();
    expect(semanticLegendOf({ semanticTokensProvider: {} })).toBeNull();
    expect(
      semanticLegendOf({
        semanticTokensProvider: { legend: { tokenTypes: 'nope', tokenModifiers: [] } },
      }),
    ).toBeNull();
  });
});

describe('renameSupportOf (#1015)', () => {
  it('readsHowTheServerRenames_fromItsRenameProvider', () => {
    expect(renameSupportOf({ renameProvider: { prepareProvider: true } })).toBe('prepare');
    expect(renameSupportOf({ renameProvider: {} })).toBe('rename');
    expect(renameSupportOf({ renameProvider: true })).toBe('rename');
    expect(renameSupportOf({ renameProvider: false })).toBe('none');
    expect(renameSupportOf({})).toBe('none');
    expect(renameSupportOf(undefined)).toBe('none');
  });
});

describe('codeActionSupportOf (#1016)', () => {
  it('readsWhetherAServerOffersCodeActions_andWhetherItResolvesThem', () => {
    expect(codeActionSupportOf({ codeActionProvider: true })).toBe('actions');
    expect(codeActionSupportOf({ codeActionProvider: { codeActionKinds: ['quickfix'] } })).toBe(
      'actions',
    );
    expect(codeActionSupportOf({ codeActionProvider: { resolveProvider: true } })).toBe('resolve');
    expect(codeActionSupportOf({ codeActionProvider: false })).toBe('none');
    expect(codeActionSupportOf({})).toBe('none');
    expect(codeActionSupportOf(undefined)).toBe('none');
  });
});

describe('executeCommandsOf (#1016)', () => {
  it('readsTheCommandsAServerRuns_droppingAnythingMalformed', () => {
    expect(
      executeCommandsOf({ executeCommandProvider: { commands: ['server.format', 7, 'x'] } }),
    ).toEqual(['server.format', 'x']);
    expect(executeCommandsOf({ executeCommandProvider: {} })).toEqual([]);
    expect(executeCommandsOf(undefined)).toEqual([]);
  });
});
