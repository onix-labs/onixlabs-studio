import { renameSupportOf, semanticLegendOf } from './lsp-capabilities';

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
