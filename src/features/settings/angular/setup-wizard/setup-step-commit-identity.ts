import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { GitIdentity } from '@shared/api/setup-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { SetupProbes } from '@shared/angular/services/setup-probes/setup-probes';

/**
 * The setup wizard's commit-identity step: who commits are attributed to.
 *
 * A leaf beneath Version Control, grown for an installed version-control system that has an identity
 * to set — as AI Providers grows a sign-in step per provider. A system without one (a future SVN
 * plugin, say) grows no step, and a machine with no system installed is not asked for a name nothing
 * would use.
 *
 * An unset identity is a classic deferred failure: invisible until the first commit is refused. It
 * is cheap to fix now and tedious to diagnose then.
 *
 * The identity is read and written through the same main-process seam the environment step uses, so
 * the two steps cannot disagree about what the system holds.
 */
@Component({
  selector: 'app-setup-step-commit-identity',
  imports: [Button, SettingRow, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-commit-identity.scss',
  template: `
    @if (!probes.isAvailable) {
      <p class="scm__unavailable">
        Version control cannot be configured outside the desktop application.
      </p>
    } @else {
      <app-setting-row label="Commit name" description="The name your commits are attributed to.">
        <app-text-field placeholder="Your name" ariaLabel="Commit name" [(value)]="name" />
      </app-setting-row>

      <app-setting-row
        label="Commit email"
        description="The email address your commits are attributed to."
      >
        <app-text-field placeholder="you@example.com" ariaLabel="Commit email" [(value)]="email" />
      </app-setting-row>

      <div class="scm__status">
        <app-button
          variant="solid"
          label="Save identity"
          [disabled]="!canSave()"
          (click)="save()"
        />
        @if (saved()) {
          <span class="scm__verdict--good">
            Saved to your global {{ systemName() }} configuration.
          </span>
        }
      </div>
    }
  `,
})
export class SetupStepCommitIdentity {
  /**
   * Gets the display name of the version-control system the identity belongs to (for example Git).
   */
  public readonly systemName: InputSignal<string> = input.required<string>();

  /**
   * Holds the probe client, which owns reading and writing the identity.
   */
  protected readonly probes: SetupProbes = inject(SetupProbes);

  /**
   * Holds the name being edited.
   */
  protected readonly name: WritableSignal<string> = signal<string>('');

  /**
   * Holds the email being edited.
   */
  protected readonly email: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether the identity was saved since it was last edited.
   */
  private readonly savedRecently: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the identity was saved.
   */
  protected readonly saved: Signal<boolean> = this.savedRecently.asReadonly();

  /**
   * Gets whether both fields are filled in. Git accepts either alone, but a half-set identity fails
   * exactly as an unset one does.
   */
  protected readonly canSave: Signal<boolean> = computed(
    (): boolean => this.name().trim().length > 0 && this.email().trim().length > 0,
  );

  /**
   * Initializes the step, loading the identity already held so the fields open pre-filled rather
   * than blank — a user who set this up years ago should see that, not be asked again.
   */
  public constructor() {
    void this.load();
  }

  /**
   * Reads the current identity.
   * @returns Returns a promise that resolves once it has been read.
   */
  private async load(): Promise<void> {
    const identity: GitIdentity | null = await this.probes.gitIdentity();
    if (identity !== null) {
      this.name.set(identity.name);
      this.email.set(identity.email);
    }
  }

  /**
   * Writes the entered identity.
   */
  protected async save(): Promise<void> {
    const written: GitIdentity | null = await this.probes.setGitIdentity({
      name: this.name().trim(),
      email: this.email().trim(),
    });
    this.savedRecently.set(written !== null);
  }
}
