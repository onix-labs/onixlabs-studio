import { semanticLegendOf } from './lsp-capabilities';

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
