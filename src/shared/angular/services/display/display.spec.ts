import { TestBed } from '@angular/core/testing';

import { AppChannel } from '@shared/api/app-channels';
import { Bridge } from '@shared/api/bridge';
import type { DisplayStartup, GraphicsAcceleration } from '@shared/api/host';
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
   * @param graphicsAcceleration The persisted level, or null when none has been persisted.
   * @param hardwareAccelerationEnabled Whether hardware acceleration was applied for this launch;
   * defaults to what the level implies.
   * @returns Returns the snapshot.
   */
  function startup(
    recommendReducedEffects: boolean,
    graphicsAcceleration: GraphicsAcceleration | null,
    hardwareAccelerationEnabled: boolean = graphicsAcceleration !== 'off',
  ): DisplayStartup {
    return {
      gpuRendering: { recommendReducedEffects, description: 'Test GPU' },
      graphicsAcceleration,
      hardwareAccelerationEnabled,
    };
  }

  /**
   * Reports whether the document root carries the reduced-effects fallback attributes.
   * @returns Returns true when the fallback is applied.
   */
  function reduced(): boolean {
    const root: HTMLElement = document.documentElement;
    return (
      root.getAttribute('data-corners') === 'round' &&
      root.getAttribute('data-reduced-gpu') === 'true'
    );
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

  it('applyDisplayPolicy_whenLimited_setsTheFallbackAttributes', () => {
    stubHost(startup(false, 'limited'));
    TestBed.inject(Display);

    TestBed.tick();

    expect(reduced()).toBe(true);
  });

  it('applyDisplayPolicy_whenFull_removesTheFallbackAttributes', () => {
    stubHost(startup(true, 'limited'));
    const display: Display = TestBed.inject(Display);
    TestBed.tick();

    display.setGraphicsAcceleration('full');
    TestBed.tick();

    expect(document.documentElement.hasAttribute('data-corners')).toBe(false);
    expect(document.documentElement.hasAttribute('data-reduced-gpu')).toBe(false);
  });

  it('applyDisplayPolicy_whenOff_setsTheFallbackAttributes', () => {
    stubHost(startup(false, 'off'));
    TestBed.inject(Display);

    TestBed.tick();

    expect(reduced()).toBe(true);
  });

  it('resolve_whenAutomaticAndReductionRecommended_fallsBackToLimited', () => {
    stubHost(startup(true, 'auto'));
    const display: Display = TestBed.inject(Display);

    TestBed.tick();

    expect(display.recommendReducedEffects).toBe(true);
    expect(display.recommendedGraphicsAcceleration).toBe('limited');
    expect(display.resolvedGraphicsAcceleration()).toBe('limited');
    expect(display.gpuDescription).toBe('Test GPU');
    expect(reduced()).toBe(true);
  });

  it('resolve_whenAutomaticAndNoReductionRecommended_resolvesToFull', () => {
    stubHost(startup(false, 'auto'));
    const display: Display = TestBed.inject(Display);

    TestBed.tick();

    expect(display.recommendedGraphicsAcceleration).toBe('full');
    expect(display.resolvedGraphicsAcceleration()).toBe('full');
    expect(document.documentElement.hasAttribute('data-reduced-gpu')).toBe(false);
  });

  it('resolve_whenAutomatic_neverResolvesToOff', () => {
    // Turning acceleration off is a troubleshooting escape hatch for broken drivers, which cannot be
    // detected from the GPU; the automatic mode only ever chooses between the accelerated rungs.
    stubHost(startup(true, 'auto'));
    expect(TestBed.inject(Display).resolvedGraphicsAcceleration()).not.toBe('off');
  });

  it('resolve_whenRaisedWhileLaunchedUnaccelerated_staysAtOffUntilRelaunch', () => {
    // Hardware acceleration is fixed for the life of the process, so the raised level is kept but
    // nothing is drawn above what this launch can afford.
    stubHost(startup(false, 'off'));
    const display: Display = TestBed.inject(Display);

    display.setGraphicsAcceleration('full');
    TestBed.tick();

    expect(display.graphicsAcceleration()).toBe('full');
    expect(display.resolvedGraphicsAcceleration()).toBe('off');
    expect(reduced()).toBe(true);
  });

  it('resolve_whenLaunchDisabledAccelerationBehindTheLevel_clampsToOff', () => {
    // The STUDIO_DISABLE_GPU diagnostic forces acceleration off without touching the persisted level,
    // so the two disagree and what actually happened wins.
    stubHost(startup(false, 'full', false));
    const display: Display = TestBed.inject(Display);

    TestBed.tick();

    expect(display.resolvedGraphicsAcceleration()).toBe('off');
    expect(reduced()).toBe(true);
  });

  it('setGraphicsAcceleration_whenMovingOffTheAcceleratedRungs_persistsAndFlagsARestart', () => {
    stubHost(startup(false, 'full'));
    const display: Display = TestBed.inject(Display);

    display.setGraphicsAcceleration('off');

    expect(display.graphicsAcceleration()).toBe('off');
    expect(display.restartRequired()).toBe(true);
    expect(invokes).toEqual([{ channel: AppChannel.SetGraphicsAcceleration, args: ['off'] }]);
  });

  it('setGraphicsAcceleration_whenMovingBetweenAcceleratedRungs_needsNoRestart', () => {
    // The whole point of the ladder: only the escape hatch costs a relaunch.
    stubHost(startup(false, 'full'));
    const display: Display = TestBed.inject(Display);

    display.setGraphicsAcceleration('limited');
    TestBed.tick();

    expect(display.restartRequired()).toBe(false);
    expect(reduced()).toBe(true);
  });

  it('setGraphicsAcceleration_whenRestoredToTheLaunchState_clearsTheRestartFlag', () => {
    stubHost(startup(false, 'full'));
    const display: Display = TestBed.inject(Display);

    display.setGraphicsAcceleration('off');
    display.setGraphicsAcceleration('auto');

    expect(display.restartRequired()).toBe(false);
  });

  it('relaunch_whenCalled_sendsTheRelaunchChannel', () => {
    stubHost(startup(false, 'auto'));
    TestBed.inject(Display).relaunch();

    expect(sends).toEqual([{ channel: AppChannel.Relaunch, args: [] }]);
  });

  it('migrate_whenNoLevelPersisted_derivesItFromThePreMergeSettingsAndPersistsIt', () => {
    localStorage.setItem('settings', JSON.stringify({ appearance: { modernUiFeatures: 'off' } }));
    stubHost(startup(false, null));

    const display: Display = TestBed.inject(Display);

    expect(display.graphicsAcceleration()).toBe('limited');
    expect(invokes).toEqual([{ channel: AppChannel.SetGraphicsAcceleration, args: ['limited'] }]);
  });

  it('migrate_whenALevelIsPersisted_writesNothingBack', () => {
    stubHost(startup(false, 'auto'));

    TestBed.inject(Display);

    expect(invokes).toEqual([]);
  });

  it('defaults_whenRunningOutsideElectron_reportFullEffectsAndAcceleration', () => {
    const display: Display = TestBed.inject(Display);

    expect(display.isAvailable).toBe(false);
    expect(display.recommendReducedEffects).toBe(false);
    expect(display.recommendedGraphicsAcceleration).toBe('full');
    expect(display.resolvedGraphicsAcceleration()).toBe('full');
    expect(display.gpuDescription).toBe('');
    expect(display.restartRequired()).toBe(false);
  });
});
