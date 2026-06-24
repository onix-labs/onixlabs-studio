import { describe, it, expect } from 'vitest';

import { analyzeMarkdown, maskText } from './review-rules';
import { ReviewIssue } from './review-types';
import { SpellChecker } from './review-spell';

describe('maskText', () => {
  it('maskText_whenInlineCode_blanksItButKeepsLength', () => {
    const source: string = 'use `helllo` here';
    const masked: string = maskText(source);
    expect(masked.length).toBe(source.length);
    expect(masked).not.toContain('helllo');
    expect(masked).toContain('use');
  });

  it('maskText_whenUrl_blanksTheUrl', () => {
    const masked: string = maskText('see https://exmaple.com now');
    expect(masked).not.toContain('exmaple');
  });
});

describe('analyzeMarkdown', () => {
  const checker: SpellChecker = new SpellChecker(['hello', 'world', 'the', 'cat', 'sat']);
  const empty: ReadonlySet<string> = new Set<string>();

  it('analyzeMarkdown_whenMisspelledWord_reportsSpellingIssue', () => {
    const issues: ReviewIssue[] = analyzeMarkdown('helllo world', checker, empty);
    const spelling: ReviewIssue | undefined = issues.find(
      (issue: ReviewIssue): boolean => issue.kind === 'spelling',
    );
    expect(spelling?.word).toBe('helllo');
    expect(spelling?.suggestions).toContain('hello');
  });

  it('analyzeMarkdown_whenWordInUserDictionary_isNotFlagged', () => {
    const issues: ReviewIssue[] = analyzeMarkdown(
      'helllo world',
      checker,
      new Set<string>(['helllo']),
    );
    expect(issues.some((issue: ReviewIssue): boolean => issue.word === 'helllo')).toBe(false);
  });

  it('analyzeMarkdown_whenRepeatedWord_reportsGrammarIssue', () => {
    const issues: ReviewIssue[] = analyzeMarkdown('the the cat', checker, empty);
    expect(
      issues.some(
        (issue: ReviewIssue): boolean => issue.kind === 'grammar' && issue.ruleName === 'Repeated word',
      ),
    ).toBe(true);
  });

  it('analyzeMarkdown_whenWeakIntensifier_reportsStyleIssue', () => {
    const issues: ReviewIssue[] = analyzeMarkdown('the cat sat very still', checker, empty);
    expect(
      issues.some(
        (issue: ReviewIssue): boolean => issue.kind === 'style' && issue.word === 'very',
      ),
    ).toBe(true);
  });

  it('analyzeMarkdown_whenInlineCode_doesNotSpellCheckIt', () => {
    const issues: ReviewIssue[] = analyzeMarkdown('the `helllo` cat', checker, empty);
    expect(issues.some((issue: ReviewIssue): boolean => issue.word === 'helllo')).toBe(false);
  });

  it('analyzeMarkdown_whenManyIssues_sortsThemByPosition', () => {
    const issues: ReviewIssue[] = analyzeMarkdown('very helllo', checker, empty);
    const positions: number[] = issues.map((issue: ReviewIssue): number => issue.start);
    const sorted: number[] = [...positions].sort((a: number, b: number): number => a - b);
    expect(positions).toEqual(sorted);
  });
});
