import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { GitIdentity, SetupProbeId, SetupProbeResult } from '@shared/api/setup-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import { SetupProbes } from '@shared/angular/services/setup-probes/setup-probes';

/**
 * Names each probe in the user's terms. The main process reports what it found; what the thing is
 * called is presentation, and belongs here.
 */
const PROBE_LABELS: Readonly<Record<SetupProbeId, string>> = {
  git: 'Git',
  'git-identity': 'Git identity',
  dotnet: '.NET SDK',
  java: 'Java',
  node: 'Node.js',
  clangd: 'clangd',
};

/**
 * The setup wizard's environment step: what Studio depends on, checked against this machine.
 *
 * This step carries the wizard's actual promise. Everything it reports is something that otherwise
 * fails much later and for a reason that looks nothing like its cause — a C# server that never starts
 * because `dotnet` is not on the login shell's PATH, a commit refused hours in because no identity was
 * ever configured. Saying so here costs a sentence; finding out the other way costs an afternoon.
 *
 * Nothing here blocks. A missing toolchain is a fact about the machine, not an error the user has to
 * clear before continuing — plenty of people have no use for .NET — so every finding is reported and
 * the step moves on.
 */
@Component({
  selector: 'app-setup-step-environment',
  imports: [AppIcon, Button, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-environment.scss',
  template: `
    @if (!probes.isAvailable) {
      <p class="env__unavailable">
        The environment cannot be checked outside the desktop application.
      </p>
    } @else {
      <ul class="env__list">
        @for (result of probes.results(); track result.id) {
          <li class="env__item" [class]="'env__item--' + result.status">
            <app-icon class="env__mark" [icon]="markOf(result.status)" [size]="1" />
            <span class="env__text">
              <span class="env__name">{{ label(result.id) }}</span>
              <span class="env__detail">{{ result.detail }}</span>
            </span>
          </li>
        }
      </ul>

      @if (needsIdentity()) {
        <div class="env__fix">
          <p class="env__fix-title">Set who your commits are attributed to</p>
          <div class="env__fix-fields">
            <app-text-field placeholder="Your name" ariaLabel="Your name" [(value)]="name" />
            <app-text-field
              placeholder="you@example.com"
              ariaLabel="Your email address"
              [(value)]="email"
            />
            <app-button
              variant="solid"
              label="Save"
              [disabled]="!canSaveIdentity()"
              (click)="saveIdentity()"
            />
          </div>
          <p class="env__fix-note">
            Written to your global git configuration, exactly as
            <code>git config --global</code> would.
          </p>
        </div>
      }

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
   * Holds the name being entered for the git identity.
   */
  protected readonly name: WritableSignal<string> = signal<string>('');

  /**
   * Holds the email being entered for the git identity.
   */
  protected readonly email: WritableSignal<string> = signal<string>('');

  /**
   * Gets whether the git identity needs setting, which is what puts the inline fix on screen. The fix
   * is offered only when it would help: git present, identity absent.
   */
  protected readonly needsIdentity: Signal<boolean> = computed(
    (): boolean =>
      this.probes.statusOf('git') === 'ok' && this.probes.statusOf('git-identity') === 'warn',
  );

  /**
   * Gets whether both identity fields have been filled in. Git will accept either alone, but a
   * half-set identity fails exactly as an unset one does, so the fix asks for both.
   */
  protected readonly canSaveIdentity: Signal<boolean> = computed(
    (): boolean =>
      this.name().trim().length > 0 && this.email().trim().length > 0 && !this.probes.busy(),
  );

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

  /**
   * Writes the entered git identity and re-checks.
   */
  protected saveIdentity(): void {
    const identity: GitIdentity = { name: this.name().trim(), email: this.email().trim() };
    void this.probes.setGitIdentity(identity);
  }
}
