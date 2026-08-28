import { globToRegExp, matchesAny } from './lsp-watch-glob';

describe('lsp-watch-glob', () => {
  /**
   * Tests a single glob against a path.
   * @param glob The glob.
   * @param relativePath The path.
   * @returns Returns whether it matches.
   */
  function matches(glob: string, relativePath: string): boolean {
    return matchesAny(relativePath, [globToRegExp(glob)]);
  }

  it('star_matchesWithinASegmentOnly', () => {
    expect(matches('*.ts', 'a.ts')).toBe(true);
    expect(matches('*.ts', 'src/a.ts')).toBe(false);
  });

  it('doubleStar_matchesAnyDepthIncludingNone', () => {
    // The shape every server registers: rust-analyzer's `**/Cargo.toml`, gopls's `**/*.go`.
    expect(matches('**/*.ts', 'a.ts')).toBe(true);
    expect(matches('**/*.ts', 'src/deep/a.ts')).toBe(true);
    expect(matches('**/Cargo.toml', 'crates/x/Cargo.toml')).toBe(true);
    expect(matches('**/*.ts', 'src/a.rs')).toBe(false);
  });

  it('trailingDoubleStar_matchesEverythingBeneath', () => {
    expect(matches('src/**', 'src/a/b/c.txt')).toBe(true);
    expect(matches('src/**', 'lib/a.txt')).toBe(false);
  });

  it('braces_expandAlternatives', () => {
    // vscode-langservers register `**/*.{json,jsonc}`; tsserver `**/*.{ts,tsx,js,jsx}`.
    expect(matches('**/*.{ts,tsx}', 'a.tsx')).toBe(true);
    expect(matches('**/*.{ts,tsx}', 'a.js')).toBe(false);
  });

  it('questionMark_matchesOneCharacter', () => {
    expect(matches('a?.ts', 'ab.ts')).toBe(true);
    expect(matches('a?.ts', 'abc.ts')).toBe(false);
  });

  it('characterClass_isPassedThrough', () => {
    expect(matches('[ab].ts', 'a.ts')).toBe(true);
    expect(matches('[ab].ts', 'c.ts')).toBe(false);
  });

  it('literalDotsAndBackslashesAreHandled', () => {
    expect(matches('**/go.mod', 'go.mod')).toBe(true);
    expect(matches('**/go.mod', 'goxmod')).toBe(false);
    expect(matches('**/*.cs', 'src\\Program.cs')).toBe(true);
  });

  it('matchesAny_isFalseWithNoMatchers', () => {
    expect(matchesAny('a.ts', [])).toBe(false);
  });
});
