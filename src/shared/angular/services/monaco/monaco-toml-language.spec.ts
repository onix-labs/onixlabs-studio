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
});
