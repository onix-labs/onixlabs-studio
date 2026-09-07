import { TestBed } from '@angular/core/testing';
import type { HostEnv } from '@shared/api/host';

import { SetupStep, SetupWizard } from './setup-wizard';

/**
 * Holds the store key the service persists the completed version under, restated here so the spec
 * asserts against the actual storage rather than through the service that wrote it.
 */
const LAST_SEEN_KEY: string = 'studio.setup.lastSeenVersion';

/**
 * Stands a host environment in on `window.host`, or removes it to stand in for running outside
 * Electron. The property is declared readonly, so it is redefined rather than assigned.
 * @param version The Studio version the host reports, or null for no host at all.
 * @param skipSetup Whether the host reports the suppression diagnostic set.
 */
function stubHostVersion(version: string | null, skipSetup: boolean = false): void {
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
      skipSetup,
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

    it('isOpen_whenSuppressedByTheDiagnostic_doesNotRun', () => {
      // The way past a wizard that will not complete, and what the end-to-end suite runs behind.
      stubHostVersion('2026.1.0-beta.5', true);

      expect(build().isOpen()).toBe(false);
    });

    it('isOpen_whenSuppressionIsLifted_asksAgain', () => {
      // Suppression is for the launch only: it records nothing, so the pass is still owed.
      stubHostVersion('2026.1.0-beta.5', true);
      build();
      TestBed.resetTestingModule();
      stubHostVersion('2026.1.0-beta.5', false);

      expect(build().isOpen()).toBe(true);
      expect(localStorage.getItem(LAST_SEEN_KEY)).toBeNull();
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

  describe('the step catalogue', () => {
    it('steps_onAFirstRun_carriesNoWhatsNew', () => {
      // There is no previous version to report against, so the step would have nothing to say.
      expect(
        build()
          .steps()
          .map((step: SetupStep): string => step.id),
      ).not.toContain('whats-new');
    });

    it('steps_onAnUpgrade_carriesWhatsNew', () => {
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.4'));

      expect(
        build()
          .steps()
          .map((step: SetupStep): string => step.id),
      ).toContain('whats-new');
    });

    it('steps_always_leadsWithWelcome', () => {
      expect(build().steps()[0].id).toBe('welcome');
    });

    it('steps_always_giveEveryStepARailLabelATitleAndAnIcon', () => {
      // The rail shows the icon and label, the pane shows the title; a step missing any of them
      // renders blank in a place the user cannot report usefully.
      for (const step of build().steps()) {
        expect(step.label.length, `${step.id} label`).toBeGreaterThan(0);
        expect(step.title.length, `${step.id} title`).toBeGreaterThan(0);
        expect(step.summary.length, `${step.id} summary`).toBeGreaterThan(0);
        expect(step.icon.classList.length, `${step.id} icon`).toBeGreaterThan(0);
      }
    });

    it('steps_always_giveEveryStepItsOwnIcon', () => {
      // A rail is a column of icons read together; two the same would make one step look like
      // another at a glance.
      const glyphs: readonly string[] = build()
        .steps()
        .map((step: SetupStep): string => step.icon.classList);

      expect(new Set(glyphs).size).toBe(glyphs.length);
    });
  });

  describe('the walked mark', () => {
    it('furthestIndex_beforeAnyNavigation_isTheFirstStep', () => {
      expect(build().furthestIndex()).toBe(0);
    });

    it('furthestIndex_afterAdvancing_followsTheStep', () => {
      const wizard: SetupWizard = build();

      wizard.next();

      expect(wizard.furthestIndex()).toBe(1);
    });

    it('furthestIndex_afterGoingBack_holdsTheFurthestReached', () => {
      // Going back does not un-walk the steps behind you; the rail must keep their ticks.
      const wizard: SetupWizard = build();
      wizard.next();
      wizard.next();

      wizard.back();

      expect(wizard.stepIndex()).toBe(1);
      expect(wizard.furthestIndex()).toBe(2);
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
