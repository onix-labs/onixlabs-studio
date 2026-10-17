import type * as MonacoApi from 'monaco-editor';
import { registerScssLanguage, SCSS_LANGUAGE_ID, scssGrammar } from './monaco-scss-language';

/**
 * A token the interpreter emitted: the text it covers and its token name (without the postfix).
 */
interface Token {
  readonly text: string;
  readonly token: string;
}

/**
 * A rule compiled for the interpreter: its anchored expression and what a match does.
 */
interface CompiledRule {
  readonly regex: RegExp;
  readonly token: string;
  readonly next: string | undefined;
  readonly switchTo: string | undefined;
}

/**
 * The shape of an action object in the grammar.
 */
interface Action {
  readonly token: string;
  readonly next?: string;
  readonly switchTo?: string;
}

/**
 * Substitutes the grammar's `@attribute` references in a rule's source, as Monarch does.
 * @param grammar The grammar.
 * @param source The rule's source.
 * @returns Returns the substituted source.
 */
function substitute(grammar: MonacoApi.languages.IMonarchLanguage, source: string): string {
  return source.replace(/@(\w+)/g, (_match: string, attribute: string): string => {
    const value: unknown = (grammar as unknown as Record<string, unknown>)[attribute];
    if (typeof value !== 'string') {
      throw new Error(`The grammar has no attribute '${attribute}'`);
    }
    return value;
  });
}

/**
 * Compiles a state's rules, expanding its includes, the way Monarch does.
 * @param grammar The grammar.
 * @param state The state name.
 * @returns Returns the state's rules in order.
 */
function compileState(
  grammar: MonacoApi.languages.IMonarchLanguage,
  state: string,
): CompiledRule[] {
  const rules: unknown[] | undefined = (grammar.tokenizer as Record<string, unknown[]>)[state];
  if (rules === undefined) {
    throw new Error(`The grammar has no state '${state}'`);
  }
  return rules.flatMap((rule: unknown): CompiledRule[] => {
    if (!Array.isArray(rule)) {
      return compileState(grammar, (rule as { include: string }).include.slice(1));
    }
    const [source, action, next] = rule as [string, string | Action, string | undefined];
    const regex: RegExp = new RegExp(`^(?:${substitute(grammar, source)})`);
    return typeof action === 'string'
      ? [{ regex, token: action, next, switchTo: undefined }]
      : [{ regex, token: action.token, next: action.next, switchTo: action.switchTo }];
  });
}

/**
 * Tokenizes lines against a grammar with a minimal Monarch interpreter: at each position the first
 * rule of the current state that matches wins, and a character nothing matches takes the default
 * token. Enough of Monarch for this grammar, which uses only tokens, `next`, `switchTo` and `include`.
 * @param lines The source lines.
 * @returns Returns the tokens, across every line.
 */
function tokenize(...lines: string[]): Token[] {
  const grammar: MonacoApi.languages.IMonarchLanguage = scssGrammar();
  const tokens: Token[] = [];
  const stack: string[] = ['root'];
  for (const line of lines) {
    let position: number = 0;
    while (position < line.length) {
      const rest: string = line.slice(position);
      const state: string = stack[stack.length - 1];
      const rule: CompiledRule | undefined = compileState(grammar, state).find(
        (candidate: CompiledRule): boolean => candidate.regex.test(rest),
      );
      if (rule === undefined) {
        position++;
        continue;
      }
      const text: string = rule.regex.exec(rest)![0];
      if (text === '' && rule.next === undefined && rule.switchTo === undefined) {
        throw new Error(`No progress in state '${state}' at '${rest}'`);
      }
      if (text !== '') {
        tokens.push({ text, token: rule.token });
      }
      if (rule.switchTo !== undefined) {
        stack[stack.length - 1] = rule.switchTo.slice(1);
      } else if (rule.next === '@pop') {
        if (stack.length > 1) {
          stack.pop();
        }
      } else if (rule.next !== undefined) {
        stack.push(rule.next.slice(1));
      }
      position += text.length;
    }
  }
  return tokens;
}

/**
 * Gets the token name the first token with the given text was given.
 * @param tokens The tokens.
 * @param text The token text.
 * @returns Returns the token name, or undefined when no token has that text.
 */
function tokenOf(tokens: readonly Token[], text: string): string | undefined {
  return tokens.find((token: Token): boolean => token.text === text)?.token;
}

describe('SCSS grammar', (): void => {
  it('should compile every rule and name only states it defines', (): void => {
    const grammar: MonacoApi.languages.IMonarchLanguage = scssGrammar();
    for (const state of Object.keys(grammar.tokenizer)) {
      for (const rule of compileState(grammar, state)) {
        for (const target of [rule.next, rule.switchTo]) {
          if (target !== undefined && target !== '@pop') {
            expect(Object.keys(grammar.tokenizer)).toContain(target.slice(1));
          }
        }
      }
    }
  });

  it('should read @forward as one keyword, not @for followed by a selector', (): void => {
    const tokens: Token[] = tokenize('@forward "src/list" hide list-reset, $horizontal-list-gap;');

    expect(tokens[0]).toEqual({ text: '@forward', token: 'keyword' });
    expect(tokenOf(tokens, 'hide')).toBe('keyword');
    expect(tokenOf(tokens, 'list-reset')).toBe('attribute.value');
    expect(tokenOf(tokens, '$horizontal-list-gap')).toBe('variable.ref');
    expect(tokenOf(tokens, 'ward')).toBeUndefined();
  });

  it('should not read a member that starts with a clause keyword as the keyword', (): void => {
    const tokens: Token[] = tokenize('@forward "buttons" show show-button;');

    expect(tokenOf(tokens, 'show')).toBe('keyword');
    expect(tokenOf(tokens, 'show-button')).toBe('attribute.value');
  });

  it('should still read @for as a control statement', (): void => {
    const tokens: Token[] = tokenize(
      '@for $i from 1 through 3 {',
      '  .item-#{$i} { width: 2em; }',
      '}',
    );

    expect(tokens[0]).toEqual({ text: '@for', token: 'keyword.flow' });
    expect(tokenOf(tokens, 'from')).toBe('keyword.flow');
    expect(tokenOf(tokens, 'through')).toBe('keyword.flow');
    expect(tokenOf(tokens, 'width:')).toBe('attribute.name');
  });

  it('should read @use with a namespace, and namespaced members', (): void => {
    const tokens: Token[] = tokenize(
      '@use "sass:math" as m;',
      '.a { width: m.div(10px, 2); height: m.$pi; }',
    );

    expect(tokens[0]).toEqual({ text: '@use', token: 'keyword' });
    expect(tokenOf(tokens, 'as')).toBe('keyword');
    expect(tokenOf(tokens, '.a')).toBe('tag');
    expect(tokenOf(tokens, 'm.div(')).toBe('meta');
    expect(tokenOf(tokens, 'm.$pi')).toBe('variable.ref');
  });

  it('should read the configuration of @use ... with', (): void => {
    const tokens: Token[] = tokenize('@use "config" with ($primary: blue, $gap: 4px);', '.b {}');

    expect(tokenOf(tokens, 'with')).toBe('keyword');
    expect(tokenOf(tokens, '$primary:')).toBe('variable.decl');
    expect(tokenOf(tokens, '.b')).toBe('tag');
  });

  it('should read @error and @return inside a function', (): void => {
    const tokens: Token[] = tokenize(
      '@function double($x) {',
      '  @if $x == null { @error "Expected a number."; }',
      '  @return $x * 2;',
      '}',
      '.c {}',
    );

    expect(tokenOf(tokens, '@if')).toBe('keyword.flow');
    expect(tokenOf(tokens, '@error')).toBe('keyword');
    expect(tokenOf(tokens, '@return')).toBe('keyword');
    expect(tokenOf(tokens, '.c')).toBe('tag');
  });

  it('should read a namespaced @include with a using clause', (): void => {
    const tokens: Token[] = tokenize('.d { @include mixins.card using ($theme) { color: red; } }');

    expect(tokenOf(tokens, '@include')).toBe('keyword');
    expect(tokenOf(tokens, 'mixins.card')).toBe('meta');
    expect(tokenOf(tokens, 'using')).toBe('keyword');
    expect(tokenOf(tokens, 'color:')).toBe('attribute.name');
  });

  it('should read CSS at-rules with a block or a semicolon', (): void => {
    const tokens: Token[] = tokenize(
      '@layer base, components;',
      '@media screen and (min-width: 100px) { .e { color: red; } }',
      '@container card (min-width: 20em) { .f {} }',
      '.g {}',
    );

    expect(tokenOf(tokens, '@layer')).toBe('keyword');
    expect(tokenOf(tokens, '@media')).toBe('keyword');
    expect(tokenOf(tokens, '@container')).toBe('keyword');
    expect(tokenOf(tokens, '.e')).toBe('tag');
    expect(tokenOf(tokens, '.f')).toBe('tag');
    expect(tokenOf(tokens, '.g')).toBe('tag');
  });

  it('should read an at-rule it does not know as a keyword rather than a selector', (): void => {
    const tokens: Token[] = tokenize('@tailwind base;', '.h { @apply font-bold; }');

    expect(tokenOf(tokens, '@tailwind')).toBe('keyword');
    expect(tokenOf(tokens, '@apply')).toBe('keyword');
    expect(tokenOf(tokens, '.h')).toBe('tag');
  });

  it('should read @at-root and the !global flag', (): void => {
    const tokens: Token[] = tokenize('.i { @at-root .j { $k: 1 !global; } }');

    expect(tokenOf(tokens, '@at-root')).toBe('keyword');
    expect(tokenOf(tokens, '!global')).toBe('literal');
  });
});

describe('registerScssLanguage', (): void => {
  it('should replace the SCSS tokens provider', (): void => {
    const setMonarchTokensProvider: ReturnType<typeof vi.fn> = vi.fn();
    const monaco: typeof MonacoApi = {
      languages: { setMonarchTokensProvider },
    } as unknown as typeof MonacoApi;

    registerScssLanguage(monaco);

    expect(setMonarchTokensProvider).toHaveBeenCalledWith(SCSS_LANGUAGE_ID, scssGrammar());
  });

  it('should do nothing before Monaco has loaded', (): void => {
    expect((): void => registerScssLanguage(undefined)).not.toThrow();
  });
});
