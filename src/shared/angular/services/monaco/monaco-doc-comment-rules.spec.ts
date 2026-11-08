import type * as MonacoApi from 'monaco-editor';
import { registerDocCommentRules, rustDocCommentRules } from './monaco-doc-comment-rules';

/**
 * A stand-in for the part of Monaco the rules read and register with.
 */
const MONACO: { configurations: [string, MonacoApi.languages.LanguageConfiguration][] } & Pick<
  typeof MonacoApi,
  'languages'
> = {
  configurations: [],
  languages: {
    IndentAction: { None: 0, Indent: 1, IndentOutdent: 2, Outdent: 3 },
    setLanguageConfiguration(
      languageId: string,
      configuration: MonacoApi.languages.LanguageConfiguration,
    ): MonacoApi.IDisposable {
      MONACO.configurations.push([languageId, configuration]);
      return { dispose: (): void => undefined };
    },
  } as unknown as typeof MonacoApi.languages,
};

/**
 * Reads what Enter would append after a line, by the first rule whose text before the caret matches.
 * @param line The text before the caret.
 * @returns Returns the text appended, or null when no rule applies.
 */
function continued(line: string): string | null {
  const rule: MonacoApi.languages.OnEnterRule | undefined = rustDocCommentRules(
    MONACO as unknown as typeof MonacoApi,
  ).find((candidate: MonacoApi.languages.OnEnterRule): boolean => candidate.beforeText.test(line));
  return rule?.action.appendText ?? null;
}

describe('monaco-doc-comment-rules', () => {
  it('rustDocCommentRules_continueOuterAndInnerDocComments', () => {
    expect(continued('/// A circle, by its radius.')).toBe('/// ');
    expect(continued('    /// Indented, inside an impl.')).toBe('/// ');
    expect(continued('///')).toBe('/// ');
    expect(continued('//! The crate.')).toBe('//! ');
  });

  it('rustDocCommentRules_leavePlainCommentsAndCodeAlone', () => {
    expect(continued('// A plain comment.')).toBeNull();
    expect(continued('//// Four slashes are a plain comment in Rust.')).toBeNull();
    expect(continued('let x = 1; /// not at the start')).toBeNull();
    expect(continued('fn area(&self) -> f64 {')).toBeNull();
  });

  it('registerDocCommentRules_setsOnlyRustsEnterRules', () => {
    registerDocCommentRules(MONACO as unknown as typeof MonacoApi);
    registerDocCommentRules(undefined);

    expect(MONACO.configurations).toHaveLength(1);
    const [languageId, configuration] = MONACO.configurations[0];
    expect(languageId).toBe('rust');
    // Nothing else, so Monaco's own brackets and comments for Rust stand.
    expect(Object.keys(configuration)).toEqual(['onEnterRules']);
  });
});
