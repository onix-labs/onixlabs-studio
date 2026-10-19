import {
  codeActionSupportOf,
  executeCommandsOf,
  renameSupportOf,
  semanticLegendOf,
} from './lsp-capabilities';

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
