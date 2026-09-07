import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { ForgeAuthStatus } from '@shared/api/forge-types';
import { GitIdentity } from '@shared/api/setup-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Forge } from '@shared/angular/services/forge/forge';
import { SetupProbes } from '@shared/angular/services/setup-probes/setup-probes';

/**
 * The setup wizard's source-control step: who commits are attributed to, and whether Studio can reach
 * the forge.
 *
 * Both are classic deferred failures. An unset git identity is invisible until the first commit is
 * refused, and an absent forge token is invisible until Studio is asked for pull requests it cannot
 * fetch. Neither is fatal and neither blocks the step; both are cheap to fix now and tedious to
 * diagnose later.
 *
 * The identity is read and written through the same main-process seam the environment step uses, so
 * the two steps cannot disagree about what git holds.
 */
@Component({
  selector: 'app-setup-step-source-control',
  imports: [Button, SettingRow, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-source-control.scss',
  template: `
    @if (!probes.isAvailable) {
      <p class="scm__unavailable">
        Source control cannot be configured outside the desktop application.
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
          <span class="scm__verdict--good">Saved to your global git configuration.</span>
        }
      </div>

      <app-setting-row
        label="GitHub"
        description="Signing in lets Studio show pull requests, issues and workflow runs for your repositories."
      >
        <span class="scm__status">
          @if (forgeStatus(); as status) {
            @if (status.authenticated) {
              <span class="scm__verdict--good">
                Signed in{{ status.identity ? ' as ' + status.identity.login : '' }}
              </span>
            } @else {
              <span class="scm__verdict--bad">Not signed in</span>
            }
          } @else {
            <span>Checking…</span>
          }
        </span>
      </app-setting-row>

      <p class="scm__note">
        A forge token is set in Settings under Source Control, where it can be stored securely.
        Studio works without one; only the pull-request and workflow views need it.
      </p>
    }
  `,
})
export class SetupStepSourceControl {
  /**
   * Holds the probe client, which owns reading and writing the git identity.
   */
  protected readonly probes: SetupProbes = inject(SetupProbes);

  /**
   * Holds the forge client, consulted for whether Studio can reach GitHub.
   */
  private readonly forge: Forge = inject(Forge);

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
   * Holds the forge authentication status, or null until it has been read.
   */
  private readonly forgeAuth: WritableSignal<ForgeAuthStatus | null> =
    signal<ForgeAuthStatus | null>(null);

  /**
   * Gets whether the identity was saved.
   */
  protected readonly saved: Signal<boolean> = this.savedRecently.asReadonly();

  /**
   * Gets the forge authentication status.
   */
  protected readonly forgeStatus: Signal<ForgeAuthStatus | null> = this.forgeAuth.asReadonly();

  /**
   * Gets whether both fields are filled in. Git accepts either alone, but a half-set identity fails
   * exactly as an unset one does.
   */
  protected readonly canSave: Signal<boolean> = computed(
    (): boolean => this.name().trim().length > 0 && this.email().trim().length > 0,
  );

  /**
   * Initializes the step, loading what git and the forge already hold so the fields open pre-filled
   * rather than blank — a user who set this up years ago should see that, not be asked again.
   */
  public constructor() {
    void this.load();
  }

  /**
   * Reads the current identity and forge status.
   * @returns Returns a promise that resolves once both have been read.
   */
  private async load(): Promise<void> {
    const identity: GitIdentity | null = await this.probes.gitIdentity();
    if (identity !== null) {
      this.name.set(identity.name);
      this.email.set(identity.email);
    }
    if (this.forge.isAvailable) {
      this.forgeAuth.set(await this.forge.authStatus());
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
