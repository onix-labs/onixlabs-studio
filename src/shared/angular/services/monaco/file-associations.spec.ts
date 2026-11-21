import {
  associatedLanguage,
  extensionPattern,
  FileAssociation,
  fileAssociations,
  withFileAssociation,
  withoutFileAssociation,
} from './file-associations';

describe('file-associations', () => {
  it('associatedLanguage_matchesAnExactNameWithoutRegardToCase', () => {
    const associations: readonly FileAssociation[] = [
      { pattern: 'Jenkinsfile', language: 'groovy' },
    ];

    expect(associatedLanguage('/ws/ci/jenkinsfile', associations)).toBe('groovy');
    expect(associatedLanguage('/ws/ci/Jenkinsfile.bak', associations)).toBeUndefined();
  });

  it('associatedLanguage_matchesANameGlob', () => {
    const associations: readonly FileAssociation[] = [{ pattern: '*.foo', language: 'json' }];

    expect(associatedLanguage('/ws/data.FOO', associations)).toBe('json');
    expect(associatedLanguage('/ws/data.foobar', associations)).toBeUndefined();
  });

  it('associatedLanguage_matchesAPathAndAPathGlob_onEitherSlash', () => {
    const associations: readonly FileAssociation[] = [
      { pattern: '/ws/notes/todo.txt', language: 'markdown' },
      { pattern: '/ws/ci/*.yml', language: 'plaintext' },
    ];

    expect(associatedLanguage('/ws/notes/todo.txt', associations)).toBe('markdown');
    expect(associatedLanguage('\\ws\\notes\\todo.txt', associations)).toBe('markdown');
    expect(associatedLanguage('/ws/ci/build.yml', associations)).toBe('plaintext');
    expect(associatedLanguage('/ws/other/todo.txt', associations)).toBeUndefined();
  });

  it('associatedLanguage_prefersExactPath_thenExactName_thenPathGlob_thenNameGlob', () => {
    const all: readonly FileAssociation[] = [
      { pattern: '*.txt', language: 'name-glob' },
      { pattern: '/ws/**/*.txt', language: 'path-glob' },
      { pattern: 'todo.txt', language: 'exact-name' },
      { pattern: '/ws/todo.txt', language: 'exact-path' },
    ];

    expect(associatedLanguage('/ws/todo.txt', all)).toBe('exact-path');
    expect(associatedLanguage('/ws/todo.txt', all.slice(0, 3))).toBe('exact-name');
    expect(associatedLanguage('/ws/todo.txt', all.slice(0, 2))).toBe('path-glob');
    expect(associatedLanguage('/ws/todo.txt', all.slice(0, 1))).toBe('name-glob');
  });

  it('associatedLanguage_betweenTwoGlobs_takesTheLonger_thenTheFirstListed', () => {
    expect(
      associatedLanguage('/ws/app.config.js', [
        { pattern: '*.js', language: 'javascript' },
        { pattern: '*.config.js', language: 'json' },
      ]),
    ).toBe('json');
    expect(
      associatedLanguage('/ws/a.b', [
        { pattern: 'a.*', language: 'first' },
        { pattern: '*.b', language: 'second' },
      ]),
    ).toBe('first');
  });

  it('fileAssociations_keepsOnlyWellFormedEntries', () => {
    expect(
      fileAssociations([
        { pattern: '*.foo', language: 'json' },
        { pattern: ' ', language: 'json' },
        { pattern: '*.bar' },
        'nonsense',
        null,
      ]),
    ).toEqual([{ pattern: '*.foo', language: 'json' }]);
    expect(fileAssociations('nonsense')).toEqual([]);
  });

  it('withFileAssociation_replacesTheEntryForTheSamePattern_andAddsItLast', () => {
    const before: readonly FileAssociation[] = [
      { pattern: '*.FOO', language: 'json' },
      { pattern: '*.bar', language: 'xml' },
    ];

    expect(withFileAssociation(before, { pattern: ' *.foo ', language: 'yaml' })).toEqual([
      { pattern: '*.bar', language: 'xml' },
      { pattern: '*.foo', language: 'yaml' },
    ]);
  });

  it('withoutFileAssociation_removesThePattern', () => {
    expect(
      withoutFileAssociation(
        [
          { pattern: '*.foo', language: 'json' },
          { pattern: '*.bar', language: 'xml' },
        ],
        '*.Foo',
      ),
    ).toEqual([{ pattern: '*.bar', language: 'xml' }]);
  });

  it('extensionPattern_isTheEnding_orUndefinedForANameWithout', () => {
    expect(extensionPattern('/ws/Notes.FOO')).toBe('*.foo');
    expect(extensionPattern('C:\\ws\\Dockerfile.prod')).toBe('*.prod');
    expect(extensionPattern('/ws/Jenkinsfile')).toBeUndefined();
    expect(extensionPattern('/ws/.gitignore')).toBeUndefined();
  });
});
