import { foldPlaceholderClass } from './folding-placeholder-controller';

describe('foldPlaceholderClass', () => {
  it('choosesTheKAndRClassWhenTheLineEndsWithAnOpeningBrace', () => {
    expect(foldPlaceholderClass('    static void Main() {')).toBe('fold-placeholder--knr');
  });

  it('ignoresTrailingWhitespaceWhenDetectingAKAndRBrace', () => {
    expect(foldPlaceholderClass('void f() {   ')).toBe('fold-placeholder--knr');
  });

  it('choosesTheAllmanClassForACodeSignatureLine', () => {
    expect(foldPlaceholderClass('internal static class Program')).toBe('fold-placeholder--allman');
  });

  it('choosesTheRegionClassForARegionMarker', () => {
    expect(foldPlaceholderClass('#region Helpers')).toBe('fold-placeholder--region');
  });

  it('choosesTheRegionClassForALineCommentRegionMarker', () => {
    expect(foldPlaceholderClass('//region Helpers')).toBe('fold-placeholder--region');
  });

  it('choosesTheRegionClassForALineComment', () => {
    expect(foldPlaceholderClass('// a leading comment')).toBe('fold-placeholder--region');
  });

  it('choosesTheRegionClassForABlockComment', () => {
    expect(foldPlaceholderClass('/* a block comment')).toBe('fold-placeholder--region');
  });
});
