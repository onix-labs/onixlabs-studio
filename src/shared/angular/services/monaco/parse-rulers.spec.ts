import { describe, expect, it } from 'vitest';
import { parseRulers } from './parse-rulers';

describe('parseRulers', () => {
  it('reads no columns from an empty setting', () => {
    expect(parseRulers('')).toEqual([]);
  });

  it('reads columns in order, without repeats', () => {
    expect(parseRulers('120, 80,120')).toEqual([80, 120]);
  });

  it('leaves out what is not a column, so a half-typed value still draws', () => {
    expect(parseRulers('80, abc, -4, 0, 1.5, ')).toEqual([80]);
  });
});
