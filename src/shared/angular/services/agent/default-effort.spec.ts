import { defaultEffort } from './default-effort';

describe('defaultEffort', () => {
  it('isTheProvidersOwnDefault_whenChosenOrWhenTheProviderHasNoLevels', () => {
    expect(defaultEffort('provider', ['low', 'high'])).toBeNull();
    expect(defaultEffort('high', [])).toBeNull();
  });

  it('isTheChosenLevel_whenTheProviderOffersIt', () => {
    expect(defaultEffort('medium', ['low', 'medium', 'high'])).toBe('medium');
  });

  it('isTheNearestLevel_theLowerOnATie', () => {
    expect(defaultEffort('high', ['minimal', 'low', 'medium'])).toBe('medium');
    expect(defaultEffort('low', ['high', 'xhigh', 'max'])).toBe('high');
    expect(defaultEffort('medium', ['low', 'high'])).toBe('low');
  });
});
