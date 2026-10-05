import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { ForgeAuthStatus } from '@shared/api/forge-types';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Forge } from '@shared/angular/services/forge/forge';

/**
 * The setup wizard's GitHub step: whether Studio can reach the forge.
 *
 * ⚠️ Interim. A forge is not version control — it is where a repository is hosted — and its home is a
 * Hosting step of its own, with a leaf per installed hosting plugin, once the hosting seam exists
 * (#819, #820). Until then it sits beneath Version Control, the nearest thing it depends on, rather
 * than holding a root of its own for one row.
 *
 * An absent forge token is a deferred failure: invisible until Studio is asked for pull requests it
 * cannot fetch. Saying so here costs nothing.
 */
@Component({
  selector: 'app-setup-step-forge',
  imports: [SettingRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-forge.scss',
  template: `
    @if (!forge.isAvailable) {
      <p class="scm__unavailable">GitHub cannot be checked outside the desktop application.</p>
    } @else {
      <app-setting-row
        label="GitHub"
        description="Signing in lets Studio show pull requests, issues and workflow runs for your repositories."
      >
        <span class="scm__status">
          @if (status(); as status) {
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
export class SetupStepForge {
  /**
   * Holds the forge client, exposed for the template.
   */
  protected readonly forge: Forge = inject(Forge);

  /**
   * Holds the forge authentication status, or null until it has been read.
   */
  private readonly auth: WritableSignal<ForgeAuthStatus | null> = signal<ForgeAuthStatus | null>(
    null,
  );

  /**
   * Gets the forge authentication status.
   */
  protected readonly status: Signal<ForgeAuthStatus | null> = this.auth.asReadonly();

  /**
   * Initializes the step, reading whether Studio is signed in.
   */
  public constructor() {
    if (this.forge.isAvailable) {
      void this.forge.authStatus().then((status: ForgeAuthStatus): void => this.auth.set(status));
    }
  }
}
