import { describe, expect, it } from 'vitest';
import { pageNumbers } from './pagination';

describe('pageNumbers', () => {
  it('showsEveryPage_whenThereAreFew', () => {
    expect(pageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageNumbers(1, 0)).toEqual([]);
  });

  it('showsTheFirstFive_andTheLast_nearTheStart', () => {
    expect(pageNumbers(1, 14)).toEqual([1, 2, 3, 4, 5, null, 14]);
    expect(pageNumbers(4, 14)).toEqual([1, 2, 3, 4, 5, null, 14]);
  });

  it('showsARunAroundTheCurrentPage_inTheMiddle', () => {
    expect(pageNumbers(7, 14)).toEqual([1, null, 6, 7, 8, null, 14]);
  });

  it('showsTheFirst_andTheLastFive_nearTheEnd', () => {
    expect(pageNumbers(14, 14)).toEqual([1, null, 10, 11, 12, 13, 14]);
  });
});
