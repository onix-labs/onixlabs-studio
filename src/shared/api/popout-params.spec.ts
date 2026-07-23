import { buildPopoutSearch, parsePopoutSearch, sanitizePopoutParams } from './popout-params';

describe('sanitizePopoutParams', () => {
  it('withAValidMap_returnsIt', () => {
    expect(sanitizePopoutParams({ title: 'Scratch', scratch: 'probe-1' })).toEqual({
      title: 'Scratch',
      scratch: 'probe-1',
    });
  });

  it('withAnEmptyMap_returnsAnEmptyMap', () => {
    expect(sanitizePopoutParams({})).toEqual({});
  });

  it('withNonObjects_returnsNull', () => {
    expect(sanitizePopoutParams(null)).toBeNull();
    expect(sanitizePopoutParams(undefined)).toBeNull();
    expect(sanitizePopoutParams('title=x')).toBeNull();
    expect(sanitizePopoutParams(['title'])).toBeNull();
  });

  it('withAnInvalidKeyOrValue_rejectsTheWholeRequest', () => {
    expect(sanitizePopoutParams({ 'bad key': 'x' })).toBeNull();
    expect(sanitizePopoutParams({ '1leading': 'x' })).toBeNull();
    expect(sanitizePopoutParams({ title: 42 })).toBeNull();
    expect(sanitizePopoutParams({ title: 'x'.repeat(513) })).toBeNull();
  });

  it('withACallerSuppliedRoleFlag_dropsItRatherThanObeyingIt', () => {
    expect(sanitizePopoutParams({ window: 'main', title: 'Scratch' })).toEqual({
      title: 'Scratch',
    });
  });

  it('withTooManyEntries_returnsNull', () => {
    const params: Record<string, string> = {};
    for (let index: number = 0; index < 17; index++) {
      params[`key${index}`] = 'value';
    }
    expect(sanitizePopoutParams(params)).toBeNull();
  });
});

describe('buildPopoutSearch / parsePopoutSearch', () => {
  it('roundTripsParameters', () => {
    const search: string = buildPopoutSearch({ title: 'Scratch pad', scratch: 'p2' });
    expect(search.startsWith('?window=popout')).toBe(true);
    expect(parsePopoutSearch(search)).toEqual({ title: 'Scratch pad', scratch: 'p2' });
  });

  it('encodesReservedCharacters', () => {
    const search: string = buildPopoutSearch({ title: 'a&b=c' });
    expect(parsePopoutSearch(search)).toEqual({ title: 'a&b=c' });
  });

  it('parse_withoutThePopoutFlag_returnsNull', () => {
    expect(parsePopoutSearch('')).toBeNull();
    expect(parsePopoutSearch('?title=x')).toBeNull();
    expect(parsePopoutSearch('?window=main')).toBeNull();
  });

  it('parse_acceptsSearchWithOrWithoutTheLeadingQuestionMark', () => {
    expect(parsePopoutSearch('window=popout&title=x')).toEqual({ title: 'x' });
    expect(parsePopoutSearch('?window=popout&title=x')).toEqual({ title: 'x' });
  });
});
