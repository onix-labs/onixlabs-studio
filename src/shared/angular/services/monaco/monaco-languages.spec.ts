import {
  extensionForLanguage,
  LanguageInfo,
  languageForExtension,
  languageForFileName,
  readsAsXml,
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

  describe('the shared resolver (#1068)', () => {
    it.each([
      'MyApp.csproj',
      'Lib.fsproj',
      'Old.vbproj',
      'Common.props',
      'Build.targets',
      'Package.nuspec',
      'Strings.resx',
      'MainWindow.xaml',
      'App.axaml',
      'Studio.slnx',
      'logo.svg',
      'Info.plist',
      'schema.xsd',
      'page.xsl',
      'page.xslt',
    ])('colours %s_asXml_byItsEnding', (name: string) => {
      expect(languageForFileName(name)).toBe('xml');
    });

    it.each([
      'nuget.config',
      'NuGet.Config',
      'web.config',
      'app.config',
      'packages.config',
      'Directory.Build.props',
      'Directory.Build.targets',
      'directory.packages.props',
    ])('colours %s_asXml_byItsWholeName_whateverItsContent', (name: string) => {
      // These are XML whatever their text says: an empty or half-written one is still XML.
      expect(languageForFileName(`/repo/${name}`, 'not xml at all')).toBe('xml');
    });

    it('colours aConfigFile_asXml_onlyWhenItReadsAsXml', () => {
      expect(
        languageForFileName('settings.config', '<?xml version="1.0"?>\n<configuration/>'),
      ).toBe('xml');
      expect(languageForFileName('settings.config', '<configuration>\n</configuration>')).toBe(
        'xml',
      );
      expect(languageForFileName('settings.config', 'key = value\n')).toBe('plaintext');
    });

    it('leaves aConfigFile_asPlainText_whenTheCallerHasNoContent', () => {
      // A name-only caller (a diff row, a suggested Save As) cannot check, so it does not guess.
      expect(languageForFileName('settings.config')).toBe('plaintext');
    });

    it('putsAWholeNameBeforeTheEnding_andTheEndingBeforeTheContent', () => {
      // `nuget.config` is XML by name; a `.json` stays JSON even when its text starts with `<`.
      expect(languageForFileName('nuget.config')).toBe('xml');
      expect(languageForFileName('data.json', '<oops>')).toBe('json');
    });

    it('keepsTheEarlierRules', () => {
      expect(languageForFileName('Dockerfile')).toBe('dockerfile');
      expect(languageForFileName('main.ts')).toBe('typescript');
      expect(languageForFileName('.gitignore')).toBe('plaintext');
      expect(extensionForLanguage('xml')).toBe('.xml');
    });

    it.each([
      ['<?xml version="1.0"?>', true],
      ['\uFEFF<configuration/>', true],
      ['  \n\t<root/>', true],
      ['{ "a": 1 }', false],
      ['', false],
      ['# <not xml>', false],
    ])('readsAsXml(%j)_is %s', (content: string, expected: boolean) => {
      expect(readsAsXml(content)).toBe(expected);
    });
  });
});
