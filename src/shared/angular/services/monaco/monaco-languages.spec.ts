import {
  extensionForLanguage,
  LanguageInfo,
  languageForExtension,
  supportedLanguages,
} from './monaco-languages';

describe('monaco-languages', () => {
  it('languageForExtension_resolvesKnownExtensionsRegardlessOfDotOrCase', () => {
    expect(languageForExtension('.ts')).toBe('typescript');
    expect(languageForExtension('ts')).toBe('typescript');
    expect(languageForExtension('.TS')).toBe('typescript');
  });

  it('languageForExtension_fallsBackToPlaintextForUnknownExtensions', () => {
    expect(languageForExtension('.nope')).toBe('plaintext');
  });

  it('extensionForLanguage_returnsTheFirstRegisteredExtensionOrEmpty', () => {
    expect(extensionForLanguage('typescript')).toBe('.ts');
    expect(extensionForLanguage('plaintext')).toBe('.txt');
    expect(extensionForLanguage('nonexistent')).toBe('');
  });

  it('supportedLanguages_returnsANonEmptyListSortedByName', () => {
    const languages: readonly LanguageInfo[] = supportedLanguages();
    const names: readonly string[] = languages.map(
      (language: LanguageInfo): string => language.name,
    );
    const sorted: readonly string[] = [...names].sort((a: string, b: string): number =>
      a.localeCompare(b),
    );

    expect(languages.length).toBeGreaterThan(0);
    expect(names).toEqual(sorted);
  });
});
