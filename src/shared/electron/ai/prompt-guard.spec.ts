import { describe, expect, it } from 'vitest';
import { PROMPT_EXTRA_LIMIT, sanitizeLanguage, sanitizePromptExtra } from './prompt-guard';

describe('sanitizePromptExtra', () => {
  it('sanitizePromptExtra_whenNotAString_isEmpty', () => {
    expect(sanitizePromptExtra(undefined)).toBe('');
    expect(sanitizePromptExtra(42)).toBe('');
  });

  it('sanitizePromptExtra_trimsAndCapsAtTheLimit', () => {
    expect(sanitizePromptExtra('  hello  ')).toBe('hello');
    expect(sanitizePromptExtra('x'.repeat(PROMPT_EXTRA_LIMIT + 10))).toHaveLength(
      PROMPT_EXTRA_LIMIT,
    );
  });
});

describe('sanitizeLanguage', () => {
  it('sanitizeLanguage_normalisesAValidIdentifier', () => {
    expect(sanitizeLanguage(' CSharp ')).toBe('csharp');
    expect(sanitizeLanguage('c++')).toBe('c++');
  });

  it('sanitizeLanguage_refusesAnythingElse', () => {
    expect(sanitizeLanguage(undefined)).toBeNull();
    expect(sanitizeLanguage('')).toBeNull();
    expect(sanitizeLanguage('has space')).toBeNull();
    expect(sanitizeLanguage('x'.repeat(100))).toBeNull();
  });
});
