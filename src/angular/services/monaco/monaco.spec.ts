import { TestBed } from '@angular/core/testing';

import { Monaco } from './monaco';

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
