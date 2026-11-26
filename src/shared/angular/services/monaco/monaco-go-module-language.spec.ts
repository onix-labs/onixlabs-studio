import type * as MonacoApi from 'monaco-editor';
import {
  GO_MODULE_LANGUAGE_ID,
  GO_WORKSPACE_LANGUAGE_ID,
  goModuleGrammar,
  registerGoModuleLanguages,
} from './monaco-go-module-language';

/**
 * A token the interpreter emitted: the text it covers and its token name.
 */
interface Token {
  readonly text: string;
  readonly token: string;
}

/**
 * The shape of a `cases` action in the grammar.
 */
interface CasesAction {
  readonly cases: Readonly<Record<string, string>>;
}

/**
 * Tokenizes one line with the grammar's root rules, as Monarch does for a grammar with one state: the
 * first rule that matches at the position wins, `^` matches only at the start of the line, and a
 * `cases` action picks by the grammar's keyword list.
 * @param line The line.
 * @returns Returns the tokens, whitespace left out.
 */
function tokenize(line: string): Token[] {
  const grammar: MonacoApi.languages.IMonarchLanguage = goModuleGrammar();
  const rules: unknown[] = (grammar.tokenizer as Record<string, unknown[]>)['root'];
  const keywords: readonly string[] = (grammar as unknown as { keywords: string[] }).keywords;
  const tokens: Token[] = [];
  let position: number = 0;
  while (position < line.length) {
    if (/\s/.test(line[position])) {
      position++;
      continue;
    }
    let matched: boolean = false;
    for (const rule of rules) {
      const [pattern, action]: [RegExp, string | CasesAction] = rule as [
        RegExp,
        string | CasesAction,
      ];
      if (pattern.source.startsWith('^') && position !== 0) {
        continue;
      }
      const sticky: RegExp = new RegExp(pattern.source.replace(/^\^/, ''), 'y');
      sticky.lastIndex = position;
      const match: RegExpExecArray | null = sticky.exec(line);
      if (match === null || match[0].length === 0) {
        continue;
      }
      const token: string =
        typeof action === 'string'
          ? action
          : keywords.includes(match[0])
            ? action.cases['@keywords']
            : action.cases['@default'];
      tokens.push({ text: match[0], token });
      position += match[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      throw new Error(`No rule matches at ${position} in '${line}'`);
    }
  }
  return tokens;
}

/**
 * A fake of the part of Monaco's languages API the registration uses.
 */
class FakeLanguages {
  public readonly registered: MonacoApi.languages.ILanguageExtensionPoint[] = [];
  public readonly grammars: string[] = [];
  public readonly configurations: string[] = [];

  /**
   * Lists the registered languages.
   * @returns Returns them.
   */
  public getLanguages(): MonacoApi.languages.ILanguageExtensionPoint[] {
    return this.registered;
  }

  /**
   * Registers a language.
   * @param language The language.
   */
  public register(language: MonacoApi.languages.ILanguageExtensionPoint): void {
    this.registered.push(language);
  }

  /**
   * Records a grammar set for a language.
   * @param id The language.
   */
  public setMonarchTokensProvider(id: string): void {
    this.grammars.push(id);
  }

  /**
   * Records a configuration set for a language.
   * @param id The language.
   */
  public setLanguageConfiguration(id: string): void {
    this.configurations.push(id);
  }
}

describe('registerGoModuleLanguages', (): void => {
  it('registers go.mod and go.work by their whole file names, as gopls names them', (): void => {
    const languages: FakeLanguages = new FakeLanguages();

    registerGoModuleLanguages({ languages } as unknown as typeof MonacoApi);

    expect(languages.registered).toEqual([
      { id: 'go.mod', filenames: ['go.mod'] },
      { id: 'go.work', filenames: ['go.work'] },
    ]);
    expect(languages.grammars).toEqual([GO_MODULE_LANGUAGE_ID, GO_WORKSPACE_LANGUAGE_ID]);
    expect(languages.configurations).toEqual([GO_MODULE_LANGUAGE_ID, GO_WORKSPACE_LANGUAGE_ID]);
  });

  it('registers each language once however often it is called', (): void => {
    const languages: FakeLanguages = new FakeLanguages();
    const monaco: typeof MonacoApi = { languages } as unknown as typeof MonacoApi;

    registerGoModuleLanguages(monaco);
    registerGoModuleLanguages(monaco);

    expect(languages.registered).toHaveLength(2);
  });

  it('does nothing before Monaco has loaded', (): void => {
    expect((): void => registerGoModuleLanguages(undefined)).not.toThrow();
  });
});

describe('the go.mod grammar', (): void => {
  it('colours a directive, a module path and a Go release', (): void => {
    expect(tokenize('module example.com/fixture')).toEqual([
      { text: 'module', token: 'keyword' },
      { text: 'example.com/fixture', token: 'identifier' },
    ]);
    expect(tokenize('go 1.27')).toEqual([
      { text: 'go', token: 'keyword' },
      { text: '1.27', token: 'number' },
    ]);
  });

  it('colours a requirement in a block, with its version and comment', (): void => {
    expect(tokenize('require (')).toEqual([
      { text: 'require', token: 'keyword' },
      { text: '(', token: 'delimiter' },
    ]);
    expect(tokenize('\tgolang.org/x/text v0.44.0 // indirect')).toEqual([
      { text: 'golang.org/x/text', token: 'identifier' },
      { text: 'v0.44.0', token: 'number' },
      { text: '// indirect', token: 'comment' },
    ]);
  });

  it('colours a replacement and a pseudo-version', (): void => {
    expect(tokenize('replace a.example/m => ../m v0.0.0-20260101000000-abcdef123456')).toEqual([
      { text: 'replace', token: 'keyword' },
      { text: 'a.example/m', token: 'identifier' },
      { text: '=>', token: 'operator' },
      { text: '../m', token: 'identifier' },
      { text: 'v0.0.0-20260101000000-abcdef123456', token: 'number' },
    ]);
  });

  it('takes no indented path segment for a directive', (): void => {
    expect(tokenize('\ttool')).toEqual([{ text: 'tool', token: 'identifier' }]);
  });
});
