import type * as MonacoApi from 'monaco-editor';
import { registerTomlLanguage, TOML_LANGUAGE_ID } from './monaco-toml-language';

/**
 * What a fake Monaco recorded of a registration.
 */
interface Recorded {
  readonly languages: MonacoApi.languages.ILanguageExtensionPoint[];
  grammar: MonacoApi.languages.IMonarchLanguage | null;
  configured: number;
}

/**
 * Builds a fake Monaco namespace that records what is registered on it.
 * @param recorded Where the registrations are recorded.
 * @returns Returns the fake namespace.
 */
function fakeMonaco(recorded: Recorded): typeof MonacoApi {
  return {
    languages: {
      getLanguages: (): MonacoApi.languages.ILanguageExtensionPoint[] => recorded.languages,
      register: (language: MonacoApi.languages.ILanguageExtensionPoint): void => {
        recorded.languages.push(language);
      },
      setMonarchTokensProvider: (
        _id: string,
        grammar: MonacoApi.languages.IMonarchLanguage,
      ): void => {
        recorded.grammar = grammar;
      },
      setLanguageConfiguration: (): void => {
        recorded.configured += 1;
      },
    },
  } as unknown as typeof MonacoApi;
}

/**
 * Finds the token the grammar's root state gives the start of a line: the first rule that matches there.
 * @param grammar The grammar.
 * @param line The line.
 * @returns Returns the token name, or null when no rule matches.
 */
function firstToken(grammar: MonacoApi.languages.IMonarchLanguage, line: string): string | null {
  const rules: unknown[] = (grammar.tokenizer as Record<string, unknown[]>)['root'];
  for (const rule of rules) {
    const [pattern, token] = rule as [RegExp, string];
    if (new RegExp(`^(?:${pattern.source})`).test(line)) {
      return token;
    }
  }
  return null;
}

/**
 * Tokenises one line with the grammar's root state as Monarch does: at each position the first rule
 * that matches there wins, a `^` rule matching only at the line's start. Whitespace is skipped.
 * @param grammar The grammar.
 * @param line The line.
 * @returns Returns each token's text and name, in order.
 */
function tokens(grammar: MonacoApi.languages.IMonarchLanguage, line: string): string[] {
  const rules: unknown[] = (grammar.tokenizer as Record<string, unknown[]>)['root'];
  const found: string[] = [];
  let position: number = 0;
  while (position < line.length) {
    if (/\s/.test(line[position])) {
      position += 1;
      continue;
    }
    let matched: boolean = false;
    for (const rule of rules) {
      const [pattern, token] = rule as [RegExp, string];
      const sticky: RegExp = new RegExp(pattern.source, 'y');
      sticky.lastIndex = position;
      const match: RegExpExecArray | null = sticky.exec(line);
      if (match !== null && match[0].length > 0) {
        found.push(`${match[0].trim()}:${token}`);
        position += match[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      position += 1;
    }
  }
  return found;
}

describe('monaco-toml-language', () => {
  it('registerTomlLanguage_registersTheLanguageOnce_soATomlModelIsNotPlainText', () => {
    const recorded: Recorded = { languages: [], grammar: null, configured: 0 };
    const monaco: typeof MonacoApi = fakeMonaco(recorded);
    registerTomlLanguage(monaco);
    registerTomlLanguage(monaco);
    expect(recorded.languages.map((language) => language.id)).toEqual([TOML_LANGUAGE_ID]);
    expect(recorded.languages[0].extensions).toEqual(['.toml']);
    expect(recorded.configured).toBe(1);
  });

  it('registerTomlLanguage_doesNothingBeforeMonacoLoads', () => {
    expect((): void => registerTomlLanguage(undefined)).not.toThrow();
  });

  it('grammar_classifiesHeadersKeysCommentsAndValues', () => {
    const recorded: Recorded = { languages: [], grammar: null, configured: 0 };
    registerTomlLanguage(fakeMonaco(recorded));
    const grammar: MonacoApi.languages.IMonarchLanguage = recorded.grammar!;
    expect(firstToken(grammar, '# a comment')).toBe('comment');
    expect(firstToken(grammar, '[[bin]]')).toBe('type');
    expect(firstToken(grammar, '[package]')).toBe('type');
    expect(firstToken(grammar, 'name = "x"')).toBe('variable');
    expect(firstToken(grammar, '"text"')).toBe('string');
    expect(firstToken(grammar, 'true')).toBe('keyword');
    expect(firstToken(grammar, '1979-05-27T07:32:00Z')).toBe('number');
    expect(firstToken(grammar, '0x1F')).toBe('number');
  });

  it('grammar_colorsAFloatAsANumber_notItsLeadingDigitsAsAKey', () => {
    // The key rule once ran first and took the `3` of `3.14`, as if it were the dotted key `3.14 = …`.
    const recorded: Recorded = { languages: [], grammar: null, configured: 0 };
    registerTomlLanguage(fakeMonaco(recorded));
    const grammar: MonacoApi.languages.IMonarchLanguage = recorded.grammar!;

    expect(tokens(grammar, 'pi = 3.14')).toEqual(['pi:variable', '=:delimiter', '3.14:number']);
    expect(tokens(grammar, 'big = 1_000.5')).toEqual([
      'big:variable',
      '=:delimiter',
      '1_000.5:number',
    ]);
    expect(tokens(grammar, 'neg = -1.5')).toEqual(['neg:variable', '=:delimiter', '-1.5:number']);
    // A value on a wrapped array's own line has no `=` after it.
    expect(tokens(grammar, '  3.14,')).toEqual(['3.14:number', ',:delimiter']);
    expect(tokens(grammar, 'x = { y = 2.5 }')).toEqual([
      'x:variable',
      '=:delimiter',
      '{:delimiter',
      'y:variable',
      '=:delimiter',
      '2.5:number',
      '}:delimiter',
    ]);
  });

  it('grammar_keepsABareKeyThatStartsWithADigit_onTheLeftOfAnEquals', () => {
    // TOML allows a bare key of digits: `1234 = "x"`, and the dotted `1.2 = true`.
    const recorded: Recorded = { languages: [], grammar: null, configured: 0 };
    registerTomlLanguage(fakeMonaco(recorded));
    const grammar: MonacoApi.languages.IMonarchLanguage = recorded.grammar!;

    expect(tokens(grammar, '1234 = "x"')).toEqual(['1234:variable', '=:delimiter', '"x":string']);
    expect(tokens(grammar, '1.2 = true')).toEqual(['1.2:variable', '=:delimiter', 'true:keyword']);
    expect(tokens(grammar, 'a.b = 1')).toEqual(['a.b:variable', '=:delimiter', '1:number']);
  });
});
