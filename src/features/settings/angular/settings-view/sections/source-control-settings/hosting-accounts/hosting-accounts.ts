import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { ForgeHostAccount } from '@shared/api/forge-types';
import { HostingAuthMode } from '@shared/api/hosting-protocol';
import { installedContributions, PluginContribution } from '@shared/api/plugin-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PasswordField } from '@shared/angular/components/forms/password-field/password-field';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Forge } from '@shared/angular/services/forge/forge';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * The dropdown value standing for "let the plugin decide", which the protocol spells as null.
 */
const AUTOMATIC: string = 'automatic';

/**
 * The label each way of signing in is offered under. The words are the protocol's, not any one
 * host's: which command-line tool a plugin asks is the plugin's business, and its status says so.
 */
const MODE_LABELS: Readonly<Record<HostingAuthMode, string>> = {
  cli: 'Command-line login',
  studio: 'Token saved in Studio',
};

/**
 * One host's row while it is being edited: what the main process last said, and the token being typed.
 */
interface AccountRow {
  /**
   * Gets the host as the main process last described it.
   */
  readonly account: ForgeHostAccount;

  /**
   * Gets the token being typed, which is never persisted here.
   */
  readonly draft: string;
}

/**
 * Lists every host the installed hosting plugins serve in Settings ▸ Source Control (#821), with how
 * each is signed in: the ways its plugin's manifest offers, the token Studio keeps for it, and who the
 * host says the credential belongs to. Core names no host — with no hosting plugin installed there is
 * nothing here but the way to install one.
 *
 * A token is written straight to the main process and never held here beyond the draft being typed;
 * there is no way to read a stored token back, by design.
 */
@Component({
  selector: 'app-hosting-accounts',
  imports: [Button, Dropdown, PasswordField, SettingRow],
  templateUrl: './hosting-accounts.html',
  styleUrl: './hosting-accounts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HostingAccounts {
  /**
   * Holds the forge client the hosts are read and signed in through.
   */
  private readonly forge: Forge = inject(Forge);

  /**
   * Holds the plugin client, watched for hosting plugins arriving or leaving.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Gets the installed hosting plugins' ids, joined — what changes when one is installed or removed.
   */
  private readonly installed: Signal<string> = computed((): string =>
    installedContributions(this.plugins.plugins(), 'hosting')
      .map((contribution: PluginContribution): string => contribution.id)
      .join('\u0000'),
  );

  /**
   * Gets a value indicating whether the forge backend is reachable at all (it is not when Studio runs
   * as a plain web app).
   */
  protected readonly isAvailable: boolean = this.forge.isAvailable;

  /**
   * Holds one row per host.
   */
  protected readonly rows: WritableSignal<readonly AccountRow[]> = signal<readonly AccountRow[]>(
    [],
  );

  /**
   * Holds whether the hosts have been read.
   */
  protected readonly loaded: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the key of the row with a change in flight, or null, so nothing is pressed twice.
   */
  protected readonly busy: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Reads the hosts when the page opens, and again whenever a hosting plugin is installed or removed
   * while it is open — the settings tab stays mounted, so opening it is not the only moment to read.
   */
  public constructor() {
    effect((): void => {
      this.installed();
      untracked((): void => void this.refresh());
    });
  }

  /**
   * Gets the key a row is tracked and locked by.
   * @param row The row.
   * @returns Returns the plugin and host.
   */
  protected keyOf(row: AccountRow): string {
    return `${row.account.pluginId}\u0000${row.account.host}`;
  }

  /**
   * Gets a row's label: the plugin and the host, since one plugin may serve several.
   * @param row The row.
   * @returns Returns the label.
   */
  protected labelOf(row: AccountRow): string {
    return `${row.account.provider} (${row.account.host})`;
  }

  /**
   * Gets the ways of signing in a row's dropdown offers: the plugin's choice, then each mode its
   * manifest declares.
   * @param row The row.
   * @returns Returns the options.
   */
  protected options(row: AccountRow): readonly DropdownOption[] {
    return [
      { value: AUTOMATIC, label: 'Automatic' },
      ...row.account.authModes.map((mode: HostingAuthMode): DropdownOption => ({
        value: mode,
        label: MODE_LABELS[mode],
      })),
    ];
  }

  /**
   * Gets the dropdown value for a row's current choice.
   * @param row The row.
   * @returns Returns the value.
   */
  protected modeOf(row: AccountRow): string {
    return row.account.authMode ?? AUTOMATIC;
  }

  /**
   * Gets whether a row offers a token: its plugin accepts one, and the user has not chosen the
   * command-line login instead.
   * @param row The row.
   * @returns Returns true when the token field shows.
   */
  protected offersToken(row: AccountRow): boolean {
    return row.account.authModes.includes('studio') && row.account.authMode !== 'cli';
  }

  /**
   * Gets whether a row's drafted token can be saved.
   * @param row The row.
   * @returns Returns true when Save is enabled.
   */
  protected canSave(row: AccountRow): boolean {
    return this.busy() === null && row.draft.trim().length > 0;
  }

  /**
   * Gets whether a row has a stored token to clear. A command-line login is not clearable from here —
   * that is the tool's own business, not Studio's.
   * @param row The row.
   * @returns Returns true when Clear is enabled.
   */
  protected canClear(row: AccountRow): boolean {
    return this.busy() === null && row.account.status.hasStoredToken;
  }

  /**
   * Chooses how a row's plugin signs in to its host, restarting the plugin.
   * @param row The row.
   * @param value The dropdown value chosen.
   */
  protected async onMode(row: AccountRow, value: string): Promise<void> {
    const mode: HostingAuthMode | null = value === AUTOMATIC ? null : (value as HostingAuthMode);
    if (mode === row.account.authMode) {
      return;
    }
    await this.apply(row, () =>
      this.forge.setAuthMode(row.account.pluginId, row.account.host, mode),
    );
  }

  /**
   * Records a token as it is typed.
   * @param row The row.
   * @param value The entered text.
   */
  protected onDraft(row: AccountRow, value: string): void {
    this.replace(row, { ...row, draft: value });
  }

  /**
   * Stores a row's drafted token. The draft is cleared either way: leaving a token sitting in a form
   * field after it has been stored serves no purpose.
   * @param row The row.
   */
  protected async onSave(row: AccountRow): Promise<void> {
    if (!this.canSave(row)) {
      return;
    }
    await this.apply(row, () =>
      this.forge.setToken(row.account.pluginId, row.account.host, row.draft),
    );
  }

  /**
   * Clears the token stored for a row's host. The result may still be signed in, through the
   * command-line login, which the status then says.
   * @param row The row.
   */
  protected async onClear(row: AccountRow): Promise<void> {
    if (!this.canClear(row)) {
      return;
    }
    await this.apply(row, () => this.forge.clearToken(row.account.pluginId, row.account.host));
  }

  /**
   * Reads the hosts again, verifying every credential against its host.
   */
  protected async refresh(): Promise<void> {
    // No one row's key: a reread locks them all.
    this.busy.set('');
    try {
      const accounts: readonly ForgeHostAccount[] = await this.forge.hosts();
      this.rows.set(
        accounts.map((account: ForgeHostAccount): AccountRow => ({ account, draft: '' })),
      );
    } finally {
      this.loaded.set(true);
      this.busy.set(null);
    }
  }

  /**
   * Runs a change to one row and shows the account the main process answers with.
   * @param row The row.
   * @param change Makes the change.
   */
  private async apply(
    row: AccountRow,
    change: () => Promise<ForgeHostAccount | null>,
  ): Promise<void> {
    this.busy.set(this.keyOf(row));
    try {
      const account: ForgeHostAccount | null = await change();
      if (account === null) {
        // The plugin no longer serves the host — uninstalled, or outranked — so read them all again.
        await this.refresh();
        return;
      }
      this.replace(row, { account, draft: '' });
    } finally {
      this.busy.set(null);
    }
  }

  /**
   * Replaces one row.
   * @param row The row.
   * @param next Its replacement.
   */
  private replace(row: AccountRow, next: AccountRow): void {
    const key: string = this.keyOf(row);
    this.rows.update((rows: readonly AccountRow[]): readonly AccountRow[] =>
      rows.map((candidate: AccountRow): AccountRow =>
        this.keyOf(candidate) === key ? next : candidate,
      ),
    );
  }
}
