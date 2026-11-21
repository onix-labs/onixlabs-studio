import { describe, expect, it } from 'vitest';
import { directionOf } from './direction-of';

describe('directionOf', () => {
  it('lays Arabic out right to left', () => {
    expect(directionOf('ar')).toBe('rtl');
  });

  it('lays every other language out left to right', () => {
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('zh-Hans')).toBe('ltr');
    expect(directionOf('pseudo')).toBe('ltr');
  });
});
