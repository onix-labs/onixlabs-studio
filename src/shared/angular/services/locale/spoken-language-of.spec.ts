import { describe, expect, it } from 'vitest';
import { spokenLanguageOf } from './spoken-language-of';

describe('spokenLanguageOf', () => {
  it('matches a language whatever its region', () => {
    expect(spokenLanguageOf('de-AT')).toBe('de');
  });

  it('reads Simplified Chinese from its script or a region that writes it', () => {
    expect(spokenLanguageOf('zh-Hans')).toBe('zh-Hans');
    expect(spokenLanguageOf('zh-Hans-HK')).toBe('zh-Hans');
    expect(spokenLanguageOf('zh-CN')).toBe('zh-Hans');
    expect(spokenLanguageOf('zh-SG')).toBe('zh-Hans');
    expect(spokenLanguageOf('zh')).toBe('zh-Hans');
  });

  it('does not read Traditional Chinese as Simplified', () => {
    expect(spokenLanguageOf('zh-TW')).toBeUndefined();
    expect(spokenLanguageOf('zh-HK')).toBeUndefined();
    expect(spokenLanguageOf('zh-MO')).toBeUndefined();
    expect(spokenLanguageOf('zh-Hant-CN')).toBeUndefined();
  });

  it('matches Arabic in any region', () => {
    expect(spokenLanguageOf('ar-MA')).toBe('ar');
  });

  it('never matches the test language', () => {
    expect(spokenLanguageOf('pseudo')).toBeUndefined();
  });

  it('matches nothing for a malformed tag', () => {
    expect(spokenLanguageOf('not a tag')).toBeUndefined();
  });
});
