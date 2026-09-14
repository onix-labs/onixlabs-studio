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

  it('resolveConcise_whenTheSettingStatesShortText_buildsOnThatInstead', () => {
    const concise: string | undefined = descriptions.resolveConcise('display.graphicsAcceleration');

    expect(concise).toContain('Leave this automatic unless the interface renders oddly');
    // The full text's paragraph on what each level does is what the short form exists to drop.
    expect(concise).not.toContain('drops squircle corners');
  });

  it('resolveConcise_whenTheSettingStatesShortText_keepsTheMachineSpecificHint', () => {
    // Shortening must not be what drops the one part that is about this computer.
    expect(descriptions.resolveConcise('display.graphicsAcceleration')).toContain(
      'Automatic resolves to Full on this system',
    );
  });

  it('resolveConcise_whenTheSettingStatesNoShortText_matchesTheFullResolution', () => {
    expect(descriptions.resolveConcise('application.undoStackSize')).toBeUndefined();
  });

  it('resolveConcise_isShorterThanResolve_forASettingThatStatesBoth', () => {
    const full: string = descriptions.resolve('display.graphicsAcceleration') ?? '';
    const concise: string = descriptions.resolveConcise('display.graphicsAcceleration') ?? '';

    expect(concise.length).toBeLessThan(full.length);
  });
});
