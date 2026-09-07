import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
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
 * Names a step in the setup sequence. The identifier is the contract between this service — which
 * decides which steps run and in what order — and the wizard's own view, which maps each identifier
 * to the component that renders it. The service is deliberately ignorant of the components: it lives
 * in shared, and they live in the settings feature.
 */
export type SetupStepId =
  | 'welcome'
  | 'whats-new'
  | 'appearance'
  | 'environment'
  | 'tooling'
  | 'ai-provider'
  | 'security'
  | 'terminal'
  | 'source-control';

/**
 * Describes one step of the setup sequence: what it is called, and the sentence that says why the
 * user is being shown it.
 */
export interface SetupStep {
  /**
   * Gets the identifier the view renders this step by.
   */
  readonly id: SetupStepId;

  /**
   * Gets the icon shown beside the step on the rail.
   */
  readonly icon: Icon;

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
}

/**
 * Holds the setup steps in the order they are presented — the order the user walks.
 *
 * The catalogue is complete; the steps' contents are not. Later phases of the epic fill each one in
 * and add the rules that select a subset for an upgrade. It is stated in full here rather than grown
 * a step at a time because the rail is the wizard's spine: a user is owed a view of how far they have
 * to go from the first screen, and a rail that grew as the phases landed would mean the shell could
 * not be judged until the last of them.
 */
export const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: 'welcome',
    icon: Icon.SETUP_WELCOME,
    label: 'Welcome',
    title: 'Welcome to ONIXLabs Studio',
    summary:
      'A short pass through the things that decide whether Studio works on this machine. Nothing ' +
      'here is permanent — every choice is in Settings afterwards.',
  },
  {
    id: 'whats-new',
    icon: Icon.SETUP_WHATS_NEW,
    label: "What's New",
    title: 'What changed in this version',
    summary: 'The parts of this release worth knowing about before you carry on.',
  },
  {
    id: 'appearance',
    icon: Icon.SETUP_APPEARANCE,
    label: 'Appearance',
    title: 'How Studio should look',
    summary: 'Theme, accent colour, and how much of the GPU the interface uses.',
  },
  {
    id: 'environment',
    icon: Icon.SETUP_ENVIRONMENT,
    label: 'Environment',
    title: 'What is installed underneath',
    summary:
      'The tools Studio builds on, checked against this machine — so anything missing is said here ' +
      'rather than failing quietly later.',
  },
  {
    id: 'tooling',
    icon: Icon.SETUP_TOOLING,
    label: 'Tooling',
    title: 'Tooling and plugins',
    summary: 'Language support, container engines and decoders, installed as you need them.',
  },
  {
    id: 'ai-provider',
    icon: Icon.SETUP_AI_PROVIDER,
    label: 'AI Provider',
    title: 'Which AI Studio talks to',
    summary: 'A connection, a credential, and a model — verified before you leave this step.',
  },
  {
    id: 'security',
    icon: Icon.SETUP_SECURITY,
    label: 'Security',
    title: 'Security and privacy',
    summary:
      'What content may load from the network, and how much the agent may do without asking.',
  },
  {
    id: 'terminal',
    icon: Icon.SETUP_TERMINAL,
    label: 'Terminal',
    title: 'Terminal and shell',
    summary:
      'The shell new terminals start with, and the one the agent takes its environment from.',
  },
  {
    id: 'source-control',
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
   * Holds the index of the step being shown.
   */
  private readonly index: WritableSignal<number> = signal<number>(0);

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
   * Gets the steps this run presents, in order.
   *
   * A first run has no previous version to report against, so it carries no What's New; the delta
   * rules that shorten an upgrade to what actually changed arrive with the rest of that step.
   */
  public readonly steps: Signal<readonly SetupStep[]> = signal<readonly SetupStep[]>(
    this.mode === 'first-run'
      ? SETUP_STEPS.filter((step: SetupStep): boolean => step.id !== 'whats-new')
      : SETUP_STEPS,
  ).asReadonly();

  /**
   * Holds the furthest step reached this run, which is what separates a step already walked from one
   * still ahead. It is not the current index: going back does not un-walk the steps behind you.
   */
  private readonly furthest: WritableSignal<number> = signal<number>(0);

  /**
   * Gets the furthest step reached this run.
   */
  public readonly furthestIndex: Signal<number> = this.furthest.asReadonly();

  /**
   * Gets the index of the step being shown.
   */
  public readonly stepIndex: Signal<number> = this.index.asReadonly();

  /**
   * Gets the step being shown, or undefined when the run has no steps at all.
   */
  public readonly current: Signal<SetupStep | undefined> = computed(
    (): SetupStep | undefined => this.steps()[this.index()],
  );

  /**
   * Gets whether the current step is the last one, which is what turns Next into Finish.
   */
  public readonly isLastStep: Signal<boolean> = computed(
    (): boolean => this.index() >= this.steps().length - 1,
  );

  /**
   * Gets whether there is a step to go back to.
   */
  public readonly canGoBack: Signal<boolean> = computed((): boolean => this.index() > 0);

  /**
   * Initializes the service, opening the wizard when this version has not been set up.
   */
  public constructor() {
    if (this.version === null) {
      this.log.debug('SetupWizard', 'No host version; setup does not run outside Electron');
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
  }

  /**
   * Advances to the next step, or completes the wizard when the last step is showing.
   */
  public next(): void {
    if (this.isLastStep()) {
      this.finish();
      return;
    }
    this.index.update((current: number): number => current + 1);
    this.furthest.update((reached: number): number => Math.max(reached, this.index()));
  }

  /**
   * Returns to the previous step. Does nothing on the first step.
   */
  public back(): void {
    if (this.canGoBack()) {
      this.index.update((current: number): number => current - 1);
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
