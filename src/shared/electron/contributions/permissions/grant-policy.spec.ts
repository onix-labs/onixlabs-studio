import { describe, expect, it } from 'vitest';
import { DefaultGrantPolicy } from './grant-policy';

describe('DefaultGrantPolicy', () => {
  it('grantsFirstPartyContributions', () => {
    expect(new DefaultGrantPolicy().decide('first-party')).toBe('allow');
  });

  it('deniesThirdPartyContributions', () => {
    expect(new DefaultGrantPolicy().decide('third-party')).toBe('deny');
  });
});
