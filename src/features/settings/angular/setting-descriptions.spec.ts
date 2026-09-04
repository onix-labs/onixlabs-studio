import { TestBed } from '@angular/core/testing';

import { SettingDescriptions } from '@features/settings/angular/setting-descriptions';

describe('SettingDescriptions', () => {
  let descriptions: SettingDescriptions;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    descriptions = TestBed.inject(SettingDescriptions);
  });

  it('resolve_whenGraphicsAcceleration_returnsAGpuAwareHint', () => {
    expect(descriptions.resolve('display.graphicsAcceleration')).toContain(
      'Automatic resolves to Full on this system',
    );
  });

  it('resolve_whenGraphicsAcceleration_keepsTheRegistrysExplanationOfTheLevels', () => {
    // The hint is appended rather than substituted, so naming the machine's answer does not cost the
    // user the explanation of what the levels mean.
    expect(descriptions.resolve('display.graphicsAcceleration')).toContain(
      'How much of the GPU the interface uses',
    );
  });

  it('resolve_whenNoDynamicDescription_returnsUndefined', () => {
    expect(descriptions.resolve('application.undoStackSize')).toBeUndefined();
  });
});
