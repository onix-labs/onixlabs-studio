import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { HostEnv } from '@shared/api/host';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { RELEASE_HIGHLIGHTS } from '@shared/api/release-highlights';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { Plugins } from '@shared/angular/services/plugins/plugins';

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

/**
 * An installed harness contributing an Anthropic page, for growing an AI provider leaf.
 */
const CLAUDE_HARNESS: PluginSummary = {
  id: 'test.claude-harness',
  name: 'Claude',
  description: 'Test harness.',
  state: 'installed',
  version: '1.0.0',
  installedVersion: '1.0.0',
  detail: null,
  origin: null,
  contributions: [
    {
      slot: 'agent-harness',
      id: 'test.claude-harness',
      displayName: 'Claude',
      priority: 100,
      providers: [
        {
          kind: 'anthropic',
          company: 'Anthropic',
          authMethods: [{ auth: 'api-key', buttonLabel: 'API Key', defaultDisplayName: 'API' }],
        },
      ],
    },
  ],
} as unknown as PluginSummary;

/**
 * What the tree cases arrange: the plugin catalogue and the languages with an installed server,
 * both as signals so a case can install something after the wizard has opened.
 */
interface Installed {
  readonly plugins: WritableSignal<readonly PluginSummary[]>;
  readonly languages: WritableSignal<readonly string[]>;
  readonly loaded: WritableSignal<boolean>;
}

/**
 * Builds the service over a stubbed catalogue, then settles its effects so the baseline is taken.
 * @param installed What is installed.
 * @returns Returns the service.
 */
function buildWith(installed: Installed): SetupWizard {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Plugins,
        useValue: { plugins: installed.plugins, busy: signal<boolean>(false) },
      },
      {
        provide: LspSettings,
        useValue: {
          installedLanguages: (): readonly string[] => installed.languages(),
          catalogueLoaded: installed.loaded,
        },
      },
    ],
  });
  const wizard: SetupWizard = TestBed.inject(SetupWizard);
  TestBed.tick();
  return wizard;
}

/**
 * Arranges a catalogue with nothing installed and both catalogues loaded.
 * @returns Returns the arrangement.
 */
function nothingInstalled(): Installed {
  return {
    plugins: signal<readonly PluginSummary[]>([]),
    languages: signal<readonly string[]>([]),
    loaded: signal<boolean>(true),
  };
}

/**
 * Reads the step identifiers in walk order.
 * @param wizard The service.
 * @returns Returns the identifiers.
 */
function ids(wizard: SetupWizard): readonly string[] {
  return wizard.steps().map((step: SetupStep): string => step.id);
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

    it('steps_onAnUpgradeWithNothingToReport_omitsWhatsNew', () => {
      // An upgrade across a release nobody wrote highlights for has nothing to say, and a What's New
      // step that renders an empty list is worse than no step at all. The last release that HAS
      // highlights is the one last seen, so whatever is newer than it (if anything) has none.
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(RELEASE_HIGHLIGHTS.at(-1)!.version));

      expect(
        build()
          .steps()
          .map((step: SetupStep): string => step.id),
      ).not.toContain('whats-new');
    });

    it('steps_always_leadsWithWelcome', () => {
      expect(build().steps()[0].id).toBe('welcome');
    });

    it('steps_always_giveEveryRootARailLabelATitleAndAnIcon', () => {
      // The rail shows the icon and label, the pane shows the title; a step missing any of them
      // renders blank in a place the user cannot report usefully.
      for (const step of build().steps()) {
        expect(step.label.length, `${step.id} label`).toBeGreaterThan(0);
        expect(step.title.length, `${step.id} title`).toBeGreaterThan(0);
        expect(step.summary.length, `${step.id} summary`).toBeGreaterThan(0);
        expect(step.icon?.classList.length ?? 0, `${step.id} icon`).toBeGreaterThan(0);
      }
    });

    it('steps_always_giveEveryRootItsOwnIcon', () => {
      // A rail is a column of icons read together; two the same would make one step look like
      // another at a glance.
      const glyphs: readonly string[] = build()
        .steps()
        .map((step: SetupStep): string => step.icon?.classList ?? '');

      expect(new Set(glyphs).size).toBe(glyphs.length);
    });

    it('steps_always_carryARootPerPluginSlotInCatalogueOrder', () => {
      // One step per kind of plugin, under the Plugin Manager's own names, between the machine
      // check and the settings that come after.
      const labels: readonly string[] = build()
        .steps()
        .map((step: SetupStep): string => step.label);

      expect(labels).toEqual([
        'Welcome',
        'Appearance',
        'Environment',
        'Language Servers',
        'Debug Adapters',
        'Decoders',
        'Container Engines',
        'AI Providers',
        'Security',
        'Terminal',
        'Source Control',
      ]);
    });
  });

  describe('the tree', () => {
    it('steps_whenNothingIsInstalled_carryNoLeaves', () => {
      const wizard: SetupWizard = buildWith(nothingInstalled());

      expect(wizard.steps().every((step: SetupStep): boolean => step.parentId === undefined)).toBe(
        true,
      );
    });

    it('steps_whenALanguageServerIsInstalled_growALeafBeneathLanguageServers', () => {
      const installed: Installed = nothingInstalled();
      installed.languages.set(['csharp', 'java']);

      const wizard: SetupWizard = buildWith(installed);

      const languageServers: number = ids(wizard).indexOf('language-server');
      expect(ids(wizard).slice(languageServers, languageServers + 3)).toEqual([
        'language-server',
        'language-server/csharp',
        'language-server/java',
      ]);
      const leaf: SetupStep = wizard.steps()[languageServers + 1];
      expect(leaf.kind).toBe('language');
      expect(leaf.parentId).toBe('language-server');
      expect(leaf.language).toBe('csharp');
      expect(leaf.label).toBe('C#');
      expect(leaf.icon).toBeUndefined();
    });

    it('steps_whenAHarnessIsInstalled_growALeafPerProviderBeneathAiProviders', () => {
      const installed: Installed = nothingInstalled();
      installed.plugins.set([CLAUDE_HARNESS]);

      const wizard: SetupWizard = buildWith(installed);

      const aiProviders: number = ids(wizard).indexOf('agent-harness');
      expect(ids(wizard)[aiProviders + 1]).toBe('agent-harness/anthropic');
      const leaf: SetupStep = wizard.steps()[aiProviders + 1];
      expect(leaf.kind).toBe('ai-provider');
      expect(leaf.pageId).toBe('anthropic');
      expect(leaf.label).toBe('Anthropic');
    });

    it('steps_whenAPluginIsInstalledDuringTheRun_growItsLeafWhileTheUserStandsOnTheRoot', () => {
      // Installing from a root grows its leaves under the user's feet, and Next walks into them.
      const installed: Installed = nothingInstalled();
      const wizard: SetupWizard = buildWith(installed);
      while (wizard.current()?.id !== 'language-server') {
        wizard.next();
      }

      installed.languages.set(['rust']);

      expect(wizard.current()?.id).toBe('language-server');
      wizard.next();
      expect(wizard.current()?.id).toBe('language-server/rust');
      wizard.next();
      expect(wizard.current()?.id).toBe('debug-adapter');
    });

    it('steps_onAnUpgrade_leaveOutLeavesThatWereAlreadyThere', () => {
      // A language set up long ago is not something the upgrade has to say about; only what was
      // installed during this pass is unseen.
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.4'));
      const installed: Installed = nothingInstalled();
      installed.languages.set(['csharp']);
      installed.plugins.set([CLAUDE_HARNESS]);

      const wizard: SetupWizard = buildWith(installed);

      expect(ids(wizard)).not.toContain('language-server/csharp');
      expect(ids(wizard)).not.toContain('agent-harness/anthropic');
    });

    it('steps_onAnUpgrade_growALeafForAPluginInstalledDuringThePass', () => {
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.4'));
      const installed: Installed = nothingInstalled();
      installed.languages.set(['csharp']);
      const wizard: SetupWizard = buildWith(installed);

      installed.languages.set(['csharp', 'rust']);

      expect(ids(wizard)).toContain('language-server/rust');
      expect(ids(wizard)).not.toContain('language-server/csharp');
    });

    it('steps_onAnUpgradeBeforeTheCatalogueHasLoaded_showNoLeavesRatherThanAll', () => {
      // At a cold start neither catalogue has answered; a baseline of "nothing installed" would make
      // every long-standing leaf look new on exactly the upgrade the delta is meant to keep short.
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.4'));
      const installed: Installed = nothingInstalled();
      installed.loaded.set(false);
      installed.languages.set(['csharp']);

      const wizard: SetupWizard = buildWith(installed);

      expect(ids(wizard)).not.toContain('language-server/csharp');
    });
  });

  describe('the delta rules', () => {
    it('steps_onAFirstRun_presentEverythingExceptWhatsNew', () => {
      const ids: readonly string[] = build()
        .steps()
        .map((step: SetupStep): string => step.id);

      expect(ids).toContain('appearance');
      expect(ids).toContain('security');
      expect(ids).toContain('terminal');
      expect(ids).not.toContain('whats-new');
    });

    it('steps_onAnUpgradeFromBeforeASettingLanded_presentThatSettingsStep', () => {
      // The graphics level landed in beta.4, so someone arriving from beta.3 has never seen it.
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.3'));

      expect(
        build()
          .steps()
          .map((step: SetupStep): string => step.id),
      ).toContain('appearance');
    });

    it('steps_onAnUpgradeWithNothingNewInThem_leaveSettingsStepsOut', () => {
      // Nothing in the security or terminal steps has changed since beta.4, so re-asking would turn
      // the pass into a toll paid on every release.
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.4'));

      const ids: readonly string[] = build()
        .steps()
        .map((step: SetupStep): string => step.id);

      expect(ids).not.toContain('security');
      expect(ids).not.toContain('terminal');
      expect(ids).not.toContain('appearance');
    });

    it('steps_onAnUpgrade_alwaysKeepTheStepsAboutTheMachine', () => {
      // The machine changes underneath Studio without any version doing so — a runtime uninstalled,
      // a credential expired — so these are looked at again regardless.
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.4'));

      const ids: readonly string[] = build()
        .steps()
        .map((step: SetupStep): string => step.id);

      expect(ids).toContain('environment');
      expect(ids).toContain('language-server');
      expect(ids).toContain('agent-harness');
    });

    it('steps_onAnUpgradeAcrossAReleaseWithHighlights_leadWithWhatsNew', () => {
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.3'));

      const ids: readonly string[] = build()
        .steps()
        .map((step: SetupStep): string => step.id);

      expect(ids[0]).toBe('welcome');
      expect(ids[1]).toBe('whats-new');
    });

    it('highlights_onAnUpgrade_reportTheReleasesCrossed', () => {
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify('2026.1.0-beta.3'));

      expect(build().highlights.length).toBeGreaterThan(0);
    });

    it('highlights_onAFirstRun_areEmpty', () => {
      expect(build().highlights).toEqual([]);
    });
  });

  describe('the walked mark', () => {
    it('isWalked_beforeAnyNavigation_marksNothing', () => {
      const wizard: SetupWizard = build();

      expect(wizard.steps().some((step: SetupStep): boolean => wizard.isWalked(step))).toBe(false);
    });

    it('isWalked_afterAdvancing_marksTheStepLeftBehind', () => {
      const wizard: SetupWizard = build();

      wizard.next();

      expect(wizard.isWalked(wizard.steps()[0])).toBe(true);
      expect(wizard.isWalked(wizard.steps()[1])).toBe(false);
    });

    it('isWalked_afterGoingBack_keepsTheStepsWalked', () => {
      // Going back does not un-walk the steps behind you; the rail must keep their ticks.
      const wizard: SetupWizard = build();
      wizard.next();
      wizard.next();

      wizard.back();

      expect(wizard.stepIndex()).toBe(1);
      expect(wizard.isWalked(wizard.steps()[1])).toBe(true);
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
