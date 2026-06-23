import { TestBed } from '@angular/core/testing';

import { buildHeuristicSemanticTokens, MonarchToken, Monaco } from './monaco';

/**
 * A decoded semantic token, for readable assertions.
 */
interface DecodedToken {
  readonly deltaLine: number;
  readonly deltaChar: number;
  readonly length: number;
  readonly type: number;
}

/**
 * Decodes Monaco's delta-packed semantic-token array into one record per token.
 * @param data The packed token data (groups of five integers).
 * @returns Returns the decoded tokens.
 */
function decodeTokens(data: Uint32Array): readonly DecodedToken[] {
  const tokens: DecodedToken[] = [];
  for (let i: number = 0; i + 4 < data.length; i += 5) {
    tokens.push({
      deltaLine: data[i],
      deltaChar: data[i + 1],
      length: data[i + 2],
      type: data[i + 3],
    });
  }
  return tokens;
}

/**
 * Builds a single Monarch token line that classifies the whole line as one scope, used to mark a
 * line as a string/comment/keyword the heuristic should skip.
 * @param type The Monarch scope name.
 * @returns Returns the one-token line.
 */
function wholeLineAs(type: string): MonarchToken[] {
  return [{ offset: 0, type }];
}

describe('Monaco', () => {
  let monaco: Monaco;

  beforeEach(() => {
    monaco = TestBed.inject(Monaco);
  });

  it('getLanguageForExtension_whenKnownExtension_returnsLanguage', () => {
    expect(monaco.getLanguageForExtension('.ts')).toBe('typescript');
  });

  it('getLanguageForExtension_whenNoLeadingDot_returnsLanguage', () => {
    expect(monaco.getLanguageForExtension('md')).toBe('markdown');
  });

  it('getLanguageForExtension_whenMixedCase_returnsLanguage', () => {
    expect(monaco.getLanguageForExtension('.JSON')).toBe('json');
  });

  it('getLanguageForExtension_whenUnknownExtension_returnsPlaintext', () => {
    expect(monaco.getLanguageForExtension('.unknown')).toBe('plaintext');
  });

  it('getSupportedLanguages_whenCalled_returnsSortedNonEmptyList', () => {
    const names: readonly string[] = monaco
      .getSupportedLanguages()
      .map((info): string => info.name);
    expect(names.length).toBeGreaterThan(0);
    expect([...names]).toEqual(
      [...names].sort((a: string, b: string): number => a.localeCompare(b)),
    );
  });

  it('getThemeName_whenOutline_returnsOutlineThemeForResolvedMode', () => {
    expect(monaco.getThemeName('outline')).toMatch(/^onix-(light|dark)-outline$/);
  });

  it('getThemeName_whenFilled_returnsFilledThemeForResolvedMode', () => {
    expect(monaco.getThemeName('filled')).toMatch(/^onix-(light|dark)-filled$/);
  });
});

describe('buildHeuristicSemanticTokens', () => {
  // The legend is [type, function], so 0 is a type token and 1 is a function token.
  const TYPE: number = 0;
  const FUNCTION: number = 1;

  it('whenPascalCaseIdentifier_emitsTypeToken', () => {
    const tokens: readonly DecodedToken[] = decodeTokens(buildHeuristicSemanticTokens('Customer value', [[]]));
    expect(tokens).toEqual([{ deltaLine: 0, deltaChar: 0, length: 8, type: TYPE }]);
  });

  it('whenIdentifierFollowedByParen_emitsFunctionToken', () => {
    const tokens: readonly DecodedToken[] = decodeTokens(buildHeuristicSemanticTokens('compute()', [[]]));
    expect(tokens).toEqual([{ deltaLine: 0, deltaChar: 0, length: 7, type: FUNCTION }]);
  });

  it('whenLowercaseNonCallIdentifier_emitsNothing', () => {
    expect(buildHeuristicSemanticTokens('total value', [[]]).length).toBe(0);
  });

  it('whenSingleUppercaseLetter_emitsNothing', () => {
    expect(buildHeuristicSemanticTokens('T value', [[]]).length).toBe(0);
  });

  it('whenIdentifierInsideCommentOrString_skipsIt', () => {
    expect(buildHeuristicSemanticTokens('Customer thing', [wholeLineAs('comment.cs')]).length).toBe(
      0,
    );
    expect(buildHeuristicSemanticTokens('Customer thing', [wholeLineAs('string.cs')]).length).toBe(
      0,
    );
  });

  it('whenTokensSpanLines_deltaEncodesPositions', () => {
    const tokens: readonly DecodedToken[] = decodeTokens(buildHeuristicSemanticTokens('Alpha\nBeta', [[], []]));
    expect(tokens).toEqual([
      { deltaLine: 0, deltaChar: 0, length: 5, type: TYPE },
      { deltaLine: 1, deltaChar: 0, length: 4, type: TYPE },
    ]);
  });
});
