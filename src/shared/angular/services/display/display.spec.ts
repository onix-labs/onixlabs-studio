import { TestBed } from '@angular/core/testing';

import { AppChannel } from '@shared/api/app-channels';
import { Bridge } from '@shared/api/bridge';
import type { DisplayStartup } from '@shared/api/host';
import { Settings } from '@shared/angular/services/settings/settings';
import { Display } from './display';

/**
 * A recorded bridge invocation or fire-and-forget send.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('Display', () => {
  let invokes: RecordedCall[];
  let sends: RecordedCall[];

  /**
   * Installs stub host and bridge objects on the window before the service reads them.
   * @param startup The display startup snapshot the stub host reports.
   */
  function stubHost(startup: DisplayStartup): void {
    invokes = [];
    sends = [];
    (
      window as unknown as { host: { platform: string; homeDir: string; display: DisplayStartup } }
    ).host = { platform: 'darwin', homeDir: '/Users/test', display: startup };
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        invokes.push({ channel, args });
        return Promise.resolve(undefined as T);
      },
      send: (channel: string, ...args: unknown[]): void => {
        sends.push({ channel, args });
      },
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  /**
   * Builds a startup snapshot.
   * @param recommendReducedEffects Whether the GPU is flagged for reduced effects.
   * @param hardwareAccelerationEnabled Whether hardware acceleration is enabled for this launch.
   * @returns Returns the snapshot.
   */
  function startup(
    recommendReducedEffects: boolean,
    hardwareAccelerationEnabled: boolean,
  ): DisplayStartup {
    return {
      gpuRendering: { recommendReducedEffects, description: 'Test GPU' },
      hardwareAccelerationEnabled,
    };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as unknown as { host?: unknown }).host;
    delete (window as unknown as { bridge?: unknown }).bridge;
    document.documentElement.removeAttribute('data-corners');
    document.documentElement.removeAttribute('data-reduced-gpu');
  });

  it('applyDisplayPolicy_whenModernFeaturesAreOff_setsTheFallbackAttributes', () => {
    stubHost(startup(false, true));
    TestBed.inject(Display);
    TestBed.inject(Settings).setModernUiFeatures('off');

    TestBed.tick();

    expect(document.documentElement.getAttribute('data-corners')).toBe('round');
    expect(document.documentElement.getAttribute('data-reduced-gpu')).toBe('true');
  });

  it('applyDisplayPolicy_whenModernFeaturesAreOn_removesTheFallbackAttributes', () => {
    stubHost(startup(true, true));
    TestBed.inject(Display);
    const settings: Settings = TestBed.inject(Settings);
    settings.setModernUiFeatures('off');
    TestBed.tick();

    settings.setModernUiFeatures('on');
    TestBed.tick();

    expect(document.documentElement.hasAttribute('data-corners')).toBe(false);
    expect(document.documentElement.hasAttribute('data-reduced-gpu')).toBe(false);
  });

  it('applyDisplayPolicy_whenAutomaticAndReductionRecommended_fallsBackToReducedEffects', () => {
    stubHost(startup(true, true));
    const display: Display = TestBed.inject(Display);
    TestBed.inject(Settings).setModernUiFeatures('auto');

    TestBed.tick();

    expect(display.recommendReducedEffects).toBe(true);
    expect(display.recommendedModernUi).toBe('off');
    expect(display.gpuDescription).toBe('Test GPU');
    expect(document.documentElement.getAttribute('data-reduced-gpu')).toBe('true');
  });

  it('setHardwareAcceleration_whenChanged_persistsAndFlagsARestart', () => {
    stubHost(startup(false, true));
    const display: Display = TestBed.inject(Display);

    display.setHardwareAcceleration(false);

    expect(display.hardwareAccelerationEnabled()).toBe(false);
    expect(display.restartRequired()).toBe(true);
    expect(invokes).toEqual([{ channel: AppChannel.SetHardwareAcceleration, args: [false] }]);
  });

  it('setHardwareAcceleration_whenRestoredToTheLaunchValue_clearsTheRestartFlag', () => {
    stubHost(startup(false, true));
    const display: Display = TestBed.inject(Display);

    display.setHardwareAcceleration(false);
    display.setHardwareAcceleration(true);

    expect(display.restartRequired()).toBe(false);
  });

  it('relaunch_whenCalled_sendsTheRelaunchChannel', () => {
    stubHost(startup(false, true));
    TestBed.inject(Display).relaunch();

    expect(sends).toEqual([{ channel: AppChannel.Relaunch, args: [] }]);
  });

  it('defaults_whenRunningOutsideElectron_reportFullEffectsAndAcceleration', () => {
    const display: Display = TestBed.inject(Display);

    expect(display.isAvailable).toBe(false);
    expect(display.recommendReducedEffects).toBe(false);
    expect(display.recommendedModernUi).toBe('on');
    expect(display.gpuDescription).toBe('');
    expect(display.hardwareAccelerationEnabled()).toBe(true);
  });
});
