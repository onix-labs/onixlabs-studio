import { matcherFor, ReplaceOptions, replaceAll, replaceAt } from './search-replace';

/**
 * Builds replace options, plain unless told otherwise.
 * @param query The query.
 * @param replacement The replacement.
 * @param overrides Any option to change.
 * @returns Returns the options.
 */
function options(
  query: string,
  replacement: string,
  overrides: Partial<ReplaceOptions> = {},
): ReplaceOptions {
  return {
    query,
    replacement,
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
    ...overrides,
  };
}

describe('search-replace (#882)', () => {
  describe('replaceAll', () => {
    it('replacesEveryMatch_includingASecondOnTheSameLine', () => {
      // ripgrep lists only the first match on a line; Replace All must not leave the second behind.
      expect(replaceAll('name = name;\nname', options('name', 'id'))).toEqual({
        text: 'id = id;\nid',
        count: 3,
      });
    });

    it('takesAPlainQueryLiterally_soItsRegexCharactersAreJustText', () => {
      expect(replaceAll('a.b axb (a.b)', options('a.b', 'z'))).toEqual({
        text: 'z axb (z)',
        count: 2,
      });
    });

    it('takesAPlainReplacementLiterally_dollarSignsAndAll', () => {
      expect(replaceAll('cost', options('cost', '$1 $&')).text).toBe('$1 $&');
    });

    it('ignoresCase_unlessCaseSensitive', () => {
      expect(replaceAll('Name name NAME', options('name', 'x')).count).toBe(3);
      expect(replaceAll('Name name NAME', options('name', 'x', { caseSensitive: true }))).toEqual({
        text: 'Name x NAME',
        count: 1,
      });
    });

    it('matchesWholeWordsOnly_whenAsked', () => {
      expect(replaceAll('name names rename', options('name', 'x', { wholeWord: true }))).toEqual({
        text: 'x names rename',
        count: 1,
      });
    });

    it('fillsInGroups_inARegexReplacement', () => {
      const regex: ReplaceOptions = options('(\\w+)@(?<host>\\w+)', '$<host>:$1 [$&] $$', {
        regexp: true,
      });

      expect(replaceAll('me@home', regex).text).toBe('home:me [me@home] $');
    });

    it('neverMatchesAcrossALine_asRipgrepDoesNot', () => {
      expect(replaceAll('a\nb', options('a\\s+b', 'X', { regexp: true }))).toEqual({
        text: 'a\nb',
        count: 0,
      });
    });

    it('keepsLineEndingsAndAByteOrderMark_exactlyAsTheyWere', () => {
      expect(replaceAll('\uFEFFone\r\ntwo\rone\n', options('one', '1')).text).toBe(
        '\uFEFF1\r\ntwo\r1\n',
      );
    });

    it('changesNothing_forAnInvalidPatternOrAnEmptyQuery', () => {
      expect(replaceAll('a(b', options('(', 'x', { regexp: true }))).toEqual({
        text: 'a(b',
        count: 0,
      });
      expect(replaceAll('abc', options('', 'x')).count).toBe(0);
      expect(matcherFor(options('(', 'x', { regexp: true }))).toBeNull();
    });
  });

  describe('replaceAt', () => {
    it('replacesOnlyTheMatchAtTheReportedPosition', () => {
      // Line 2, the second "name" on it: byte offset 7, so ripgrep reports column 8.
      expect(replaceAt('name\nname = name;\n', options('name', 'id'), 2, 8)).toEqual({
        text: 'name\nname = id;\n',
        count: 1,
      });
    });

    it('readsThePositionAsAByteOffset_soAMultiByteLeadInDoesNotMisplaceIt', () => {
      // "é" is two bytes, so the match ripgrep places at byte 3 is the string's character 2.
      expect(replaceAt('é name', options('name', 'id'), 1, 4)).toEqual({
        text: 'é id',
        count: 1,
      });
    });

    it('changesNothing_whenTheMatchIsNoLongerThere', () => {
      // The file changed since it was searched: nothing matches at that position any more.
      expect(replaceAt('other text', options('name', 'id'), 1, 1)).toEqual({
        text: 'other text',
        count: 0,
      });
    });
  });
});
