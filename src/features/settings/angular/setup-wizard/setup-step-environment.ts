import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { SetupProbeId, SetupProbeResult } from '@shared/api/setup-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { SetupProbes } from '@shared/angular/services/setup-probes/setup-probes';

/**
 * Names each probe in the user's terms, and says what it is for. The main process reports what it
 * found; what the thing is called and why it matters is presentation, and belongs here.
 */
const PROBE_LABELS: Readonly<Record<SetupProbeId, string>> = {
  git: 'Git',
  'git-identity': 'Commit identity',
  node: 'Node.js',
  dotnet: '.NET SDK',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  python: 'Python',
  clangd: 'clangd',
};

/**
 * Holds the probes that are about Studio working at all, rather than about one language. Git is here
 * because source control is not a language feature — every workspace uses it.
 */
const ESSENTIAL_PROBES: readonly SetupProbeId[] = ['git'];

/**
 * Holds the probes that hang beneath another, because they are a property of it rather than a thing
 * in their own right. An identity is a way git is *configured*; listing it as a sibling implied two
 * independent tools, which is not what it is.
 */
const NESTED_PROBES: Readonly<Partial<Record<SetupProbeId, SetupProbeId>>> = {
  'git-identity': 'git',
};

/**
 * The setup wizard's environment step: what Studio depends on, checked against this machine.
 *
 * This step carries the wizard's actual promise. Everything it reports is something that otherwise
 * fails much later and for a reason that looks nothing like its cause — a C# server that never starts
 * because `dotnet` is not on the login shell's PATH, a commit refused hours in because no identity was
 * ever configured. Saying so here costs a sentence; finding out the other way costs an afternoon.
 *
 * The toolchains listed are exactly those behind the languages Studio has support for, so the list is
 * derived from what Studio can do rather than picked. Nothing here blocks and nothing here is a
 * failure: a missing Go toolchain on a machine that writes no Go is not a problem, it is a fact, and
 * the step reports it as one.
 */
@Component({
  selector: 'app-setup-step-environment',
  imports: [AppIcon, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-environment.scss',
  template: `
    @if (!probes.isAvailable) {
      <p class="env__unavailable">
        The environment cannot be checked outside the desktop application.
      </p>
    } @else {
      <section class="env__group">
        <h3 class="env__group-title">Essentials</h3>
        <ul class="env__list">
          @for (result of essentials(); track result.id) {
            <li class="env__item" [class]="'env__item--' + result.status">
              <app-icon class="env__mark" [icon]="markOf(result.status)" [size]="1" />
              <span class="env__text">
                <span class="env__name">{{ label(result.id) }}</span>
                <span class="env__detail">{{ result.detail }}</span>
              </span>
            </li>
            @for (child of childrenOf(result.id); track child.id) {
              <li class="env__item env__item--nested" [class]="'env__item--' + child.status">
                <app-icon class="env__mark" [icon]="markOf(child.status)" [size]="1" />
                <span class="env__text">
                  <span class="env__name">{{ label(child.id) }}</span>
                  <span class="env__detail">{{ child.detail }}</span>
                </span>
              </li>
            }
          }
        </ul>
      </section>

      <section class="env__group">
        <h3 class="env__group-title">Language toolchains</h3>
        <p class="env__group-note">
          One per language Studio supports. Anything you do not write in is safe to leave missing.
        </p>
        <ul class="env__list">
          @for (result of toolchains(); track result.id) {
            <li class="env__item" [class]="'env__item--' + result.status">
              <app-icon class="env__mark" [icon]="markOf(result.status)" [size]="1" />
              <span class="env__text">
                <span class="env__name">{{ label(result.id) }}</span>
                <span class="env__detail">{{ result.detail }}</span>
              </span>
            </li>
          }
        </ul>
      </section>

      <div class="env__actions">
        <app-button
          label="Check again"
          [loading]="probes.busy()"
          (click)="recheck()"
          tooltip="Run the checks again, after fixing something"
        />
      </div>
    }
  `,
})
export class SetupStepEnvironment {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the probe client, exposed for the template.
   */
  protected readonly probes: SetupProbes = inject(SetupProbes);

  /**
   * Gets the essential results, excluding anything that hangs beneath another row.
   */
  protected readonly essentials: Signal<readonly SetupProbeResult[]> = computed(
    (): readonly SetupProbeResult[] =>
      this.probes
        .results()
        .filter(
          (result: SetupProbeResult): boolean =>
            ESSENTIAL_PROBES.includes(result.id) && NESTED_PROBES[result.id] === undefined,
        ),
  );

  /**
   * Gets the language-toolchain results — everything that is neither essential nor nested.
   */
  protected readonly toolchains: Signal<readonly SetupProbeResult[]> = computed(
    (): readonly SetupProbeResult[] =>
      this.probes
        .results()
        .filter(
          (result: SetupProbeResult): boolean =>
            !ESSENTIAL_PROBES.includes(result.id) && NESTED_PROBES[result.id] === undefined,
        ),
  );

  /**
   * Returns the results that hang beneath a given probe.
   * @param parent The parent probe identifier.
   * @returns Returns its children, in probe order.
   */
  protected childrenOf(parent: SetupProbeId): readonly SetupProbeResult[] {
    return this.probes
      .results()
      .filter((result: SetupProbeResult): boolean => NESTED_PROBES[result.id] === parent);
  }

  /**
   * Initializes the step, running the probes as it is constructed. The step is created when the user
   * reaches it, so this is the moment the answer is wanted and the moment it is most likely accurate.
   */
  public constructor() {
    void this.probes.refresh();
  }

  /**
   * Returns the display name of a probe.
   * @param id The probe identifier.
   * @returns Returns the label.
   */
  protected label(id: SetupProbeId): string {
    return PROBE_LABELS[id] ?? id;
  }

  /**
   * Returns the mark shown against a result.
   * @param status The probe status.
   * @returns Returns the icon.
   */
  protected markOf(status: SetupProbeResult['status']): Icon {
    switch (status) {
      case 'ok':
        return Icon.CHECK;
      case 'missing':
        return Icon.SETUP_MISSING;
      default:
        return Icon.SETUP_WARNING;
    }
  }

  /**
   * Runs the checks again, for a user who has just gone and installed something.
   */
  protected recheck(): void {
    void this.probes.refresh();
  }
}
