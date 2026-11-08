import { describe, expect, it } from 'vitest';
import { parseToml, TomlError, TomlTable } from './toml';

describe('parseToml', () => {
  it('parseToml_keyValuesAndTables_readsTheirValues', () => {
    // Arrange
    const text: string = [
      '# a comment',
      'title = "demo" # trailing comment',
      '',
      '[package]',
      'name = "app"',
      'edition = "2021"',
      'publish = false',
      'answer = 42',
    ].join('\n');

    // Act
    const document: TomlTable = parseToml(text);

    // Assert
    expect(document).toEqual({
      title: 'demo',
      package: { name: 'app', edition: '2021', publish: false, answer: 42 },
    });
  });

  it('parseToml_dottedAndQuotedKeys_writeIntoNestedTables', () => {
    // Arrange
    const text: string = [
      'serde.workspace = true',
      "[target.'cfg(unix)'.dependencies]",
      'libc = "0.2"',
      '[target."x86_64-pc-windows-gnu".dependencies]',
      'winapi = "0.3"',
    ].join('\n');

    // Act
    const document: TomlTable = parseToml(text);

    // Assert
    expect(document).toEqual({
      serde: { workspace: true },
      target: {
        'cfg(unix)': { dependencies: { libc: '0.2' } },
        'x86_64-pc-windows-gnu': { dependencies: { winapi: '0.3' } },
      },
    });
  });

  it('parseToml_inlineTablesAndMultilineArrays_readWithCommentsAndTrailingCommas', () => {
    // Arrange
    const text: string = [
      'serde = { version = "1.0", features = ["derive", "rc"] }',
      'members = [',
      '  "crates/*", # every crate',
      '  "tools/cli",',
      ']',
      'empty = {}',
    ].join('\n');

    // Act
    const document: TomlTable = parseToml(text);

    // Assert
    expect(document).toEqual({
      serde: { version: '1.0', features: ['derive', 'rc'] },
      members: ['crates/*', 'tools/cli'],
      empty: {},
    });
  });

  it('parseToml_arraysOfTables_appendATableEach', () => {
    // Arrange
    const text: string = [
      'version = 4',
      '[[package]]',
      'name = "a"',
      'dependencies = ["b 1.0.0"]',
      '[[package]]',
      'name = "b"',
      '[package.metadata]',
      'note = "belongs to b"',
    ].join('\n');

    // Act
    const document: TomlTable = parseToml(text);

    // Assert
    expect(document).toEqual({
      version: 4,
      package: [
        { name: 'a', dependencies: ['b 1.0.0'] },
        { name: 'b', metadata: { note: 'belongs to b' } },
      ],
    });
  });

  it('parseToml_everyStringForm_readsEscapesAndLineJoins', () => {
    // Arrange
    const text: string = [
      'basic = "tab\\there \\"quoted\\" \\u00e9"',
      "literal = 'C:\\path\\no-escapes'",
      'multi = """',
      'one \\',
      '    two"""',
      "raw = '''",
      'first',
      "second'''",
      'quotes = """a ""quote"" here"""""',
    ].join('\n');

    // Act
    const document: TomlTable = parseToml(text);

    // Assert
    expect(document).toEqual({
      basic: 'tab\there "quoted" é',
      literal: 'C:\\path\\no-escapes',
      multi: 'one two',
      raw: 'first\nsecond',
      quotes: 'a ""quote"" here""',
    });
  });

  it('parseToml_numbersAndDates_readNumbersAndKeepDatesAsText', () => {
    // Arrange
    const text: string = [
      'big = 1_000',
      'hex = 0xff',
      'negative = -3',
      'float = 1.5e3',
      'when = 1979-05-27T07:32:00Z',
      'spaced = 1979-05-27 07:32:00',
    ].join('\n');

    // Act
    const document: TomlTable = parseToml(text);

    // Assert
    expect(document).toEqual({
      big: 1000,
      hex: 255,
      negative: -3,
      float: 1500,
      when: '1979-05-27T07:32:00Z',
      spaced: '1979-05-27 07:32:00',
    });
  });

  it('parseToml_crlfAndBom_readAsPlainLines', () => {
    // Arrange
    const text: string = '\uFEFF[package]\r\nname = "app"\r\n';

    // Act
    const document: TomlTable = parseToml(text);

    // Assert
    expect(document).toEqual({ package: { name: 'app' } });
  });

  it('parseToml_unclosedString_throwsWithTheLine', () => {
    // Arrange
    const text: string = 'a = 1\nb = "never closed\n';

    // Act
    const act: () => TomlTable = (): TomlTable => parseToml(text);

    // Assert
    expect(act).toThrow(TomlError);
    expect(act).toThrow(/line 2/);
  });

  it('parseToml_bareWordValue_isRefusedRatherThanGuessed', () => {
    // Arrange
    const text: string = 'a = yes';

    // Act
    const act: () => TomlTable = (): TomlTable => parseToml(text);

    // Assert
    expect(act).toThrow(TomlError);
  });

  it('parseToml_twoValuesOnALine_isRefused', () => {
    // Arrange
    const text: string = 'a = 1 b = 2';

    // Act
    const act: () => TomlTable = (): TomlTable => parseToml(text);

    // Assert
    expect(act).toThrow(/end of the line/);
  });

  it('parseToml_tableOverAValue_isRefused', () => {
    // Arrange
    const text: string = 'a = 1\n[a.b]\n';

    // Act
    const act: () => TomlTable = (): TomlTable => parseToml(text);

    // Assert
    expect(act).toThrow(/already a value/);
  });
});
