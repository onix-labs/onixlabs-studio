import type { DisplayStartup, GraphicsAcceleration } from '@shared/api/host';
import {
  renderGraphicsAcceleration,
  resolveGraphicsAcceleration,
  startupGraphicsAcceleration,
  wantsHardwareAcceleration,
} from './display-policy';

describe('display-policy', () => {
  /**
   * Builds a startup snapshot.
   * @param graphicsAcceleration The persisted level, or null when none has been persisted.
   * @param hardwareAccelerationEnabled Whether hardware acceleration was applied for this launch.
   * @returns Returns the snapshot.
   */
  function startup(
    graphicsAcceleration: GraphicsAcceleration | null,
    hardwareAccelerationEnabled: boolean = graphicsAcceleration !== 'off',
  ): DisplayStartup {
    return {
      gpuRendering: { recommendReducedEffects: false, description: '' },
      graphicsAcceleration,
      hardwareAccelerationEnabled,
    };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('resolveGraphicsAcceleration_whenExplicit_returnsTheLevelUnchanged', () => {
    expect(resolveGraphicsAcceleration('off', true)).toBe('off');
    expect(resolveGraphicsAcceleration('limited', false)).toBe('limited');
    expect(resolveGraphicsAcceleration('full', true)).toBe('full');
  });

  it('resolveGraphicsAcceleration_whenAutomatic_followsTheGpuRecommendation', () => {
    expect(resolveGraphicsAcceleration('auto', true)).toBe('limited');
    expect(resolveGraphicsAcceleration('auto', false)).toBe('full');
  });

  it('renderGraphicsAcceleration_whenLaunchedUnaccelerated_clampsToOff', () => {
    expect(renderGraphicsAcceleration('full', false, false)).toBe('off');
    expect(renderGraphicsAcceleration('auto', false, false)).toBe('off');
  });

  it('renderGraphicsAcceleration_whenLaunchedAccelerated_resolvesNormally', () => {
    expect(renderGraphicsAcceleration('auto', false, true)).toBe('full');
    expect(renderGraphicsAcceleration('limited', false, true)).toBe('limited');
  });

  it('wantsHardwareAcceleration_whenAnyLevelButOff_isTrue', () => {
    expect(wantsHardwareAcceleration('auto')).toBe(true);
    expect(wantsHardwareAcceleration('limited')).toBe(true);
    expect(wantsHardwareAcceleration('full')).toBe(true);
    expect(wantsHardwareAcceleration('off')).toBe(false);
  });

  it('startupGraphicsAcceleration_whenPersisted_prefersIt', () => {
    localStorage.setItem('settings', JSON.stringify({ appearance: { modernUiFeatures: 'off' } }));
    expect(startupGraphicsAcceleration(startup('full'))).toBe('full');
  });

  it('startupGraphicsAcceleration_whenLegacyAccelerationWasOff_migratesToOff', () => {
    // The pre-merge disabled case is unambiguous, so the main process reports it as `off` outright;
    // this covers the renderer reaching the same answer from the launch state.
    expect(startupGraphicsAcceleration(startup(null, false))).toBe('off');
  });

  it('startupGraphicsAcceleration_whenLegacyModernFeaturesWereOff_migratesToLimited', () => {
    localStorage.setItem('settings', JSON.stringify({ appearance: { modernUiFeatures: 'off' } }));
    expect(startupGraphicsAcceleration(startup(null))).toBe('limited');
  });

  it('startupGraphicsAcceleration_whenLegacyModernFeaturesWereOn_migratesToFull', () => {
    localStorage.setItem('settings', JSON.stringify({ appearance: { modernUiFeatures: 'on' } }));
    expect(startupGraphicsAcceleration(startup(null))).toBe('full');
  });

  it('startupGraphicsAcceleration_whenLegacyModernFeaturesWereAutomatic_migratesToAuto', () => {
    localStorage.setItem('settings', JSON.stringify({ appearance: { modernUiFeatures: 'auto' } }));
    expect(startupGraphicsAcceleration(startup(null))).toBe('auto');
  });

  it('startupGraphicsAcceleration_whenSettingsAreMalformed_fallsBackToAuto', () => {
    localStorage.setItem('settings', '{not json');
    expect(startupGraphicsAcceleration(startup(null))).toBe('auto');
  });

  it('startupGraphicsAcceleration_whenOutsideElectron_fallsBackToAuto', () => {
    expect(startupGraphicsAcceleration(undefined)).toBe('auto');
  });
});
