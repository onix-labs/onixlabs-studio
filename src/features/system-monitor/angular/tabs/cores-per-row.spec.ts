import { describe, expect, it } from 'vitest';
import { coresPerRow } from './cores-per-row';

describe('coresPerRow', () => {
  it('putsEightToARow_whereTheCountDividesByEight', () => {
    expect(coresPerRow(16)).toBe(8);
    expect(coresPerRow(48)).toBe(8);
  });

  it('putsSixToARow_whereItDividesBySixButNotEight', () => {
    expect(coresPerRow(12)).toBe(6);
    expect(coresPerRow(36)).toBe(6);
  });

  it('keepsAFewCoresOnOneRow_andFallsBackToEight', () => {
    expect(coresPerRow(4)).toBe(4);
    expect(coresPerRow(0)).toBe(1);
    expect(coresPerRow(20)).toBe(8);
  });
});
