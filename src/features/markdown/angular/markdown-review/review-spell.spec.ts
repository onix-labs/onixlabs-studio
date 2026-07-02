import { describe, it, expect } from 'vitest';

import { SpellChecker } from './review-spell';

describe('SpellChecker', () => {
  const checker: SpellChecker = new SpellChecker(['hello', 'world', 'review', 'editor']);

  it('isCorrect_whenWordInDictionary_returnsTrue', () => {
    expect(checker.isCorrect('hello')).toBe(true);
  });

  it('isCorrect_whenDifferentCase_returnsTrue', () => {
    expect(checker.isCorrect('Hello')).toBe(true);
  });

  it('isCorrect_whenWordNotInDictionary_returnsFalse', () => {
    expect(checker.isCorrect('helllo')).toBe(false);
  });

  it('suggest_whenNearMatch_returnsTheCorrectWord', () => {
    expect(checker.suggest('helllo')).toContain('hello');
  });

  it('suggest_whenLeadingCapital_preservesCapitalisation', () => {
    expect(checker.suggest('Helllo')).toContain('Hello');
  });

  it('suggest_whenFarFromAnyWord_returnsNoSuggestions', () => {
    expect(checker.suggest('zzzzzzzz')).toEqual([]);
  });
});
