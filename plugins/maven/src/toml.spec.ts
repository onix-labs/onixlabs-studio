import { describe, expect, it } from 'vitest';
import { parseToml, TomlTable } from './toml';

describe('parseToml', () => {
  it('parseToml_tablesAndStrings_readsThem', () => {
    const document: TomlTable = parseToml(
      '# a catalog\n[versions]\nkotlin = "2.0.0" # trailing\nliteral = \'C:\\path\'\n\n[libraries]\n',
    );

    expect(document).toEqual({ versions: { kotlin: '2.0.0', literal: 'C:\\path' }, libraries: {} });
  });

  it('parseToml_inlineTablesWithDottedKeys_nestsThem', () => {
    const document: TomlTable = parseToml(
      '[libraries]\njackson = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }',
    );

    expect(document['libraries']).toEqual({
      jackson: {
        module: 'com.fasterxml.jackson.core:jackson-databind',
        version: { ref: 'jackson' },
      },
    });
  });

  it('parseToml_multiLineArrayWithTrailingComma_readsEveryEntry', () => {
    const document: TomlTable = parseToml(
      '[bundles]\ntesting = [\n  "junit", # first\n  "mockk",\n]\n',
    );

    expect(document['bundles']).toEqual({ testing: ['junit', 'mockk'] });
  });

  it('parseToml_escapesInBasicStrings_decodesThem', () => {
    expect(parseToml('a = "x\\ty\\u0041\\"z"')).toEqual({ a: 'x\tyA"z' });
  });

  it('parseToml_quotedKeysAndBareValues_keepsValuesAsText', () => {
    expect(parseToml('"my key" = 1\nflag = true')).toEqual({ 'my key': '1', flag: 'true' });
  });

  it('parseToml_aLineItCannotRead_skipsItAndReadsTheRest', () => {
    const document: TomlTable = parseToml('broken = """multi\nline"""\ngood = "yes"\n');

    expect(document['good']).toBe('yes');
    expect(document['broken']).toBeUndefined();
  });

  it('parseToml_redefinedKey_keepsTheFirst', () => {
    expect(parseToml('a = "1"\na = "2"')).toEqual({ a: '1' });
  });

  it('parseToml_arrayOfTables_skipsWhatIsUnderIt', () => {
    expect(parseToml('[[plugins]]\nid = "x"\n[versions]\nk = "1"')).toEqual({
      versions: { k: '1' },
    });
  });
});
