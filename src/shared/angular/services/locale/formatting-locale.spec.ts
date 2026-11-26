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

  it('keeps the region the system prefers for Simplified Chinese', () => {
    expect(formattingLocale('zh-Hans', ['en-GB', 'zh-SG'])).toBe('zh-SG');
  });

  it('formats Simplified Chinese by its script when the system prefers no variant of it', () => {
    expect(formattingLocale('zh-Hans', ['zh-TW', 'en-GB'])).toBe('zh-Hans');
  });

  it('writes Arabic with Western digits', () => {
    expect(formattingLocale('ar', ['ar-SA'])).toBe('ar-SA-u-nu-latn');
    expect(new Intl.NumberFormat(formattingLocale('ar', [])).format(1234)).toBe('1,234');
  });

  it('keeps a numbering system the system names for Arabic', () => {
    expect(formattingLocale('ar', ['ar-EG-u-nu-arab'])).toBe('ar-EG-u-nu-arab');
  });
});
