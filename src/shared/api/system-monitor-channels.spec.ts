import { describe, expect, it } from 'vitest';
import { historySamples } from './system-monitor-channels';

describe('historySamples', () => {
  it('holds the same span of time at every rate', () => {
    expect(historySamples(1, 1000)).toBe(60);
    expect(historySamples(1, 500)).toBe(120);
    expect(historySamples(5, 4000)).toBe(75);
    expect(historySamples(15, 500)).toBe(1800);
  });

  it('reckons at the default rate while paused', () => {
    expect(historySamples(1, 0)).toBe(60);
  });
});
