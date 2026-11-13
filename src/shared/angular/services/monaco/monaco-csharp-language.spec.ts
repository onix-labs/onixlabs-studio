import type * as MonacoApi from 'monaco-editor';
import {
  CSHARP_LANGUAGE_ID,
  csharpGrammar,
  registerCsharpLanguage,
} from './monaco-csharp-language';

/**
 * A token the interpreter emitted: the text it covers and its token name (without the postfix).
 */
interface Token {
  readonly text: string;
  readonly token: string;
}

/**
 * An action as the grammar writes it: a token name, a token with a state change, a set of cases, or
 * one action per group of the match.
 */
type Action =
  | string
  | { readonly token?: string; readonly next?: string; readonly cases?: Record<string, Action> }
  | readonly Action[];

/**
 * A rule compiled for the interpreter: its anchored expression and what a match does.
 */
interface CompiledRule {
  readonly regex: RegExp;
  readonly action: Action;
}

/**
 * Substitutes the grammar's `@attribute` references in a rule's source, as Monarch does: a string
 * attribute as itself, a regular expression attribute by its source.
 * @param grammar The grammar.
 * @param source The rule's source.
 * @returns Returns the substituted source.
 */
function substitute(grammar: MonacoApi.languages.IMonarchLanguage, source: string): string {
  return source.replace(/@(\w+)/g, (match: string, attribute: string): string => {
    const value: unknown = (grammar as unknown as Record<string, unknown>)[attribute];
    if (typeof value === 'string') {
      return value;
    }
    return value instanceof RegExp ? value.source : match;
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
    const [pattern, action, next] = rule as [RegExp | string, Action, string | undefined];
    const source: string = pattern instanceof RegExp ? pattern.source : pattern;
    return [
      {
        regex: new RegExp(`^(?:${substitute(grammar, source)})`),
        action: next === undefined ? action : { token: action as string, next },
      },
    ];
  });
}

/**
 * Resolves an action against the matched text: a `cases` action picks its first case whose guard
 * holds (`@attribute` membership, or `@default`); a `$S2==` guard is taken as false, as no fixture
 * here is inside an interpolated string.
 * @param grammar The grammar.
 * @param action The action.
 * @param text The matched text.
 * @returns Returns the resolved token and state change.
 */
function resolve(
  grammar: MonacoApi.languages.IMonarchLanguage,
  action: Action,
  text: string,
): { token: string; next: string | undefined } {
  if (typeof action === 'string') {
    return { token: action, next: undefined };
  }
  if (Array.isArray(action)) {
    throw new Error('Group actions are resolved per group');
  }
  const object: { token?: string; next?: string; cases?: Record<string, Action> } = action as {
    token?: string;
    next?: string;
    cases?: Record<string, Action>;
  };
  if (object.cases !== undefined) {
    for (const [guard, choice] of Object.entries(object.cases)) {
      const list: unknown = (grammar as unknown as Record<string, unknown>)[guard.slice(1)];
      if (guard === '@default' || (Array.isArray(list) && list.includes(text))) {
        return resolve(grammar, choice, text);
      }
    }
    return { token: '', next: undefined };
  }
  return { token: object.token ?? '', next: object.next };
}

/**
 * Tokenizes lines against the C# grammar with a minimal Monarch interpreter: at each position the
 * first rule of the current state that matches wins. Supports what this grammar uses: token names,
 * `$0`, `cases`, group actions, `@brackets`, `next` and `@pop`.
 * @param lines The source lines.
 * @returns Returns the tokens, across every line, with whitespace and empty tokens left out.
 */
function tokenize(...lines: string[]): Token[] {
  const grammar: MonacoApi.languages.IMonarchLanguage = csharpGrammar();
  const tokens: Token[] = [];
  const stack: string[] = ['root'];
  const emit: (text: string, token: string) => void = (text: string, token: string): void => {
    const name: string = token === '@brackets' ? 'delimiter' : token.replace('$0', text);
    if (text.trim() !== '' && name !== '') {
      tokens.push({ text, token: name });
    }
  };
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
      const match: RegExpExecArray = rule.regex.exec(rest)!;
      let next: string | undefined;
      if (Array.isArray(rule.action)) {
        // A group action: one token per capture group, in order.
        const groups: string[] = match.slice(1);
        (rule.action as readonly Action[]).forEach((group: Action, index: number): void => {
          emit(groups[index] ?? '', resolve(grammar, group, groups[index] ?? '').token);
        });
      } else {
        const resolved: { token: string; next: string | undefined } = resolve(
          grammar,
          rule.action,
          match[0],
        );
        emit(match[0], resolved.token);
        next = resolved.next;
      }
      if (next === '@pop') {
        if (stack.length > 1) {
          stack.pop();
        }
      } else if (next !== undefined) {
        stack.push(next.slice(1));
      }
      if (match[0] === '' && next === undefined) {
        throw new Error(`No progress in state '${state}' at '${rest}'`);
      }
      position += match[0].length;
    }
  }
  return tokens;
}

/**
 * Gets the token name the n-th token with the given text was given.
 * @param tokens The tokens.
 * @param text The token text.
 * @param nth Which occurrence, from zero.
 * @returns Returns the token name, or undefined when there is no such token.
 */
function tokenOf(tokens: readonly Token[], text: string, nth: number = 0): string | undefined {
  return tokens.filter((token: Token): boolean => token.text === text)[nth]?.token;
}

describe('C# grammar', (): void => {
  it('should compile every rule and name only states it defines', (): void => {
    const grammar: MonacoApi.languages.IMonarchLanguage = csharpGrammar();
    for (const state of Object.keys(grammar.tokenizer)) {
      for (const rule of compileState(grammar, state)) {
        const next: unknown = (rule.action as { next?: unknown }).next;
        if (typeof next === 'string' && next !== '@pop') {
          // `@string`, or a dotted sub-state of a defined state such as `root.interpolatedstring`.
          expect(Object.keys(grammar.tokenizer)).toContain(next.replace(/^@/, '').split('.')[0]);
        }
      }
    }
  });

  it('should still read the keywords Monaco already knew', (): void => {
    const tokens: Token[] = tokenize('public sealed class Cat { int Lives => 9; }');

    expect(tokenOf(tokens, 'public')).toBe('keyword.public');
    expect(tokenOf(tokens, 'class')).toBe('keyword.class');
    expect(tokenOf(tokens, 'Cat')).toBe('identifier');
  });

  it("should read Monaco's strings, numbers and comments as Monaco does", (): void => {
    // The rules whose escapes were tidied for lint: verbatim strings, exponents and comments.
    const tokens: Token[] = tokenize('var a = @"x"; var b = $@"y"; var c = 1.5e-3; /* d */ // e');

    expect(tokenOf(tokens, '@"')).toBe('string.quote');
    expect(tokenOf(tokens, '$@"')).toBe('string.quote');
    expect(tokenOf(tokens, '1.5e-3')).toBe('number.float');
    expect(tokenOf(tokens, '/*')).toBe('comment');
    expect(tokenOf(tokens, '// e')).toBe('comment');
    expect(tokenOf(tokens, 'var')).toBe('keyword.var');
  });

  it('should read a union declaration, generic or not', (): void => {
    expect(tokenOf(tokenize('public union Pet(Cat, Dog, Bird);'), 'union')).toBe('keyword.union');
    expect(tokenOf(tokenize('public union Result<T>(Ok<T>, Error);'), 'union')).toBe(
      'keyword.union',
    );
  });

  it('should read a closed class or record, after its other modifiers', (): void => {
    expect(tokenOf(tokenize('public closed record class JobStatus;'), 'closed')).toBe(
      'keyword.closed',
    );
    expect(tokenOf(tokenize('public closed record class JobStatus;'), 'record')).toBe(
      'keyword.record',
    );
    expect(tokenOf(tokenize('internal closed partial class Shape { }'), 'closed')).toBe(
      'keyword.closed',
    );
  });

  it('should read records, positional or not', (): void => {
    expect(tokenOf(tokenize('public record Dog(string Name);'), 'record')).toBe('keyword.record');
    expect(tokenOf(tokenize('public record struct Point(int X);'), 'record')).toBe(
      'keyword.record',
    );
  });

  it('should read with as the first element of a collection expression', (): void => {
    const tokens: Token[] = tokenize('List<string> names = [with(capacity: 10), .. values];');

    expect(tokenOf(tokens, 'with')).toBe('keyword.with');
    expect(tokenOf(tokens, '[')).toBe('delimiter.square');
  });

  it('should read with in a with-expression', (): void => {
    expect(tokenOf(tokenize('var moved = point with { X = 1 };'), 'with')).toBe('keyword.with');
  });

  it('should read an extension block, but not a call to a method named extension', (): void => {
    expect(tokenOf(tokenize('    extension(IEnumerable<int> sequence)'), 'extension')).toBe(
      'keyword.extension',
    );
    expect(tokenOf(tokenize('    extension<T>(List<T> list) {'), 'extension')).toBe(
      'keyword.extension',
    );
    expect(tokenOf(tokenize('extension(value);'), 'extension')).toBe('identifier');
  });

  it('should leave the same words as identifiers where they are names', (): void => {
    // The cases that would read wrong if these were added to the keyword list outright.
    expect(tokenOf(tokenize('bool closed = door.IsClosed;'), 'closed')).toBe('identifier');
    expect(tokenOf(tokenize('var union = left.Union(right);'), 'union')).toBe('identifier');
    expect(tokenOf(tokenize('var record = Load();'), 'record')).toBe('identifier');
    expect(tokenOf(tokenize('builder.with(value);'), 'with')).toBe('identifier');
    expect(tokenOf(tokenize('Process(@union);'), '@union')).toBe('identifier');
  });

  it('should leave labels and labeled jumps as Monaco reads them', (): void => {
    const tokens: Token[] = tokenize('rows: for (;;) { continue rows; break rows; }');

    expect(tokenOf(tokens, 'rows')).toBe('identifier');
    expect(tokenOf(tokens, 'continue')).toBe('keyword.continue');
    expect(tokenOf(tokens, 'break')).toBe('keyword.break');
    expect(tokenOf(tokens, 'rows', 2)).toBe('identifier');
  });
});

describe('registerCsharpLanguage', (): void => {
  it('should replace the C# tokens provider', (): void => {
    const calls: [string, unknown][] = [];
    const monaco: typeof MonacoApi = {
      languages: {
        setMonarchTokensProvider: (id: string, grammar: unknown): void => {
          calls.push([id, grammar]);
        },
      },
    } as unknown as typeof MonacoApi;

    registerCsharpLanguage(monaco);

    expect(calls).toEqual([[CSHARP_LANGUAGE_ID, csharpGrammar()]]);
  });

  it('should rebuild the grammar for a child window', (): void => {
    let registered: MonacoApi.languages.IMonarchLanguage | undefined;
    const monaco: typeof MonacoApi = {
      languages: {
        setMonarchTokensProvider: (
          _id: string,
          grammar: MonacoApi.languages.IMonarchLanguage,
        ): void => {
          registered = grammar;
        },
      },
    } as unknown as typeof MonacoApi;

    registerCsharpLanguage(monaco, window);

    expect(registered).not.toBe(csharpGrammar());
    expect(registered?.tokenPostfix).toBe('.cs');
  });

  it('should do nothing before Monaco has loaded', (): void => {
    expect((): void => registerCsharpLanguage(undefined)).not.toThrow();
  });
});
