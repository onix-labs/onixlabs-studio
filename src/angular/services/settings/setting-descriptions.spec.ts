import { TestBed } from '@angular/core/testing';

import { SettingDescriptions } from './setting-descriptions';

describe('SettingDescriptions', () => {
  let descriptions: SettingDescriptions;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    descriptions = TestBed.inject(SettingDescriptions);
  });

  it('resolve_whenModernUiFeatures_returnsAGpuAwareHint', () => {
    expect(descriptions.resolve('appearance.modernUiFeatures')).toContain(
      'Recommended for this system',
    );
  });

  it('resolve_whenNoDynamicDescription_returnsUndefined', () => {
    expect(descriptions.resolve('application.undoStackSize')).toBeUndefined();
  });
});
