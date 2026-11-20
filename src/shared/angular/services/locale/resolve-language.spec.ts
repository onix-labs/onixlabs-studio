import { describe, expect, it } from 'vitest';
import { resolveLanguage } from './resolve-language';

describe('resolveLanguage', () => {
  it('returns a named language whatever the system prefers', () => {
    expect(resolveLanguage('de', ['fr-FR', 'en-GB'])).toBe('de');
  });

  it('returns the test language only when it is named', () => {
    expect(resolveLanguage('pseudo', ['en-GB'])).toBe('pseudo');
  });

  it('takes the first preferred language Studio speaks, whatever its region', () => {
    expect(resolveLanguage('system', ['ja-JP', 'fr-CA', 'de-DE'])).toBe('fr');
  });

  it('reads tags in any case', () => {
    expect(resolveLanguage('system', ['ES-mx'])).toBe('es');
  });

  it('falls back to English when the system prefers none Studio speaks', () => {
    expect(resolveLanguage('system', ['ja-JP', 'zh-Hans-CN'])).toBe('en');
  });

  it('falls back to English when the system states no preference', () => {
    expect(resolveLanguage('system', [])).toBe('en');
  });
});
