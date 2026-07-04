import { buildHeuristicSemanticTokens, MonarchToken } from './monaco-heuristic-tokens';

/**
 * No Monarch tokens — nothing is treated as a string/comment/keyword, so every identifier is scanned.
 */
const NO_MONARCH_TOKENS: readonly (readonly MonarchToken[])[] = [];

describe('buildHeuristicSemanticTokens', () => {
  it('emitsATypeTokenForAPascalCaseIdentifier', () => {
    expect(Array.from(buildHeuristicSemanticTokens('Foo', NO_MONARCH_TOKENS))).toEqual([
      0, 0, 3, 0, 0,
    ]);
  });

  it('emitsAFunctionTokenForAnIdentifierFollowedByAParen', () => {
    expect(Array.from(buildHeuristicSemanticTokens('bar(', NO_MONARCH_TOKENS))).toEqual([
      0, 0, 3, 1, 0,
    ]);
  });

  it('emitsNoTokenForALowercaseIdentifier', () => {
    expect(Array.from(buildHeuristicSemanticTokens('foo', NO_MONARCH_TOKENS))).toEqual([]);
  });

  it('emitsNoTokenForASingleUppercaseLetter', () => {
    expect(Array.from(buildHeuristicSemanticTokens('X', NO_MONARCH_TOKENS))).toEqual([]);
  });

  it('skipsIdentifiersTheMonarchPassClassifiedAsAString', () => {
    const monarch: readonly (readonly MonarchToken[])[] = [[{ offset: 0, type: 'string.cs' }]];

    expect(Array.from(buildHeuristicSemanticTokens('Foo', monarch))).toEqual([]);
  });

  it('encodesTheDeltaLineForIdentifiersOnLaterLines', () => {
    expect(Array.from(buildHeuristicSemanticTokens('Foo\n\nBar', NO_MONARCH_TOKENS))).toEqual([
      0, 0, 3, 0, 0, 2, 0, 3, 0, 0,
    ]);
  });
});
