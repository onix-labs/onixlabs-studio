import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
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
   * Gets the step's title.
   */
  readonly title: string;

  /**
   * Gets the one-line explanation shown beneath the title.
   */
  readonly summary: string;
}

/**
 * Holds the setup steps in the order they are presented. Later phases of the epic add entries and the
 * rules that select a subset of them for an upgrade; the order here is the order the user walks.
 */
export const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to ONIXLabs Studio',
    summary:
      'A short pass through the things that decide whether Studio works on this machine. Nothing ' +
      'here is permanent — every choice is in Settings afterwards.',
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
   */
  public readonly steps: Signal<readonly SetupStep[]> =
    signal<readonly SetupStep[]>(SETUP_STEPS).asReadonly();

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
