import {
  codeActionSupportOf,
  executeCommandsOf,
  formattingSupportOf,
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
  it('readsImplementationAndTypeDefinition_asBooleansOrOptions', () => {
    expect(
      navigationSupportOf({
        implementationProvider: true,
        typeDefinitionProvider: { workDoneProgress: true },
      }),
    ).toEqual({ implementation: true, typeDefinition: true });
    expect(navigationSupportOf({ implementationProvider: false })).toEqual({
      implementation: false,
      typeDefinition: false,
    });
    expect(navigationSupportOf(undefined)).toEqual({
      implementation: false,
      typeDefinition: false,
    });
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
