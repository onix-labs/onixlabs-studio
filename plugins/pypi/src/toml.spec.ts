import { describe, expect, it } from 'vitest';
import { parseToml } from './toml';

describe('parseToml', () => {
  it('parseToml_tablesAndDottedKeys_buildNestedTables', () => {
    // Arrange
    const text: string = [
      '[project]',
      'name = "demo"  # a comment',
      'urls.homepage = "https://example.com"',
      '',
      '[tool.poetry.group.dev.dependencies]',
      'pytest = "^8"',
    ].join('\n');

    // Act
    const toml: unknown = parseToml(text);

    // Assert
    expect(toml).toEqual({
      project: { name: 'demo', urls: { homepage: 'https://example.com' } },
      tool: { poetry: { group: { dev: { dependencies: { pytest: '^8' } } } } },
    });
  });

  it('parseToml_arraysAcrossLinesWithCommentsAndATrailingComma_readsEveryItem', () => {
    // Arrange
    const text: string = [
      'dependencies = [',
      '  "requests>=2.31", # pinned low',
      "  'rich',",
      '  [1, 2],',
      ']',
    ].join('\n');

    // Act
    const toml: unknown = parseToml(text);

    // Assert
    expect(toml).toEqual({ dependencies: ['requests>=2.31', 'rich', [1, 2]] });
  });

  it('parseToml_arraysOfTables_appendOneTableEach_andSubTablesGoToTheLast', () => {
    // Arrange
    const text: string = [
      '[[package]]',
      'name = "a"',
      'version = "1.0"',
      '[package.source]',
      'registry = "https://pypi.org/simple"',
      '[[package]]',
      'name = "b"',
      'version = "2.0"',
    ].join('\n');

    // Act
    const toml: unknown = parseToml(text);

    // Assert
    expect(toml).toEqual({
      package: [
        { name: 'a', version: '1.0', source: { registry: 'https://pypi.org/simple' } },
        { name: 'b', version: '2.0' },
      ],
    });
  });

  it('parseToml_inlineTablesAndScalars_readTheirValues', () => {
    // Arrange
    const text: string = [
      'requests = { version = "^2.31", optional = true, extras = ["socks"] }',
      'empty = {}',
      'count = 1_000',
      'ratio = 0.5',
      'flag = false',
      'when = 1979-05-27 07:32:00Z',
      '"quoted key" = \'literal \\ no escape\'',
    ].join('\n');

    // Act
    const toml: unknown = parseToml(text);

    // Assert
    expect(toml).toEqual({
      requests: { version: '^2.31', optional: true, extras: ['socks'] },
      empty: {},
      count: 1000,
      ratio: 0.5,
      flag: false,
      when: '1979-05-27 07:32:00Z',
      'quoted key': 'literal \\ no escape',
    });
  });

  it('parseToml_multilineAndEscapedStrings_readAsTOMLDefines', () => {
    // Arrange
    const text: string = [
      'basic = "tab\\tquote\\" \\u00e9"',
      'multi = """',
      'one \\',
      '   two"""',
      "raw = '''",
      "a 'b' c'''",
      'hash = "not # a comment"',
    ].join('\n');

    // Act
    const toml: unknown = parseToml(text);

    // Assert
    expect(toml).toEqual({
      basic: 'tab\tquote" é',
      multi: 'one two',
      raw: "a 'b' c",
      hash: 'not # a comment',
    });
  });

  it.each<[string, string]>([
    ['aKeySetTwice', 'a = 1\na = 2'],
    ['aTableDeclaredTwice', '[a]\n[a]'],
    ['anUnclosedString', 'a = "open'],
    ['anUnclosedArray', 'a = [1, 2'],
    ['somethingAfterAValue', 'a = 1 b = 2'],
    ['aValueThatIsNot', 'a = nope'],
  ])('parseToml_%s_isRefusedWhole', (_name: string, text: string) => {
    // Act
    const toml: unknown = parseToml(text);

    // Assert
    expect(toml).toBeNull();
  });

  it('parseToml_aByteOrderMarkAndCrlf_areReadPast', () => {
    // Act
    const toml: unknown = parseToml('﻿[a]\r\nb = "c"\r\n');

    // Assert
    expect(toml).toEqual({ a: { b: 'c' } });
  });
});
