import { describe, expect, it } from 'vitest';
import {
  formatAxisRate,
  formatBytes,
  formatDuration,
  formatPercent,
  formatRate,
  formatShare,
} from './format';

describe('format', () => {
  it('formatBytes_picksTheLargestWholeUnit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(8 * 1024 ** 3)).toBe('8.0 GB');
  });

  it('formatBytes_roundsAWholeNumberOfBytes', () => {
    expect(formatBytes(451.2552983)).toBe('451 B');
  });

  it('formatAxisRate_dropsAWholeUnitsDecimal', () => {
    expect(formatAxisRate(128 * 1024)).toBe('128 KB/s');
    expect(formatAxisRate(1.5 * 1024 ** 2)).toBe('1.5 MB/s');
    expect(formatAxisRate(0)).toBe('0 B/s');
  });

  it('formatDuration_keepsTheTwoLargestUnits', () => {
    expect(formatDuration(12.6)).toBe('12s');
    expect(formatDuration(763)).toBe('12m 43s');
    expect(formatDuration(4 * 3600 + 5 * 60)).toBe('4h 05m');
    expect(formatDuration(3 * 86_400 + 4 * 3600 + 59)).toBe('3d 4h');
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
