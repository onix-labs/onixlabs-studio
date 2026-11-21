import { describe, expect, it } from 'vitest';
import { INTERFACE_TRANSLATED, isLanguageChoiceOffered, languageInForce } from './language-choice';

describe('language choice', (): void => {
  it('should offer the Language setting in a development build', (): void => {
    expect(isLanguageChoiceOffered(false)).toBe(true);
  });

  it('should keep the saved setting in a development build', (): void => {
    expect(languageInForce('fr', false)).toBe('fr');
    expect(languageInForce('system', false)).toBe('system');
    expect(languageInForce('pseudo', false)).toBe('pseudo');
  });

  it('should hold a packaged build in English until the interface is translated', (): void => {
    expect(INTERFACE_TRANSLATED).toBe(false);
    expect(isLanguageChoiceOffered(true)).toBe(false);
    expect(languageInForce('fr', true)).toBe('en');
    expect(languageInForce('system', true)).toBe('en');
  });
});
