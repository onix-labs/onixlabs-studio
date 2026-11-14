import { describe, expect, it } from 'vitest';
import { formatBytes, formatPercent, formatRate, formatShare } from './format';

describe('format', () => {
  it('formatBytes_picksTheLargestWholeUnit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(8 * 1024 ** 3)).toBe('8.0 GB');
  });

  it('formatRate_isBytesPerSecond', () => {
    expect(formatRate(2048)).toBe('2.0 KB/s');
  });

  it('formatPercent_roundsToAWholePercent', () => {
    expect(formatPercent(41.6)).toBe('42%');
  });

  it('formatShare_keepsADecimalBelowTen_soSmallSharesStayDistinct', () => {
    expect(formatShare(0.04)).toBe('0.0%');
    expect(formatShare(3.44)).toBe('3.4%');
    expect(formatShare(27.6)).toBe('28%');
  });
});
