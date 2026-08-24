import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { ForgeAuthStatus } from '@shared/api/forge-types';
import { Forge } from '@shared/angular/services/forge/forge';
import { Button } from '@shared/angular/components/forms/button/button';
import { PasswordField } from '@shared/angular/components/forms/password-field/password-field';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';

/**
 * The status shown before the first read completes, so the page never renders a misleading
 * "not signed in" while the probe is still in flight.
 */
const PENDING: ForgeAuthStatus = {
  source: 'none',
  authenticated: false,
  hasStoredToken: false,
  identity: null,
  detail: 'Checking…',
};

/**
 * Represents the Source Control section of the settings view: the GitHub credential the Repository
 * panel's Pull Requests, Issues and Actions sections read through (#432).
 *
 * The token is written straight to the main process and never held here beyond the draft the user is
 * typing — there is no way to read a stored token back, by design. What the page renders is the
 * {@link ForgeAuthStatus}: who the credential authenticates as, where it came from, and what to do when
 * it does not work.
 *
 * Signing in with the GitHub CLI is offered as an alternative rather than a competitor: a stored token
 * wins, and clearing it falls back to the CLI rather than signing the user out, which is what the
 * status then says.
 */
@Component({
  selector: 'app-source-control-settings',
  imports: [Button, PasswordField, SettingRow],
  templateUrl: './source-control-settings.html',
  styleUrls: ['../section.scss', './source-control-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlSettingsSection implements OnInit {
  /**
   * Holds the forge client the token is stored through.
   */
  private readonly forge: Forge = inject(Forge);

  /**
   * Holds the last status read from the backend.
   */
  protected readonly status: WritableSignal<ForgeAuthStatus> = signal<ForgeAuthStatus>(PENDING);

  /**
   * Holds the token being typed, which is never persisted here.
   */
  protected readonly draft: WritableSignal<string> = signal<string>('');

  /**
   * Holds a value indicating whether a credential operation is in flight, so the buttons cannot be
   * pressed twice.
   */
  protected readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether the forge backend is reachable at all (it is not when Studio runs
   * as a plain web app).
   */
  protected readonly isAvailable: boolean = this.forge.isAvailable;

  /**
   * Gets a value indicating whether the entered token can be saved.
   */
  protected readonly canSave: Signal<boolean> = computed(
    (): boolean => this.isAvailable && !this.busy() && this.draft().trim().length > 0,
  );

  /**
   * Gets a value indicating whether there is a stored token to clear. A CLI login is not clearable
   * from here — that is `gh auth logout`'s business, not Studio's.
   */
  protected readonly canClear: Signal<boolean> = computed(
    (): boolean => this.isAvailable && !this.busy() && this.status().hasStoredToken,
  );

  /**
   * Reads the current status when the page opens.
   */
  public ngOnInit(): void {
    void this.refresh();
  }

  /**
   * Records the token as it is typed.
   * @param value The entered text.
   */
  protected onDraft(value: string): void {
    this.draft.set(value);
  }

  /**
   * Stores the entered token and shows the resulting status. The draft is cleared either way: leaving
   * a token sitting in a form field after it has been stored serves no purpose.
   */
  protected async onSave(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    this.busy.set(true);
    try {
      this.status.set(await this.forge.setToken(this.draft()));
      this.draft.set('');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Clears the stored token and shows the resulting status, which may still be signed in through the
   * GitHub CLI.
   */
  protected async onClear(): Promise<void> {
    if (!this.canClear()) {
      return;
    }
    this.busy.set(true);
    try {
      this.status.set(await this.forge.clearToken());
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Re-reads the status, verifying the credential against GitHub again.
   */
  protected async refresh(): Promise<void> {
    this.busy.set(true);
    try {
      this.status.set(await this.forge.authStatus());
    } finally {
      this.busy.set(false);
    }
  }
}
