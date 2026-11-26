import { describe, expect, it } from 'vitest';
import { niceMax } from './nice-max';

describe('niceMax', () => {
  it('roundsAPlainPeakUp_toACleanDecimalTop', () => {
    expect(niceMax(73, 10, 1)).toBe(80);
    expect(niceMax(3.2, 10, 1)).toBe(4);
    expect(niceMax(100, 10, 1)).toBe(100);
  });

  it('roundsABytesPeakUp_toAPowerOfTwoOfItsUnit', () => {
    // 600 KB → 1 MB, so the quarters are 256 KB, 512 KB, 768 KB.
    expect(niceMax(600 * 1024, 1024, 1)).toBe(1024 ** 2);
    expect(niceMax(300 * 1024, 1024, 1)).toBe(512 * 1024);
    expect(niceMax(3 * 1024 ** 2, 1024, 1)).toBe(4 * 1024 ** 2);
  });

  it('holdsTheTopToTheFloor_soAFlatChartStillHasAScale', () => {
    expect(niceMax(0, 1024, 1024)).toBe(1024);
    expect(niceMax(0, 10, 0)).toBe(1);
  });
});
