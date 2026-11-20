import { describe, expect, it } from 'vitest';
import { formattingLocale } from './formatting-locale';

describe('formattingLocale', () => {
  it('keeps the region the system prefers for the chosen language', () => {
    expect(formattingLocale('fr', ['en-GB', 'fr-CA'])).toBe('fr-CA');
  });

  it('takes the language alone when the system prefers no variant of it', () => {
    expect(formattingLocale('de', ['en-GB'])).toBe('de');
  });

  it('formats English as British English when the system prefers no variant of it', () => {
    expect(formattingLocale('en', ['fr-FR'])).toBe('en-GB');
  });

  it('formats English in the system’s variant when it prefers one', () => {
    expect(formattingLocale('en', ['en-US'])).toBe('en-US');
  });

  it('formats the test language as English', () => {
    expect(formattingLocale('pseudo', ['fr-FR'])).toBe('en-GB');
  });
});
