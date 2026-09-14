import {
  computed,
  effect,
  inject,
  Service,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import type { ProviderPage } from '@shared/api/ai-types';
import { PLUGIN_SLOT_LABELS, PLUGIN_SLOTS, type PluginSlot } from '@shared/api/plugin-channels';
import { highlightsBetween, ReleaseHighlights } from '@shared/api/release-highlights';
import { isNewerStudioVersion } from '@shared/api/studio-version';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { Log } from '@shared/angular/services/log/log';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { languageDisplayName } from '@shared/angular/services/plugins/language-names';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import { SettingDef } from '@shared/angular/services/settings/settings-schema';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * Holds the store key under which the version the user last completed setup on is persisted. Written
 * only by {@link SetupWizard.finish} — a wizard abandoned part-way has decided nothing, and must be
 * asked again next launch.
 */
const LAST_SEEN_KEY: string = 'studio.setup.lastSeenVersion';

/**
 * Identifies why the wizard is running, which decides how much of it the user sees. A first run has
 * no last-seen version to compare against, so every step applies; an upgrade shows only what the new
 * version brought and what is currently wrong.
 */
export type SetupMode = 'first-run' | 'upgrade';

/**
 * Names what a step is made of, which is the contract between this service — which decides which
 * steps run and in what order — and the wizard's own view, which maps each kind to the component that
 * renders it. The service is deliberately ignorant of the components: it lives in shared, and they
 * live in the settings feature.
 *
 * A `catalogue` step installs plugins into one slot; a `language` or `ai-provider` step configures
 * one thing such a plugin brought, and exists only while it is installed.
 */
export type SetupStepKind =
  | 'welcome'
  | 'whats-new'
  | 'settings'
  | 'environment'
  | 'catalogue'
  | 'language'
  | 'ai-provider'
  | 'terminal'
  | 'source-control';

/**
 * Describes one step of the setup sequence: what it is called, the sentence that says why the user
 * is being shown it, and where it sits in the tree the rail draws.
 */
export interface SetupStep {
  /**
   * Gets the identifier, unique across the run. A root's is its name; a leaf's is its root's followed
   * by what it configures (`language-servers/csharp`), so the same leaf has the same identity however
   * many times the tree is rebuilt around it.
   */
  readonly id: string;

  /**
   * Gets what the step is made of, which is what the view renders it with.
   */
  readonly kind: SetupStepKind;

  /**
   * Gets the identifier of the root this step sits beneath, or undefined for a root.
   */
  readonly parentId?: string;

  /**
   * Gets the icon shown beside the step on the rail. Roots carry one; leaves sit beneath their
   * root's and carry none, as the settings tree draws them.
   */
  readonly icon?: Icon;

  /**
   * Gets the short name shown on the step rail, where the room is a single line. Distinct from
   * {@link title}, which heads the step itself and can afford to be a sentence.
   */
  readonly label: string;

  /**
   * Gets the step's title.
   */
  readonly title: string;

  /**
   * Gets the one-line explanation shown beneath the title.
   */
  readonly summary: string;

  /**
   * Gets the slot a catalogue step installs into.
   */
  readonly slot?: PluginSlot;

  /**
   * Gets the language a language step configures.
   */
  readonly language?: string;

  /**
   * Gets the provider page an AI provider step signs in to.
   */
  readonly pageId?: string;
}

/**
 * Maps each settings-driven step to the setting keys it presents, so the delta rules can ask whether
 * a step has anything new in it. A step absent from this map carries no settings — it is driven by
 * something else (the environment probes, the plugin catalogue) and says for itself whether it
 * applies.
 *
 * It lives beside the step catalogue rather than with the components that render it: which settings a
 * step is *about* is what decides whether the step runs at all, and that decision is this service's.
 */
export const SETUP_STEP_SETTINGS: Readonly<Record<string, readonly string[]>> = {
  appearance: ['appearance.themeMode', 'appearance.accent', 'display.graphicsAcceleration'],
  security: ['security.imagePolicy', 'ai.permissionPosture'],
  terminal: ['terminal.defaultShell', 'ai.agentShell'],
};

/**
 * What each plugin step says about itself: the icon its root carries, and why the category matters
 * enough to be a step. The label is the Plugin Manager's, so a category installed here is found
 * there under the same name.
 */
const SLOT_STEPS: Readonly<Record<PluginSlot, { icon: Icon; title: string; summary: string }>> = {
  'language-server': {
    icon: Icon.SETUP_LANGUAGE_SERVERS,
    title: 'Language support',
    summary:
      'Studio ships no language server. Install support for the languages you work in; each one ' +
      'gets a step of its own below once it is installed.',
  },
  'debug-adapter': {
    icon: Icon.SETUP_DEBUG_ADAPTERS,
    title: 'Debuggers',
    summary:
      'One debugger per runtime, installed as you need them. Nothing to configure afterwards.',
  },
  decoder: {
    icon: Icon.SETUP_DECODERS,
    title: 'Decoders',
    summary: 'What the binary editor can disassemble and decode.',
  },
  'container-engine': {
    icon: Icon.SETUP_CONTAINER_ENGINES,
    title: 'Container engines',
    summary:
      'The engine the Containers tab talks to. Without one installed the tab has nothing to show.',
  },
  'agent-harness': {
    icon: Icon.SETUP_AI_PROVIDER,
    title: 'Which AI Studio talks to',
    summary:
      'Studio runs agents through provider plugins, so the stack is yours to choose. Each provider ' +
      'a plugin offers gets a step of its own below once it is installed.',
  },
};

/**
 * Builds the catalogue step for a slot.
 * @param slot The slot.
 * @returns Returns the step.
 */
function catalogueStep(slot: PluginSlot): SetupStep {
  return {
    id: slot,
    kind: 'catalogue',
    slot,
    icon: SLOT_STEPS[slot].icon,
    label: PLUGIN_SLOT_LABELS[slot],
    title: SLOT_STEPS[slot].title,
    summary: SLOT_STEPS[slot].summary,
  };
}

/**
 * Holds the setup roots in the order they are presented — the order the user walks.
 *
 * The catalogue is complete; leaves grow beneath the plugin roots as plugins are installed. It is
 * stated in full here rather than grown a step at a time because the rail is the wizard's spine: a
 * user is owed a view of how far they have to go from the first screen.
 */
export const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: 'welcome',
    kind: 'welcome',
    icon: Icon.SETUP_WELCOME,
    label: 'Welcome',
    title: 'Welcome to ONIXLabs Studio',
    summary:
      'A short pass through the things that decide whether Studio works on this machine. Nothing ' +
      'here is permanent — every choice is in Settings afterwards.',
  },
  {
    id: 'whats-new',
    kind: 'whats-new',
    icon: Icon.SETUP_WHATS_NEW,
    label: "What's New",
    title: 'What changed in this version',
    summary: 'The parts of this release worth knowing about before you carry on.',
  },
  {
    id: 'appearance',
    kind: 'settings',
    icon: Icon.SETUP_APPEARANCE,
    label: 'Appearance',
    title: 'How Studio should look',
    summary: 'Theme, accent colour, and how much of the GPU the interface uses.',
  },
  {
    id: 'environment',
    kind: 'environment',
    icon: Icon.SETUP_ENVIRONMENT,
    label: 'Environment',
    title: 'What is installed underneath',
    summary:
      'The tools Studio builds on, checked against this machine — so anything missing is said here ' +
      'rather than failing quietly later.',
  },
  ...PLUGIN_SLOTS.map(catalogueStep),
  {
    id: 'security',
    kind: 'settings',
    icon: Icon.SETUP_SECURITY,
    label: 'Security',
    title: 'Security and privacy',
    summary:
      'What content may load from the network, and how much the agent may do without asking.',
  },
  {
    id: 'terminal',
    kind: 'terminal',
    icon: Icon.SETUP_TERMINAL,
    label: 'Terminal',
    title: 'Terminal and shell',
    summary:
      'The shell new terminals start with, and the one the agent takes its environment from.',
  },
  {
    id: 'source-control',
    kind: 'source-control',
    icon: Icon.SETUP_SOURCE_CONTROL,
    label: 'Source Control',
    title: 'Source control',
    summary: 'Who your commits are attributed to, and how Studio reaches your forge.',
  },
];

/**
 * Owns whether the setup wizard is running, and how far through it the user is.
 *
 * The wizard is gated on Studio's own version: it runs on a first launch, and again whenever the
 * running version differs from the one the user last completed setup on. The comparison is exact
 * string inequality rather than an ordering — a downgrade is as much a change of environment as an
 * upgrade, and both deserve the pass.
 *
 * The steps are a tree walked in order: a plugin root installs into one slot, and beneath it a leaf
 * appears for each thing an installed plugin brought that has something to decide — a language's
 * server, a provider's sign-in. The leaves are derived from what is installed, so installing from a
 * root grows its leaves while the user is still standing on it, and Next walks into them.
 *
 * Reaching the end is the only thing that writes the last-seen version. Closing the wizard's window
 * part-way decides nothing, so the wizard returns on the next launch; there is no way to be asked
 * once and silently skipped.
 *
 * Outside Electron there is no host and therefore no version to gate on, so the wizard never opens —
 * an honest no-op rather than a wizard that could never be satisfied.
 */
@Service()
export class SetupWizard {
  /**
   * Holds the key/value store the last-seen version is persisted in.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the plugin client, read for when the catalogue has loaded.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the language-server settings, which decide the languages that grow leaves.
   */
  private readonly lspSettings: LspSettings = inject(LspSettings);

  /**
   * Holds the providers installed harnesses contribute, which decide the AI leaves.
   */
  private readonly providers: AiProviders = inject(AiProviders);

  /**
   * Holds the running build's version, or null when the renderer runs outside Electron.
   */
  private readonly version: string | null = window.host?.versions.studio ?? null;

  /**
   * Holds the version the user last completed setup on, or null on a first run. Read once at
   * construction: it is the input to the gate, and a value written later by this very service must
   * not re-open the wizard it just closed.
   */
  private readonly lastSeen: string | null = this.store.get<string | null>(LAST_SEEN_KEY, null);

  /**
   * Holds whether the wizard is currently running.
   */
  private readonly running: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the identifier of the step being shown. An identifier rather than an index: leaves appear
   * beneath a root while the user stands on it, and an index into a list that just grew would point
   * at a different step than the one they were reading.
   */
  private readonly currentId: WritableSignal<string> = signal<string>('welcome');

  /**
   * Holds the identifiers of the steps already walked, which is what separates a step left behind
   * from one still ahead. Going back does not un-walk the steps behind you.
   */
  private readonly walkedIds: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the leaves present when the catalogue first loaded this run, or null until it has. An
   * upgrade shows only leaves that were not there then — a plugin installed during this pass, whose
   * configuration the user has not yet seen — rather than every language and provider they set up
   * long ago.
   */
  private readonly baseline: WritableSignal<ReadonlySet<string> | null> =
    signal<ReadonlySet<string> | null>(null);

  /**
   * Gets whether the wizard is running, and therefore whether its window is presented. The welcome
   * screen reads this to stand aside: both want the same cold start, and the wizard comes first.
   */
  public readonly isOpen: Signal<boolean> = this.running.asReadonly();

  /**
   * Gets why the wizard is running.
   */
  public readonly mode: SetupMode = this.lastSeen === null ? 'first-run' : 'upgrade';

  /**
   * Gets the version the user last completed setup on, or null on a first run. Exposed for the
   * delta rules, which select an upgrade's steps by what changed since it.
   */
  public readonly lastSeenVersion: string | null = this.lastSeen;

  /**
   * Gets the highlights of every release being moved across, oldest first. Empty on a first run,
   * and empty for a release nobody wrote highlights for.
   */
  public readonly highlights: readonly ReleaseHighlights[] = highlightsBetween(
    this.lastSeen,
    this.version ?? '',
  );

  /**
   * Gets the leaves the installed plugins currently call for, in walk order, keyed by the root they
   * sit beneath.
   */
  private readonly leaves: Signal<readonly SetupStep[]> = computed((): readonly SetupStep[] => [
    ...this.lspSettings.installedLanguages().map((language: string): SetupStep => ({
      id: `language-server/${language}`,
      kind: 'language',
      parentId: 'language-server',
      language,
      label: languageDisplayName(language),
      title: `${languageDisplayName(language)} support`,
      summary: 'Which installed server serves it, whether it runs, and the runtime it needs.',
    })),
    ...this.providers.pages().map((page: ProviderPage): SetupStep => ({
      id: `agent-harness/${page.id}`,
      kind: 'ai-provider',
      parentId: 'agent-harness',
      pageId: page.id,
      label: page.label,
      title: `Sign in to ${page.label}`,
      summary: 'A way to sign in, a credential, and a check that it answers — before you leave.',
    })),
  ]);

  /**
   * Gets the steps this run presents, in walk order: each root followed by its leaves.
   *
   * Declared after {@link highlights}, and it has to be: class fields initialise in declaration
   * order, and the rule that decides whether What's New runs reads the highlights. Ordered the other
   * way, an upgrade would read them before they existed.
   */
  public readonly steps: Signal<readonly SetupStep[]> = computed((): readonly SetupStep[] => {
    const leaves: readonly SetupStep[] = this.leaves().filter((leaf: SetupStep): boolean =>
      this.leafApplies(leaf),
    );
    return SETUP_STEPS.filter((step: SetupStep): boolean => this.applies(step)).flatMap(
      (root: SetupStep): readonly SetupStep[] => [
        root,
        ...leaves.filter((leaf: SetupStep): boolean => leaf.parentId === root.id),
      ],
    );
  });

  /**
   * Gets the index of the step being shown. Never negative: a step that vanished from under the user
   * (its plugin uninstalled elsewhere) leaves them on the first step rather than on nothing.
   */
  public readonly stepIndex: Signal<number> = computed((): number =>
    Math.max(
      0,
      this.steps().findIndex((step: SetupStep): boolean => step.id === this.currentId()),
    ),
  );

  /**
   * Gets the step being shown, or undefined when the run has no steps at all.
   */
  public readonly current: Signal<SetupStep | undefined> = computed(
    (): SetupStep | undefined => this.steps()[this.stepIndex()],
  );

  /**
   * Gets whether the current step is the last one, which is what turns Next into Finish.
   */
  public readonly isLastStep: Signal<boolean> = computed(
    (): boolean => this.stepIndex() >= this.steps().length - 1,
  );

  /**
   * Gets whether there is a step to go back to.
   */
  public readonly canGoBack: Signal<boolean> = computed((): boolean => this.stepIndex() > 0);

  /**
   * Initializes the service, opening the wizard when this version has not been set up.
   */
  public constructor() {
    if (this.version === null) {
      this.log.debug('SetupWizard', 'No host version; setup does not run outside Electron');
      return;
    }
    // The way past a wizard that will not complete. Suppression is for the launch only and records
    // nothing, so the pass is still owed and is asked for again as soon as the diagnostic is unset.
    if (window.host?.skipSetup === true) {
      this.log.info('SetupWizard', 'Setup suppressed for this launch (STUDIO_SKIP_SETUP=1)');
      return;
    }
    if (this.version === this.lastSeen) {
      this.log.debug('SetupWizard', `Setup already completed for ${this.version}`);
      return;
    }
    this.log.info(
      'SetupWizard',
      `Running setup for ${this.version} (${this.mode}, last seen ${this.lastSeen ?? 'never'})`,
    );
    this.running.set(true);
    // The baseline is taken once both catalogues have answered, not at construction: at a cold start
    // neither has loaded yet, and a baseline of "nothing installed" would make every long-standing
    // leaf look freshly installed on the very upgrade the delta exists to keep short.
    effect((): void => {
      if (this.baseline() !== null || this.plugins.busy() || !this.lspSettings.catalogueLoaded()) {
        return;
      }
      const present: ReadonlySet<string> = new Set<string>(
        this.leaves().map((leaf: SetupStep): string => leaf.id),
      );
      untracked((): void => this.baseline.set(present));
    });
  }

  /**
   * Decides whether a root runs this time.
   *
   * A first run presents everything except What's New, which has no previous version to report
   * against. An upgrade presents only what it has something to say about: the release notes, and any
   * step holding a setting that did not exist when the user last completed setup. Everything else
   * they have already answered, and asking again on every beta would turn the pass into a toll.
   *
   * The environment and plugin steps always run. They are not about settings but about the machine,
   * and the machine changes underneath Studio without any version doing so — a runtime uninstalled, a
   * credential expired. A version bump is as good a moment as any to look again.
   * @param step The root to test.
   * @returns Returns true when the step should be presented.
   */
  private applies(step: SetupStep): boolean {
    if (step.kind === 'whats-new') {
      return this.mode === 'upgrade' && this.highlights.length > 0;
    }
    if (this.mode === 'first-run' || this.lastSeen === null) {
      return true;
    }
    if (step.kind === 'welcome' || step.kind === 'environment' || step.kind === 'catalogue') {
      return true;
    }
    return this.hasNewSettings(step, this.lastSeen);
  }

  /**
   * Decides whether a leaf runs this time: always on a first run, and on an upgrade only when it was
   * not there when the catalogue first loaded — that is, its plugin was installed during this pass.
   * Until the baseline exists nothing is known about what is new, so nothing is shown rather than
   * everything.
   * @param leaf The leaf to test.
   * @returns Returns true when the leaf should be presented.
   */
  private leafApplies(leaf: SetupStep): boolean {
    if (this.mode === 'first-run') {
      return true;
    }
    const baseline: ReadonlySet<string> | null = this.baseline();
    return baseline !== null && !baseline.has(leaf.id);
  }

  /**
   * Determines whether a step presents a setting that did not exist at the given version.
   * @param step The step to test.
   * @param since The version the user last completed setup on.
   * @returns Returns true when at least one of the step's settings is newer than that version.
   */
  private hasNewSettings(step: SetupStep, since: string): boolean {
    return (SETUP_STEP_SETTINGS[step.id] ?? []).some((key: string): boolean => {
      const setting: SettingDef | undefined = SETTINGS_BY_KEY.get(key);
      return setting?.since !== undefined && isNewerStudioVersion(setting.since, since);
    });
  }

  /**
   * Reports whether a step has been walked — left behind by Next at some point this run.
   * @param step The step.
   * @returns Returns true when the step has been walked.
   */
  public isWalked(step: SetupStep): boolean {
    return this.walkedIds().has(step.id);
  }

  /**
   * Advances to the next step, or completes the wizard when the last step is showing.
   */
  public next(): void {
    if (this.isLastStep()) {
      this.finish();
      return;
    }
    const leaving: SetupStep | undefined = this.current();
    const following: SetupStep | undefined = this.steps()[this.stepIndex() + 1];
    if (leaving === undefined || following === undefined) {
      return;
    }
    this.walkedIds.update((walked: ReadonlySet<string>): ReadonlySet<string> =>
      new Set<string>(walked).add(leaving.id),
    );
    this.currentId.set(following.id);
  }

  /**
   * Returns to the previous step. Does nothing on the first step.
   */
  public back(): void {
    const previous: SetupStep | undefined = this.steps()[this.stepIndex() - 1];
    if (previous !== undefined) {
      this.currentId.set(previous.id);
    }
  }

  /**
   * Completes the wizard, recording the version as set up so it does not run again until the version
   * changes. This is the only path that writes the record.
   */
  public finish(): void {
    if (this.version !== null) {
      this.store.set<string>(LAST_SEEN_KEY, this.version);
      this.log.info('SetupWizard', `Setup completed for ${this.version}`);
    }
    this.running.set(false);
  }

  /**
   * Abandons the wizard for this session without recording anything, which is what closing its window
   * does. The wizard runs again on the next launch, because nothing was decided.
   */
  public abandon(): void {
    this.log.info('SetupWizard', 'Setup abandoned; it will run again on the next launch');
    this.running.set(false);
  }
}
