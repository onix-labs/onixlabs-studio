import { describe, expect, it } from 'vitest';
import { clickOpensLink } from './link-open-plugin';

describe('clickOpensLink', () => {
  it('clickOpensLink_inEachMode_followsTheSetting', () => {
    expect(clickOpensLink('modifier', true)).toBe(true);
    expect(clickOpensLink('modifier', false)).toBe(false);
    expect(clickOpensLink('click', false)).toBe(true);
    expect(clickOpensLink('tooltip', true)).toBe(false);
  });
});
