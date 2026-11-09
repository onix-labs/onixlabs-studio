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

  it('languageForExtension_knowsEveryCxxSourceAndHeaderExtension', () => {
    // Plaintext has no colouring and never asks for a language server (#1213).
    for (const extension of [
      '.cpp',
      '.cc',
      '.cxx',
      '.c++',
      '.h',
      '.hpp',
      '.hh',
      '.hxx',
      '.h++',
      '.inl',
      '.ipp',
      '.tpp',
      '.cppm',
      '.ixx',
    ]) {
      expect(languageForExtension(extension)).toBe('cpp');
    }
    expect(languageForExtension('.c')).toBe('c');
  });

  it('languageForExtension_knowsTheModuleKindsOfTypeScript_andPythonsStubs (#1213)', () => {
    // ES-module and CommonJS TypeScript, and their declaration files (`.d.mts`).
    expect(languageForExtension('.mts')).toBe('typescript');
    expect(languageForExtension('.cts')).toBe('typescript');
    expect(languageForExtension('.pyi')).toBe('python');
    expect(languageForExtension('.pyw')).toBe('python');
    // A Kotlin script, such as a Gradle build file (`build.gradle.kts`).
    expect(languageForExtension('.kts')).toBe('kotlin');
  });

  it('languageForExtension_fallsBackToPlaintextForUnknownExtensions', () => {
    expect(languageForExtension('.nope')).toBe('plaintext');
  });

  it('extensionForLanguage_returnsTheFirstRegisteredExtensionOrEmpty', () => {
    expect(extensionForLanguage('typescript')).toBe('.ts');
    expect(extensionForLanguage('plaintext')).toBe('.txt');
    expect(extensionForLanguage('cpp')).toBe('.cpp');
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
