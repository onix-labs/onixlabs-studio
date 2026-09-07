import { TestBed } from '@angular/core/testing';
import type { HostEnv } from '@shared/api/host';

import { SetupWizard } from './setup-wizard';

/**
 * Holds the store key the service persists the completed version under, restated here so the spec
 * asserts against the actual storage rather than through the service that wrote it.
 */
const LAST_SEEN_KEY: string = 'studio.setup.lastSeenVersion';

/**
 * Stands a host environment in on `window.host`, or removes it to stand in for running outside
 * Electron. The property is declared readonly, so it is redefined rather than assigned.
 * @param version The Studio version the host reports, or null for no host at all.
 */
function stubHostVersion(version: string | null): void {
  if (version === null) {
    Reflect.deleteProperty(window, 'host');
    return;
  }
  Object.defineProperty(window, 'host', {
    configurable: true,
    value: {
      platform: 'darwin',
      arch: 'arm64',
      homeDir: '/Users/test',
      versions: { studio: version, electron: '38.0.0', chromium: '140.0.0', node: '24.0.0' },
      display: {
        gpuRendering: { recommendReducedEffects: false, description: '' },
        graphicsAcceleration: 'full',
        hardwareAccelerationEnabled: true,
      },
    } satisfies HostEnv,
  });
}

/**
 * Builds the service after the host and storage have been arranged. Construction is what runs the
 * gate, so every case must arrange first and inject second.
 * @returns Returns the service.
 */
function build(): SetupWizard {
  TestBed.configureTestingModule({});
  return TestBed.inject(SetupWizard);
}

describe('SetupWizard', () => {
  // The unit suite shares one jsdom window and its localStorage across specs, so a last-seen version
  // left behind here would leak into an unrelated spec and red it. Cleared on both sides.
  beforeEach(() => {
    localStorage.removeItem(LAST_SEEN_KEY);
    stubHostVersion('2026.1.0-beta.5');
  });

  afterEach(() => {
    localStorage.removeItem(LAST_SEEN_KEY);
    Reflect.deleteProperty(window, 'host');
    TestBed.resetTestingModule();
  });

  describe('the version gate', () => {
    it('isOpen_onAFirstRun_runsTheWizard', () => {
      expect(build().isOpen()).toBe(true);
    });

    it('mode_onAFirstRun_isFirstRun', () => {
      expect(build().mode).toBe('first-run');
    });

    it('isOpen_whenTheRunningVersionWasAlreadyCompleted_doesNotRun', () => {
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.5'));

      expect(build().isOpen()).toBe(false);
    });

    it('isOpen_whenTheVersionChanged_runsAgain', () => {
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.4'));

      expect(build().isOpen()).toBe(true);
    });

    it('mode_whenTheVersionChanged_isUpgrade', () => {
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.4'));

      expect(build().mode).toBe('upgrade');
    });

    it('isOpen_onADowngrade_runsAgain', () => {
      // A downgrade changes the environment as much as an upgrade does — the gate is inequality, not
      // an ordering, so it must catch this too.
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.2.0'));

      expect(build().isOpen()).toBe(true);
    });

    it('isOpen_outsideElectron_neverRuns', () => {
      // With no host there is no version to gate on, and a wizard that could never record a version
      // would run on every launch forever.
      stubHostVersion(null);

      expect(build().isOpen()).toBe(false);
    });

    it('lastSeenVersion_onAFirstRun_isNull', () => {
      expect(build().lastSeenVersion).toBeNull();
    });

    it('lastSeenVersion_onAnUpgrade_reportsTheVersionSetUpBefore', () => {
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.4'));

      expect(build().lastSeenVersion).toBe('2026.1.0-beta.4');
    });
  });

  describe('completing and abandoning', () => {
    it('finish_whenCalled_closesTheWizard', () => {
      const wizard: SetupWizard = build();

      wizard.finish();

      expect(wizard.isOpen()).toBe(false);
    });

    it('finish_whenCalled_recordsTheRunningVersion', () => {
      build().finish();

      expect(localStorage.getItem(LAST_SEEN_KEY)).toBe(JSON.stringify('2026.1.0-beta.5'));
    });

    it('finish_thenRelaunching_doesNotRunAgain', () => {
      build().finish();
      TestBed.resetTestingModule();

      expect(build().isOpen()).toBe(false);
    });

    it('abandon_whenCalled_closesTheWizard', () => {
      const wizard: SetupWizard = build();

      wizard.abandon();

      expect(wizard.isOpen()).toBe(false);
    });

    it('abandon_whenCalled_recordsNothing', () => {
      build().abandon();

      expect(localStorage.getItem(LAST_SEEN_KEY)).toBeNull();
    });

    it('abandon_thenRelaunching_runsAgain', () => {
      // Closing the window part-way decides nothing, so the pass has not happened.
      build().abandon();
      TestBed.resetTestingModule();

      expect(build().isOpen()).toBe(true);
    });
  });

  describe('stepping through', () => {
    it('stepIndex_beforeAnyNavigation_isTheFirstStep', () => {
      expect(build().stepIndex()).toBe(0);
    });

    it('current_beforeAnyNavigation_isTheFirstStep', () => {
      const wizard: SetupWizard = build();

      expect(wizard.current()).toBe(wizard.steps()[0]);
    });

    it('canGoBack_onTheFirstStep_isFalse', () => {
      expect(build().canGoBack()).toBe(false);
    });

    it('back_onTheFirstStep_staysPut', () => {
      const wizard: SetupWizard = build();

      wizard.back();

      expect(wizard.stepIndex()).toBe(0);
    });

    it('next_onTheLastStep_completesTheWizard', () => {
      const wizard: SetupWizard = build();
      while (!wizard.isLastStep()) {
        wizard.next();
      }

      wizard.next();

      expect(wizard.isOpen()).toBe(false);
      expect(localStorage.getItem(LAST_SEEN_KEY)).toBe(JSON.stringify('2026.1.0-beta.5'));
    });

    it('next_thenBack_returnsToThePreviousStep', () => {
      const wizard: SetupWizard = build();
      if (wizard.isLastStep()) {
        // With a single step there is nothing to step between; the sequence grows in later phases and
        // this case starts exercising it then.
        return;
      }

      wizard.next();
      wizard.back();

      expect(wizard.stepIndex()).toBe(0);
    });
  });
});
