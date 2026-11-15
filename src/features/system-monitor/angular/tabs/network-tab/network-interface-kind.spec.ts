import { describe, expect, it } from 'vitest';
import { formatLinkSpeed } from './network-interface-kind';

describe('formatLinkSpeed', () => {
  it('readsMegabits_andGigabitsFromAThousand', () => {
    expect(formatLinkSpeed(152.16)).toBe('152 Mbit/s');
    expect(formatLinkSpeed(1000)).toBe('1 Gbit/s');
    expect(formatLinkSpeed(2500)).toBe('2.5 Gbit/s');
    expect(formatLinkSpeed(10_000)).toBe('10 Gbit/s');
  });
});
